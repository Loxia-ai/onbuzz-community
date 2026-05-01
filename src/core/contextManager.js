/**
 * ContextManager - Handles context reference processing and file context integration
 * 
 * Purpose:
 * - Process context references (files, components, selections)
 * - Load and validate file content
 * - Generate context prompts for AI models
 * - Manage context size limits
 * - Handle context reference caching
 */

import { promises as fs } from 'fs';
import path from 'path';
import crypto from 'crypto';

class ContextManager {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    
    this.maxContextSize = config.context?.maxSize || 50000; // characters
    this.maxReferences = config.context?.maxReferences || 10;
    this.autoValidation = config.context?.autoValidation || true;
    this.cacheExpiry = config.context?.cacheExpiry || 3600; // seconds
    
    // Context cache
    this.contextCache = new Map();
    
    // File watchers for context validation
    this.fileWatchers = new Map();
  }

  /**
   * Process message with context references
   * @param {Object} message - Message object with contextReferences
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Enhanced message with context
   */
  async processMessageWithContext(message, projectDir) {
    if (!message.contextReferences || message.contextReferences.length === 0) {
      return message;
    }
    
    try {
      // Load and process context references
      const processedReferences = await this.loadContextReferences(
        message.contextReferences,
        projectDir
      );
      
      // Generate context prompt
      const contextPrompt = this.generateContextPrompt(processedReferences);
      
      // Combine context with original message
      const enhancedMessage = {
        ...message,
        content: contextPrompt + '\n\n' + message.content,
        originalContent: message.content,
        processedContextReferences: processedReferences,
        contextSize: contextPrompt.length
      };
      
      this.logger.info('Message enhanced with context', {
        originalLength: message.content.length,
        contextSize: contextPrompt.length,
        referencesCount: processedReferences.length,
        totalSize: enhancedMessage.content.length
      });
      
      return enhancedMessage;
      
    } catch (error) {
      this.logger.error(`Context processing failed: ${error.message}`, {
        referencesCount: message.contextReferences.length,
        error: error.stack
      });
      
      // Return original message with error info
      return {
        ...message,
        contextProcessingError: error.message,
        processedContextReferences: []
      };
    }
  }

  /**
   * Load and validate context references
   * @param {Array} references - Array of context reference objects
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Array>} Array of processed context references
   */
  async loadContextReferences(references, projectDir) {
    const loaded = [];
    let totalSize = 0;
    
    // Sort references by priority (file > component > selection)
    const sortedReferences = this.sortReferencesByPriority(references);
    
    for (const ref of sortedReferences.slice(0, this.maxReferences)) {
      try {
        const cacheKey = this.generateCacheKey(ref, projectDir);
        
        // Check cache first
        let loadedRef = this.getFromCache(cacheKey);
        
        if (!loadedRef || this.shouldRefreshCache(loadedRef)) {
          loadedRef = await this.loadSingleReference(ref, projectDir);
          this.addToCache(cacheKey, loadedRef);
        }
        
        // Check size limits
        if (totalSize + loadedRef.content.length > this.maxContextSize) {
          loadedRef.content = loadedRef.content.substring(
            0,
            this.maxContextSize - totalSize
          ) + '\n... [context truncated due to size limit]';
          loadedRef.truncated = true;
        }
        
        loaded.push(loadedRef);
        totalSize += loadedRef.content.length;
        
        if (totalSize >= this.maxContextSize) {
          this.logger.warn('Context size limit reached, stopping reference loading');
          break;
        }
        
      } catch (error) {
        this.logger.warn(`Failed to load context reference: ${error.message}`, {
          referenceType: ref.type,
          referencePath: ref.path || ref.name
        });
        
        loaded.push({
          ...ref,
          error: error.message,
          content: `[Error loading reference: ${error.message}]`,
          exists: false
        });
      }
    }
    
    return loaded;
  }

  /**
   * Load a single context reference
   * @param {Object} ref - Context reference object
   * @param {string} projectDir - Project directory path
   * @returns {Promise<Object>} Processed reference object
   */
  async loadSingleReference(ref, projectDir) {
    const startTime = Date.now();
    
    try {
      switch (ref.type) {
        case 'file':
          return await this.loadFileReference(ref, projectDir);
        
        case 'component':
          return await this.loadComponentReference(ref, projectDir);
        
        case 'selection':
          return await this.loadSelectionReference(ref, projectDir);
        
        case 'directory':
          return await this.loadDirectoryReference(ref, projectDir);
        
        default:
          throw new Error(`Unknown reference type: ${ref.type}`);
      }
      
    } finally {
      const loadTime = Date.now() - startTime;
      this.logger.debug(`Reference loaded in ${loadTime}ms`, {
        type: ref.type,
        path: ref.path || ref.name
      });
    }
  }

  /**
   * Load file reference
   * @private
   */
  async loadFileReference(ref, projectDir) {
    const fullPath = path.resolve(projectDir, ref.path);
    
    // Check file exists and get stats
    let stats;
    try {
      stats = await fs.stat(fullPath);
      if (!stats.isFile()) {
        throw new Error('Path is not a file');
      }
    } catch {
      throw new Error('File not found');
    }
    
    // Read file content
    let content = await fs.readFile(fullPath, 'utf8');
    
    // Apply line range if specified
    if (ref.lines && ref.lines.length > 0) {
      const lines = content.split('\n');
      const startLine = Math.max(0, (ref.lines[0] || 1) - 1);
      const endLine = Math.min(lines.length, ref.lines[1] || ref.lines[0] || lines.length);
      
      content = lines.slice(startLine, endLine).join('\n');
    }
    
    // Calculate checksum for change detection
    const checksum = this.calculateChecksum(content);
    
    return {
      ...ref,
      content,
      exists: true,
      lastModified: stats.mtime.toISOString(),
      fileSize: stats.size,
      checksum,
      hasChanged: ref.checksum && ref.checksum !== checksum,
      loadedAt: new Date().toISOString()
    };
  }

  /**
   * Load component reference
   * @private
   */
  async loadComponentReference(ref, projectDir) {
    const fullPath = path.resolve(projectDir, ref.file);
    
    try {
      const fileContent = await fs.readFile(fullPath, 'utf8');
      const componentInfo = await this.extractComponent(fileContent, ref.name, ref.startLine, ref.endLine);
      
      return {
        ...ref,
        content: componentInfo.content,
        exists: true,
        signature: componentInfo.signature,
        dependencies: componentInfo.dependencies,
        actualStartLine: componentInfo.startLine,
        actualEndLine: componentInfo.endLine,
        loadedAt: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`Component extraction failed: ${error.message}`);
    }
  }

  /**
   * Load selection reference
   * @private
   */
  async loadSelectionReference(ref, projectDir) {
    // Selection content is provided by user, validate against file if possible
    if (ref.file) {
      const fullPath = path.resolve(projectDir, ref.file);
      
      try {
        const fileContent = await fs.readFile(fullPath, 'utf8');
        const lines = fileContent.split('\n');
        
        if (ref.lines && ref.lines.length >= 2) {
          const startLine = Math.max(0, ref.lines[0] - 1);
          const endLine = Math.min(lines.length, ref.lines[1]);
          const fileSelection = lines.slice(startLine, endLine).join('\n');
          
          const selectionValid = this.compareSelections(ref.content, fileSelection);
          
          return {
            ...ref,
            exists: true,
            validated: selectionValid,
            currentFileContent: selectionValid ? null : fileSelection,
            loadedAt: new Date().toISOString()
          };
        }
      } catch {
        // File validation failed, use provided content
      }
    }
    
    return {
      ...ref,
      exists: true,
      validated: false,
      loadedAt: new Date().toISOString()
    };
  }

  /**
   * Load directory reference
   * @private
   */
  async loadDirectoryReference(ref, projectDir) {
    const fullPath = path.resolve(projectDir, ref.path);
    
    try {
      const stats = await fs.stat(fullPath);
      if (!stats.isDirectory()) {
        throw new Error('Path is not a directory');
      }
      
      const files = await fs.readdir(fullPath, { withFileTypes: true });
      const structure = files.map(file => ({
        name: file.name,
        type: file.isDirectory() ? 'directory' : 'file',
        isSymbolicLink: file.isSymbolicLink()
      }));
      
      // Generate directory listing content
      const content = this.generateDirectoryListing(ref.path, structure);
      
      return {
        ...ref,
        content,
        exists: true,
        structure,
        fileCount: files.filter(f => f.isFile()).length,
        directoryCount: files.filter(f => f.isDirectory()).length,
        loadedAt: new Date().toISOString()
      };
      
    } catch (error) {
      throw new Error(`Directory reading failed: ${error.message}`);
    }
  }

  /**
   * Generate context prompt from processed references
   * @param {Array} references - Array of processed context references
   * @returns {string} Generated context prompt
   */
  generateContextPrompt(references) {
    if (!references.length) return '';
    
    let prompt = '\n=== PROJECT CONTEXT REFERENCES ===\n';
    
    for (const ref of references) {
      if (ref.error) {
        prompt += `❌ ${ref.type.toUpperCase()}: ${ref.path || ref.name}\n`;
        prompt += `   Error: ${ref.error}\n\n`;
        continue;
      }
      
      const icon = this.getContextIcon(ref.type);
      prompt += `${icon} ${ref.type.toUpperCase()}: ${ref.path || ref.name}\n`;
      
      // Add metadata
      if (ref.lines && ref.lines.length > 0) {
        const lineRange = ref.lines.length === 1 
          ? `Line ${ref.lines[0]}` 
          : `Lines ${ref.lines[0]}-${ref.lines[1]}`;
        prompt += `   ${lineRange}\n`;
      }
      
      if (ref.description) {
        prompt += `   Description: ${ref.description}\n`;
      }
      
      if (ref.hasChanged) {
        prompt += `   ⚠️  File has changed since reference was created\n`;
      }
      
      if (ref.truncated) {
        prompt += `   ⚠️  Content truncated due to size limits\n`;
      }
      
      // Add content with appropriate syntax highlighting
      const language = this.getLanguageFromPath(ref.path || ref.file);
      prompt += `\n\`\`\`${language}\n`;
      prompt += ref.content;
      prompt += '\n```\n\n';
    }
    
    prompt += '=== END CONTEXT REFERENCES ===\n';
    return prompt;
  }

  /**
   * Extract component from file content
   * @private
   */
  async extractComponent(fileContent, componentName, startLine, endLine) {
    const lines = fileContent.split('\n');
    
    if (startLine && endLine) {
      // Use provided line range
      const content = lines.slice(startLine - 1, endLine).join('\n');
      return {
        content,
        startLine,
        endLine,
        signature: this.extractSignature(content, componentName),
        dependencies: this.extractDependencies(content)
      };
    }
    
    // Search for component by name
    const componentRegex = new RegExp(
      `(class\\s+${componentName}|function\\s+${componentName}|const\\s+${componentName}|export.*${componentName})`,
      'i'
    );
    
    let foundStartLine = -1;
    let foundEndLine = -1;
    let braceCount = 0;
    let inComponent = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      if (!inComponent && componentRegex.test(line)) {
        foundStartLine = i + 1;
        inComponent = true;
        
        // Count opening braces in this line
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;
        
        if (braceCount === 0 && line.includes(';')) {
          // Single line declaration
          foundEndLine = i + 1;
          break;
        }
        
        continue;
      }
      
      if (inComponent) {
        braceCount += (line.match(/\{/g) || []).length;
        braceCount -= (line.match(/\}/g) || []).length;
        
        if (braceCount <= 0) {
          foundEndLine = i + 1;
          break;
        }
      }
    }
    
    if (foundStartLine === -1) {
      throw new Error(`Component '${componentName}' not found in file`);
    }
    
    const content = lines.slice(foundStartLine - 1, foundEndLine).join('\n');
    
    return {
      content,
      startLine: foundStartLine,
      endLine: foundEndLine,
      signature: this.extractSignature(content, componentName),
      dependencies: this.extractDependencies(content)
    };
  }

  /**
   * Extract function/class signature
   * @private
   */
  extractSignature(content, name) {
    const lines = content.split('\n');
    const firstLine = lines[0].trim();
    
    // Try to extract a meaningful signature
    const signatureRegex = new RegExp(`(.*${name}[^{;]*)[{;]?`);
    const match = firstLine.match(signatureRegex);
    
    return match ? match[1].trim() : firstLine;
  }

  /**
   * Extract dependencies from content
   * @private
   */
  extractDependencies(content) {
    const dependencies = [];
    
    // Extract import statements
    const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }
    
    // Extract require statements
    const requireRegex = /require\(['"]([^'"]+)['"]\)/g;
    while ((match = requireRegex.exec(content)) !== null) {
      dependencies.push(match[1]);
    }
    
    return [...new Set(dependencies)]; // Remove duplicates
  }

  /**
   * Generate directory listing content
   * @private
   */
  generateDirectoryListing(dirPath, structure) {
    let content = `Directory: ${dirPath}\n\n`;
    
    const directories = structure.filter(item => item.type === 'directory');
    const files = structure.filter(item => item.type === 'file');
    
    if (directories.length > 0) {
      content += 'Directories:\n';
      for (const dir of directories) {
        content += `  📁 ${dir.name}${dir.isSymbolicLink ? ' (symlink)' : ''}\n`;
      }
      content += '\n';
    }
    
    if (files.length > 0) {
      content += 'Files:\n';
      for (const file of files) {
        const icon = this.getFileIcon(file.name);
        content += `  ${icon} ${file.name}${file.isSymbolicLink ? ' (symlink)' : ''}\n`;
      }
    }
    
    if (structure.length === 0) {
      content += '(empty directory)\n';
    }
    
    return content;
  }

  /**
   * Sort references by priority
   * @private
   */
  sortReferencesByPriority(references) {
    const priorityOrder = { file: 1, component: 2, selection: 3, directory: 4 };
    
    return [...references].sort((a, b) => {
      const aPriority = priorityOrder[a.type] || 999;
      const bPriority = priorityOrder[b.type] || 999;
      return aPriority - bPriority;
    });
  }

  /**
   * Get context icon for reference type
   * @private
   */
  getContextIcon(type) {
    const icons = {
      file: '📄',
      component: '🔧',
      selection: '✂️',
      directory: '📁'
    };
    return icons[type] || '📎';
  }

  /**
   * Get file icon based on extension
   * @private
   */
  getFileIcon(filename) {
    const ext = path.extname(filename).toLowerCase();
    const icons = {
      '.js': '📜',
      '.jsx': '⚛️',
      '.ts': '📘',
      '.tsx': '⚛️',
      '.py': '🐍',
      '.java': '☕',
      '.html': '🌐',
      '.css': '🎨',
      '.json': '📋',
      '.md': '📝',
      '.yml': '⚙️',
      '.yaml': '⚙️'
    };
    return icons[ext] || '📄';
  }

  /**
   * Get language identifier from file path
   * @private
   */
  getLanguageFromPath(filePath) {
    if (!filePath) return '';
    
    const ext = path.extname(filePath).toLowerCase();
    const langMap = {
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.py': 'python',
      '.java': 'java',
      '.cpp': 'cpp',
      '.c': 'c',
      '.cs': 'csharp',
      '.php': 'php',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.html': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.json': 'json',
      '.yml': 'yaml',
      '.yaml': 'yaml',
      '.md': 'markdown',
      '.xml': 'xml',
      '.sql': 'sql'
    };
    
    return langMap[ext] || '';
  }

  /**
   * Calculate content checksum
   * @private
   */
  calculateChecksum(content) {
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 16);
  }

  /**
   * Compare two code selections
   * @private
   */
  compareSelections(selection1, selection2) {
    // Normalize whitespace and compare
    const normalize = str => str.replace(/\s+/g, ' ').trim();
    return normalize(selection1) === normalize(selection2);
  }

  /**
   * Generate cache key for reference
   * @private
   */
  generateCacheKey(ref, projectDir) {
    const keyData = {
      type: ref.type,
      path: ref.path || ref.file,
      lines: ref.lines,
      name: ref.name,
      projectDir
    };
    
    return crypto.createHash('md5').update(JSON.stringify(keyData)).digest('hex');
  }

  /**
   * Get reference from cache
   * @private
   */
  getFromCache(cacheKey) {
    const cached = this.contextCache.get(cacheKey);
    if (!cached) return null;
    
    return cached.data;
  }

  /**
   * Add reference to cache
   * @private
   */
  addToCache(cacheKey, data) {
    this.contextCache.set(cacheKey, {
      data,
      timestamp: Date.now()
    });
    
    // Clean up old cache entries
    this.cleanupCache();
  }

  /**
   * Check if cached reference should be refreshed
   * @private
   */
  shouldRefreshCache(cachedRef) {
    if (!this.autoValidation) return false;
    
    const age = (Date.now() - new Date(cachedRef.loadedAt).getTime()) / 1000;
    return age > this.cacheExpiry;
  }

  /**
   * Clean up expired cache entries
   * @private
   */
  cleanupCache() {
    const now = Date.now();
    const expiredKeys = [];
    
    for (const [key, cached] of this.contextCache.entries()) {
      if (now - cached.timestamp > this.cacheExpiry * 1000) {
        expiredKeys.push(key);
      }
    }
    
    for (const key of expiredKeys) {
      this.contextCache.delete(key);
    }
  }
}

export default ContextManager;