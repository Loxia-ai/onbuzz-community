/**
 * Memory Service
 *
 * Purpose:
 * - Provide persistent memory storage for agents
 * - Support CRUD operations on memories (add, update, delete, list, read)
 * - Store memories per-agent in dedicated files
 * - Support expiration conditions (date-based or condition-based)
 *
 * Storage: userDataDir/state/agents/agent-{id}-memory.json
 */

import { promises as fs } from 'fs';
import path from 'path';
import { getUserDataPaths, ensureUserDataDirs } from '../utilities/userDataDir.js';

// Memory data version for future migrations
const MEMORY_VERSION = '1.0.0';

class MemoryService {
  constructor(logger = null) {
    this.logger = logger;

    // In-memory cache: agentId -> memories array
    this.memoriesCache = new Map();

    // Paths
    this.agentsDir = null;
    this.initialized = false;
  }

  /**
   * Initialize the memory service
   * @returns {Promise<void>}
   */
  async initialize() {
    if (this.initialized) return;

    try {
      await ensureUserDataDirs();
      const paths = getUserDataPaths();
      this.agentsDir = paths.agents;

      this.initialized = true;
      this.logger?.info('[MemoryService] Initialized', { agentsDir: this.agentsDir });
    } catch (error) {
      this.logger?.warn('[MemoryService] Initialization failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get the memory file path for an agent
   * @param {string} agentId
   * @returns {string}
   */
  _getMemoryFilePath(agentId) {
    return path.join(this.agentsDir, `${agentId}-memory.json`);
  }

  /**
   * Generate a unique memory ID
   * @returns {string}
   */
  _generateMemoryId() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `mem-${timestamp}-${random}`;
  }

  /**
   * Load memories for an agent from disk
   * @param {string} agentId
   * @returns {Promise<Array>} Array of memories
   */
  async loadMemories(agentId) {
    if (!this.initialized) {
      await this.initialize();
    }

    // Check cache first
    if (this.memoriesCache.has(agentId)) {
      return this.memoriesCache.get(agentId);
    }

    const filePath = this._getMemoryFilePath(agentId);

    try {
      const data = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(data);

      // Filter out expired memories
      const memories = this._filterExpiredMemories(parsed.memories || []);

      // Update cache
      this.memoriesCache.set(agentId, memories);

      this.logger?.debug('[MemoryService] Loaded memories', {
        agentId,
        count: memories.length
      });

      return memories;
    } catch (error) {
      if (error.code === 'ENOENT') {
        // No memory file yet, return empty array
        this.memoriesCache.set(agentId, []);
        return [];
      }
      this.logger?.warn('[MemoryService] Failed to load memories', {
        agentId,
        error: error.message
      });
      return [];
    }
  }

  /**
   * Save memories for an agent to disk
   * @param {string} agentId
   * @param {Array} memories
   * @returns {Promise<void>}
   */
  async saveMemories(agentId, memories) {
    if (!this.initialized) {
      await this.initialize();
    }

    const filePath = this._getMemoryFilePath(agentId);

    const data = {
      version: MEMORY_VERSION,
      agentId,
      memories,
      lastPersisted: new Date().toISOString()
    };

    try {
      await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');

      // Update cache
      this.memoriesCache.set(agentId, memories);

      this.logger?.debug('[MemoryService] Saved memories', {
        agentId,
        count: memories.length
      });
    } catch (error) {
      this.logger?.error('[MemoryService] Failed to save memories', {
        agentId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Filter out expired memories
   * @param {Array} memories
   * @returns {Array}
   */
  _filterExpiredMemories(memories) {
    const now = new Date();

    return memories.filter(memory => {
      if (!memory.expiration) return true;

      if (memory.expiration.type === 'date') {
        const expiryDate = new Date(memory.expiration.value);
        return expiryDate > now;
      }

      // Condition-based expiration must be manually removed
      // type === 'condition' or type === 'never'
      return true;
    });
  }

  /**
   * Add a new memory
   * @param {string} agentId
   * @param {Object} memoryData - { title, description, content, expiration }
   * @returns {Promise<Object>} Created memory
   */
  async addMemory(agentId, memoryData) {
    const memories = await this.loadMemories(agentId);

    const memory = {
      id: this._generateMemoryId(),
      title: memoryData.title,
      description: memoryData.description || '',
      content: memoryData.content,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiration: this._parseExpiration(memoryData.expiration),
      accessCount: 0,
      lastAccessed: null
    };

    memories.push(memory);
    await this.saveMemories(agentId, memories);

    this.logger?.info('[MemoryService] Memory added', {
      agentId,
      memoryId: memory.id,
      title: memory.title
    });

    return memory;
  }

  /**
   * Parse expiration input into standard format
   * @param {string|Object} expiration
   * @returns {Object|null}
   */
  _parseExpiration(expiration) {
    if (!expiration) {
      return { type: 'never', value: null };
    }

    if (typeof expiration === 'string') {
      // Try parsing as date
      const date = new Date(expiration);
      if (!isNaN(date.getTime())) {
        return { type: 'date', value: date.toISOString() };
      }
      // Treat as condition
      return { type: 'condition', value: expiration };
    }

    if (typeof expiration === 'object') {
      return {
        type: expiration.type || 'condition',
        value: expiration.value || expiration.date || expiration.condition
      };
    }

    return { type: 'never', value: null };
  }

  /**
   * Update an existing memory
   * @param {string} agentId
   * @param {string} memoryId
   * @param {Object} updates - { title?, description?, content?, expiration? }
   * @returns {Promise<Object|null>} Updated memory or null if not found
   */
  async updateMemory(agentId, memoryId, updates) {
    const memories = await this.loadMemories(agentId);

    const index = memories.findIndex(m => m.id === memoryId);
    if (index === -1) {
      this.logger?.warn('[MemoryService] Memory not found for update', {
        agentId,
        memoryId
      });
      return null;
    }

    const memory = memories[index];

    if (updates.title !== undefined) memory.title = updates.title;
    if (updates.description !== undefined) memory.description = updates.description;
    if (updates.content !== undefined) memory.content = updates.content;
    if (updates.expiration !== undefined) {
      memory.expiration = this._parseExpiration(updates.expiration);
    }

    memory.updatedAt = new Date().toISOString();

    memories[index] = memory;
    await this.saveMemories(agentId, memories);

    this.logger?.info('[MemoryService] Memory updated', {
      agentId,
      memoryId,
      title: memory.title
    });

    return memory;
  }

  /**
   * Delete a memory
   * @param {string} agentId
   * @param {string} memoryId
   * @returns {Promise<boolean>} True if deleted, false if not found
   */
  async deleteMemory(agentId, memoryId) {
    const memories = await this.loadMemories(agentId);

    const index = memories.findIndex(m => m.id === memoryId);
    if (index === -1) {
      this.logger?.warn('[MemoryService] Memory not found for deletion', {
        agentId,
        memoryId
      });
      return false;
    }

    const deleted = memories.splice(index, 1)[0];
    await this.saveMemories(agentId, memories);

    this.logger?.info('[MemoryService] Memory deleted', {
      agentId,
      memoryId,
      title: deleted.title
    });

    return true;
  }

  /**
   * List memories with configurable detail level
   * @param {string} agentId
   * @param {string} level - 'titles' | 'descriptions' | 'full'
   * @returns {Promise<Object>} Memories grouped by date
   */
  async listMemories(agentId, level = 'titles') {
    const memories = await this.loadMemories(agentId);

    // Sort by createdAt descending (newest first)
    const sorted = [...memories].sort((a, b) =>
      new Date(b.createdAt) - new Date(a.createdAt)
    );

    // Group by date
    const grouped = {};
    for (const memory of sorted) {
      const date = memory.createdAt.split('T')[0]; // YYYY-MM-DD
      if (!grouped[date]) {
        grouped[date] = [];
      }

      // Apply detail level
      let item;
      switch (level) {
        case 'titles':
          item = { id: memory.id, title: memory.title };
          break;
        case 'descriptions':
          item = {
            id: memory.id,
            title: memory.title,
            description: memory.description
          };
          break;
        case 'full':
          item = {
            id: memory.id,
            title: memory.title,
            description: memory.description,
            expiration: memory.expiration,
            createdAt: memory.createdAt,
            updatedAt: memory.updatedAt
          };
          break;
        default:
          item = { id: memory.id, title: memory.title };
      }

      grouped[date].push(item);
    }

    return {
      count: memories.length,
      grouped
    };
  }

  /**
   * Read a memory's full content (marks as accessed)
   * @param {string} agentId
   * @param {string} memoryId
   * @returns {Promise<Object|null>} Full memory or null if not found
   */
  async readMemory(agentId, memoryId) {
    const memories = await this.loadMemories(agentId);

    const index = memories.findIndex(m => m.id === memoryId);
    if (index === -1) {
      this.logger?.warn('[MemoryService] Memory not found for read', {
        agentId,
        memoryId
      });
      return null;
    }

    const memory = memories[index];

    // Update access tracking
    memory.accessCount = (memory.accessCount || 0) + 1;
    memory.lastAccessed = new Date().toISOString();

    memories[index] = memory;
    await this.saveMemories(agentId, memories);

    this.logger?.debug('[MemoryService] Memory read', {
      agentId,
      memoryId,
      accessCount: memory.accessCount
    });

    return memory;
  }

  /**
   * Search memories by title or description
   * @param {string} agentId
   * @param {string} query
   * @returns {Promise<Array>} Matching memories (id, title, description)
   */
  async searchMemories(agentId, query) {
    const memories = await this.loadMemories(agentId);

    const lowerQuery = query.toLowerCase();

    return memories
      .filter(m =>
        m.title.toLowerCase().includes(lowerQuery) ||
        m.description.toLowerCase().includes(lowerQuery)
      )
      .map(m => ({
        id: m.id,
        title: m.title,
        description: m.description
      }));
  }

  /**
   * Clear all memories for an agent
   * @param {string} agentId
   * @returns {Promise<number>} Number of memories cleared
   */
  async clearMemories(agentId) {
    const memories = await this.loadMemories(agentId);
    const count = memories.length;

    await this.saveMemories(agentId, []);

    this.logger?.info('[MemoryService] Cleared all memories', {
      agentId,
      count
    });

    return count;
  }

  /**
   * Delete memory file for an agent (used when agent is deleted)
   * @param {string} agentId
   * @returns {Promise<boolean>}
   */
  async deleteMemoryFile(agentId) {
    const filePath = this._getMemoryFilePath(agentId);

    try {
      await fs.unlink(filePath);
      this.memoriesCache.delete(agentId);
      this.logger?.info('[MemoryService] Memory file deleted', { agentId });
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') {
        return true; // Already deleted
      }
      this.logger?.warn('[MemoryService] Failed to delete memory file', {
        agentId,
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get memory statistics for an agent
   * @param {string} agentId
   * @returns {Promise<Object>}
   */
  async getMemoryStats(agentId) {
    const memories = await this.loadMemories(agentId);

    const now = new Date();
    let expiringCount = 0;
    let totalAccessCount = 0;

    for (const memory of memories) {
      totalAccessCount += memory.accessCount || 0;

      if (memory.expiration?.type === 'date') {
        const expiryDate = new Date(memory.expiration.value);
        const daysUntilExpiry = (expiryDate - now) / (1000 * 60 * 60 * 24);
        if (daysUntilExpiry <= 7) {
          expiringCount++;
        }
      }
    }

    return {
      totalMemories: memories.length,
      totalAccessCount,
      expiringWithin7Days: expiringCount,
      averageAccessCount: memories.length > 0
        ? (totalAccessCount / memories.length).toFixed(2)
        : 0
    };
  }
}

// Export singleton instance
let instance = null;

export function getMemoryService(logger = null) {
  if (!instance) {
    instance = new MemoryService(logger);
  }
  return instance;
}

export { MemoryService };
export default MemoryService;
