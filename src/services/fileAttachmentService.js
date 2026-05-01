/**
 * File Attachment Service
 * Manages file attachments for agents with CRUD operations and reference counting
 *
 * UPDATED: Attachments are now stored in a platform-appropriate user data directory
 * that persists across npm package updates. See userDataDir.js for details.
 */

import path from 'path';
import { randomUUID } from 'crypto';
import FileProcessor from '../utilities/fileProcessor.js';
import AttachmentValidator from '../utilities/attachmentValidator.js';
import { getUserDataPaths } from '../utilities/userDataDir.js';

// UPDATED: Use persistent user data directory instead of cwd-relative path
// This ensures attachments survive npm package updates (npm i -g)
const userPaths = getUserDataPaths();
const ATTACHMENTS_DIR = userPaths.attachments;
const INDEX_FILE = path.join(ATTACHMENTS_DIR, 'attachments-index.json');

class FileAttachmentService {
  constructor(config = {}, logger = null) {
    this.config = config;
    this.logger = logger;
    this.fileProcessor = new FileProcessor(config, logger);
    this.validator = new AttachmentValidator(config, logger);
    this.index = null; // Lazy loaded
  }

  /**
   * Initialize service (create directories, load index)
   * @returns {Promise<void>}
   */
  async initialize() {
    try {
      await this.fileProcessor.createDirectory(ATTACHMENTS_DIR);
      await this.loadIndex();
      this.logger?.info('FileAttachmentService initialized', { attachmentsDir: ATTACHMENTS_DIR });
    } catch (error) {
      this.logger?.error('Error initializing FileAttachmentService', { error: error.message });
      throw error;
    }
  }

  /**
   * Load index file
   * @returns {Promise<Object>}
   */
  async loadIndex() {
    try {
      const exists = await this.fileProcessor.fileExists(INDEX_FILE);
      if (!exists) {
        this.index = { attachments: {}, agentRefs: {} };
        await this.saveIndex();
      } else {
        const content = await this.fileProcessor.readFile(INDEX_FILE, 'utf8');
        this.index = JSON.parse(content);
      }
      return this.index;
    } catch (error) {
      this.logger?.error('Error loading index', { error: error.message });
      this.index = { attachments: {}, agentRefs: {} };
      return this.index;
    }
  }

  /**
   * Save index file
   * @returns {Promise<void>}
   */
  async saveIndex() {
    try {
      await this.fileProcessor.writeFile(INDEX_FILE, JSON.stringify(this.index, null, 2), 'utf8');
    } catch (error) {
      this.logger?.error('Error saving index', { error: error.message });
      throw error;
    }
  }

  /**
   * Upload file attachment
   * @param {Object} options
   * @param {string} options.agentId - Agent ID
   * @param {string} options.filePath - Source file path
   * @param {string} options.mode - 'content' or 'reference'
   * @param {string} options.fileName - Optional custom file name
   * @returns {Promise<Object>} Attachment metadata
   */
  async uploadFile({ agentId, filePath, mode = 'content', fileName = null }) {
    if (!this.index) {
      await this.loadIndex();
    }

    try {
      // Validate file exists
      const exists = await this.fileProcessor.fileExists(filePath);
      if (!exists) {
        throw new Error(`File not found: ${filePath}`);
      }

      // Get file stats
      const stats = await this.fileProcessor.getFileStats(filePath);
      const actualFileName = fileName || path.basename(filePath);
      const fileExtension = path.extname(actualFileName);

      // Validate
      const validation = this.validator.validate({
        fileName: actualFileName,
        size: stats.size,
        mode,
        path: mode === 'reference' ? filePath : null
      });

      if (!validation.valid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`);
      }

      // Generate file ID
      const fileId = randomUUID();

      // Calculate hash
      const hash = await this.fileProcessor.calculateHash(filePath);

      // Determine content type
      const contentType = this.validator.getContentType(actualFileName);

      // Create attachment directory
      const attachmentDir = path.join(ATTACHMENTS_DIR, agentId, fileId);
      await this.fileProcessor.createDirectory(attachmentDir);

      // Process and save content (for content mode)
      let tokenEstimate = 0;
      let contentFileName = null;

      if (mode === 'content') {
        const processResult = await this.fileProcessor.processFile(filePath, contentType);
        const content = processResult.content;

        // Determine content file name based on type
        if (contentType === 'text') {
          contentFileName = 'content.txt';
        } else if (contentType === 'image') {
          contentFileName = 'content.base64';
        } else if (contentType === 'pdf') {
          contentFileName = 'content.txt';
        }

        // Save content
        const contentFilePath = path.join(attachmentDir, contentFileName);
        await this.fileProcessor.writeFile(contentFilePath, content, 'utf8');

        // Estimate tokens
        tokenEstimate = this.fileProcessor.estimateTokens(content);
      }

      // Create metadata
      const metadata = {
        fileId,
        agentId,
        fileName: actualFileName,
        originalPath: filePath,
        fileType: this.validator.getMimeType(actualFileName),
        fileExtension,
        size: stats.size,
        mode,
        active: true,
        uploadedAt: new Date().toISOString(),
        lastModified: stats.modified.toISOString(),
        hash,
        tokenEstimate,
        contentType,
        contentFileName,
        warnings: validation.warnings,
        sizeLevel: validation.sizeLevel,
        importedFrom: null,
        referencedBy: [agentId] // Reference counting
      };

      // Save metadata
      const metadataPath = path.join(attachmentDir, 'metadata.json');
      await this.fileProcessor.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      // Update index
      this.index.attachments[fileId] = {
        fileId,
        agentId,
        fileName: actualFileName,
        mode,
        active: metadata.active,
        referencedBy: metadata.referencedBy
      };

      if (!this.index.agentRefs[agentId]) {
        this.index.agentRefs[agentId] = [];
      }
      this.index.agentRefs[agentId].push(fileId);

      await this.saveIndex();

      this.logger?.info('File uploaded', { fileId, agentId, fileName: actualFileName, mode });

      return metadata;
    } catch (error) {
      this.logger?.error('Error uploading file', { agentId, filePath, error: error.message });
      throw error;
    }
  }

  /**
   * Get attachments for an agent
   * @param {string} agentId - Agent ID
   * @param {Object} filters - Optional filters { active, mode }
   * @returns {Promise<Array>} Array of attachment metadata
   */
  async getAttachments(agentId, filters = {}) {
    if (!this.index) {
      await this.loadIndex();
    }

    try {
      const fileIds = this.index.agentRefs[agentId] || [];
      const attachments = [];

      for (const fileId of fileIds) {
        const metadata = await this.getAttachment(fileId);
        if (metadata) {
          // Apply filters
          if (filters.active !== undefined && metadata.active !== filters.active) {
            continue;
          }
          if (filters.mode && metadata.mode !== filters.mode) {
            continue;
          }
          attachments.push(metadata);
        }
      }

      return attachments;
    } catch (error) {
      this.logger?.error('Error getting attachments', { agentId, error: error.message });
      throw error;
    }
  }

  /**
   * Get single attachment
   * @param {string} fileId - File ID
   * @returns {Promise<Object|null>} Attachment metadata or null
   */
  async getAttachment(fileId) {
    if (!this.index) {
      await this.loadIndex();
    }

    try {
      const indexEntry = this.index.attachments[fileId];
      if (!indexEntry) {
        return null;
      }

      const metadataPath = path.join(ATTACHMENTS_DIR, indexEntry.agentId, fileId, 'metadata.json');
      const exists = await this.fileProcessor.fileExists(metadataPath);

      if (!exists) {
        this.logger?.warn('Metadata file not found', { fileId });
        return null;
      }

      const content = await this.fileProcessor.readFile(metadataPath, 'utf8');
      return JSON.parse(content);
    } catch (error) {
      this.logger?.error('Error getting attachment', { fileId, error: error.message });
      return null;
    }
  }

  /**
   * Get attachment content
   * @param {string} fileId - File ID
   * @returns {Promise<string|null>} File content or null
   */
  async getAttachmentContent(fileId) {
    try {
      const metadata = await this.getAttachment(fileId);
      if (!metadata || metadata.mode !== 'content') {
        return null;
      }

      const contentPath = path.join(ATTACHMENTS_DIR, metadata.agentId, fileId, metadata.contentFileName);
      const exists = await this.fileProcessor.fileExists(contentPath);

      if (!exists) {
        return null;
      }

      return await this.fileProcessor.readFile(contentPath, 'utf8');
    } catch (error) {
      this.logger?.error('Error getting attachment content', { fileId, error: error.message });
      return null;
    }
  }

  /**
   * Toggle attachment active state
   * @param {string} fileId - File ID
   * @returns {Promise<Object>} Updated metadata
   */
  async toggleActive(fileId) {
    try {
      const metadata = await this.getAttachment(fileId);
      if (!metadata) {
        throw new Error(`Attachment not found: ${fileId}`);
      }

      metadata.active = !metadata.active;
      metadata.lastModified = new Date().toISOString();

      // Save updated metadata
      const metadataPath = path.join(ATTACHMENTS_DIR, metadata.agentId, fileId, 'metadata.json');
      await this.fileProcessor.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      // Update index
      if (this.index.attachments[fileId]) {
        this.index.attachments[fileId].active = metadata.active;
        await this.saveIndex();
      }

      this.logger?.info('Attachment active state toggled', { fileId, active: metadata.active });

      return metadata;
    } catch (error) {
      this.logger?.error('Error toggling attachment', { fileId, error: error.message });
      throw error;
    }
  }

  /**
   * Update attachment metadata
   * @param {string} fileId - File ID
   * @param {Object} updates - Fields to update
   * @returns {Promise<Object>} Updated metadata
   */
  async updateAttachment(fileId, updates) {
    try {
      const metadata = await this.getAttachment(fileId);
      if (!metadata) {
        throw new Error(`Attachment not found: ${fileId}`);
      }

      // Allow only safe updates
      const allowedFields = ['fileName', 'active'];
      for (const field of allowedFields) {
        if (updates[field] !== undefined) {
          metadata[field] = updates[field];
        }
      }

      metadata.lastModified = new Date().toISOString();

      // Save updated metadata
      const metadataPath = path.join(ATTACHMENTS_DIR, metadata.agentId, fileId, 'metadata.json');
      await this.fileProcessor.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      // Update index
      if (this.index.attachments[fileId]) {
        if (updates.fileName) {
          this.index.attachments[fileId].fileName = updates.fileName;
        }
        if (updates.active !== undefined) {
          this.index.attachments[fileId].active = updates.active;
        }
        await this.saveIndex();
      }

      this.logger?.info('Attachment updated', { fileId, updates });

      return metadata;
    } catch (error) {
      this.logger?.error('Error updating attachment', { fileId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete attachment (with reference counting)
   * @param {string} fileId - File ID
   * @param {string} agentId - Agent ID requesting deletion
   * @returns {Promise<boolean>} true if deleted, false if still referenced
   */
  async deleteAttachment(fileId, agentId) {
    try {
      const metadata = await this.getAttachment(fileId);
      if (!metadata) {
        throw new Error(`Attachment not found: ${fileId}`);
      }

      // Remove agent from referencedBy
      metadata.referencedBy = metadata.referencedBy.filter(id => id !== agentId);

      // If still referenced by other agents, just update metadata
      if (metadata.referencedBy.length > 0) {
        const metadataPath = path.join(ATTACHMENTS_DIR, metadata.agentId, fileId, 'metadata.json');
        await this.fileProcessor.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

        // Update index
        if (this.index.attachments[fileId]) {
          this.index.attachments[fileId].referencedBy = metadata.referencedBy;
        }
        if (this.index.agentRefs[agentId]) {
          this.index.agentRefs[agentId] = this.index.agentRefs[agentId].filter(id => id !== fileId);
        }
        await this.saveIndex();

        this.logger?.info('Attachment dereferenced', { fileId, agentId, remainingRefs: metadata.referencedBy.length });
        return false;
      }

      // No more references, delete physical files
      const attachmentDir = path.join(ATTACHMENTS_DIR, metadata.agentId, fileId);
      await this.fileProcessor.deleteDirectory(attachmentDir);

      // Remove from index
      delete this.index.attachments[fileId];
      if (this.index.agentRefs[agentId]) {
        this.index.agentRefs[agentId] = this.index.agentRefs[agentId].filter(id => id !== fileId);
      }
      await this.saveIndex();

      this.logger?.info('Attachment deleted', { fileId, agentId });
      return true;
    } catch (error) {
      this.logger?.error('Error deleting attachment', { fileId, agentId, error: error.message });
      throw error;
    }
  }

  /**
   * Delete all attachments for an agent
   * @param {string} agentId - Agent ID
   * @returns {Promise<Object>} { deleted: number, dereferenced: number }
   */
  async deleteAgentAttachments(agentId) {
    try {
      const fileIds = this.index.agentRefs[agentId] || [];
      let deleted = 0;
      let dereferenced = 0;

      for (const fileId of fileIds) {
        const wasDeleted = await this.deleteAttachment(fileId, agentId);
        if (wasDeleted) {
          deleted++;
        } else {
          dereferenced++;
        }
      }

      this.logger?.info('Agent attachments deleted', { agentId, deleted, dereferenced });

      return { deleted, dereferenced };
    } catch (error) {
      this.logger?.error('Error deleting agent attachments', { agentId, error: error.message });
      throw error;
    }
  }

  /**
   * Import attachment from another agent
   * @param {string} sourceFileId - Source file ID
   * @param {string} targetAgentId - Target agent ID
   * @returns {Promise<Object>} New attachment metadata
   */
  async importFromAgent(sourceFileId, targetAgentId) {
    try {
      const sourceMetadata = await this.getAttachment(sourceFileId);
      if (!sourceMetadata) {
        throw new Error(`Source attachment not found: ${sourceFileId}`);
      }

      // Add target agent to referencedBy
      if (!sourceMetadata.referencedBy.includes(targetAgentId)) {
        sourceMetadata.referencedBy.push(targetAgentId);
      }

      sourceMetadata.lastModified = new Date().toISOString();
      sourceMetadata.importedFrom = sourceMetadata.agentId;

      // Save updated metadata
      const metadataPath = path.join(ATTACHMENTS_DIR, sourceMetadata.agentId, sourceFileId, 'metadata.json');
      await this.fileProcessor.writeFile(metadataPath, JSON.stringify(sourceMetadata, null, 2), 'utf8');

      // Update index
      if (this.index.attachments[sourceFileId]) {
        this.index.attachments[sourceFileId].referencedBy = sourceMetadata.referencedBy;
      }
      if (!this.index.agentRefs[targetAgentId]) {
        this.index.agentRefs[targetAgentId] = [];
      }
      if (!this.index.agentRefs[targetAgentId].includes(sourceFileId)) {
        this.index.agentRefs[targetAgentId].push(sourceFileId);
      }
      await this.saveIndex();

      this.logger?.info('Attachment imported', { sourceFileId, targetAgentId });

      return sourceMetadata;
    } catch (error) {
      this.logger?.error('Error importing attachment', { sourceFileId, targetAgentId, error: error.message });
      throw error;
    }
  }

  /**
   * Get active attachments for an agent
   * @param {string} agentId - Agent ID
   * @returns {Promise<Array>} Array of active attachment metadata
   */
  async getActiveAttachments(agentId) {
    return await this.getAttachments(agentId, { active: true });
  }

  /**
   * Get attachment preview (first 1000 characters)
   * @param {string} fileId - File ID
   * @returns {Promise<string|null>} Preview text or null
   */
  async getAttachmentPreview(fileId) {
    try {
      const content = await this.getAttachmentContent(fileId);
      if (!content) {
        return null;
      }

      // For base64 images, return metadata instead of content
      if (content.startsWith('data:image')) {
        return '[Image content - base64 encoded]';
      }

      // Return first 1000 characters
      return content.length > 1000 ? content.substring(0, 1000) + '...' : content;
    } catch (error) {
      this.logger?.error('Error getting attachment preview', { fileId, error: error.message });
      return null;
    }
  }
}

export default FileAttachmentService;
