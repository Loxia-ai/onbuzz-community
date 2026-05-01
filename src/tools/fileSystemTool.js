/**
 * FileSystemTool - Handle file system operations safely
 * 
 * Purpose:
 * - Read, write, and manipulate files
 * - Directory operations
 * - File metadata and permissions
 * - Safe file operations with validation
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import DirectoryAccessManager from '../utilities/directoryAccessManager.js';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

import {
  TOOL_STATUS,
  FILE_EXTENSIONS,
  SYSTEM_DEFAULTS
} from '../utilities/constants.js';
import { validateForToolResponse } from '../utilities/structuredFileValidator.js';
import { createTruncationNotice, getFileExtension } from '../utilities/jsonRepair.js';

class FileSystemTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);
    
    // Tool metadata
    this.requiresProject = true;
    this.isAsync = false; // Most file operations are quick
    this.timeout = config.timeout || 30000; // 30 seconds
    this.maxConcurrentOperations = config.maxConcurrentOperations || 5;
    
    // Security settings
    this.maxFileSize = config.maxFileSize || SYSTEM_DEFAULTS.MAX_FILE_SIZE;
    this.allowedExtensions = config.allowedExtensions || null; // null = all allowed
    this.blockedExtensions = config.blockedExtensions || ['.exe', '.scr', '.com'];
    this.allowedDirectories = config.allowedDirectories || null; // null = project dir only

    // Post-write validation for structured files (JSON, YAML, XML, etc.)
    // When enabled, validates structured files after writing and includes result in response
    this.validateStructuredFiles = config.validateStructuredFiles !== false; // enabled by default

    // File operation history
    this.operationHistory = [];
    
    // Directory access manager
    this.directoryAccessManager = new DirectoryAccessManager(config, logger);
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
File System Tool: Perform file and directory operations safely within the project scope.

USAGE:
\`\`\`json
{
  "toolId": "filesystem",
  "actions": [
    {"type": "read", "filePath": "src/index.js"},
    {"type": "write", "outputPath": "src/file.js", "content": "..."}
  ]
}
\`\`\`

TIP: For exploring large or unfamiliar files, prefer the code-map tool (skeleton + read-range) to understand structure without reading entire files. Use filesystem read when you need the complete file content.

SUPPORTED ACTIONS:
- read: Read file contents (filePath)
- write: Write content to file (outputPath, content)
- append: Append content to existing file (filePath, content)
- delete: Delete a file (filePath)
- copy: Copy file (sourcePath, destPath)
- move: Move/rename file (sourcePath, destPath)
- create-dir: Create directory (directory)
- list: List directory contents (directory)
- exists: Check if file/directory exists (filePath)
- stats: Get file/directory metadata (filePath)

PARAMETERS:
- filePath: Path to file (for read, delete, append, exists, stats)
- outputPath: Path where to write/create file
- sourcePath: Source path for copy/move operations
- destPath: Destination path for copy/move operations
- directory: Directory path for create-dir and list operations
- content: Content to write/append
- encoding: File encoding (default: utf8)
- createDirs: Create parent directories if they don't exist (true/false)

EXAMPLES:

Write a file:
\`\`\`json
{
  "toolId": "filesystem",
  "actions": [{"type": "write", "outputPath": "hello.js", "content": "console.log('Hello');"}]
}
\`\`\`

Read a file:
\`\`\`json
{
  "toolId": "filesystem",
  "actions": [{"type": "read", "filePath": "package.json"}]
}
\`\`\`

Multiple operations:
\`\`\`json
{
  "toolId": "filesystem",
  "actions": [
    {"type": "read", "filePath": "src/index.js"},
    {"type": "copy", "sourcePath": "template.js", "destPath": "src/component.js"},
    {"type": "create-dir", "directory": "src/components/ui"}
  ]
}
\`\`\`

SECURITY:
- Operations restricted to project directory
- File size limits enforced (max ${Math.round(this.maxFileSize / 1024 / 1024)}MB)
- Dangerous file types blocked
- Path traversal protection
    `;
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    try {
      const params = {};
      const actions = [];
      
      this.logger?.debug('FileSystem tool parsing parameters', {
        contentLength: content.length,
        contentPreview: content.substring(0, 200)
      });
      
      // Extract self-closing tags (read, delete, copy, etc.)
      const selfClosingTags = [
        'read', 'delete', 'copy', 'move', 'create-dir', 
        'list', 'exists', 'stats', 'append'
      ];
      
      for (const tagName of selfClosingTags) {
        const tags = TagParser.extractTagsWithAttributes(content, tagName);
        for (const tag of tags) {
          const action = {
            type: tagName,
            ...tag.attributes
          };
          
          // Normalize common attribute names
          if (action['file-path']) {
            action.filePath = action['file-path'];
            delete action['file-path'];
          }
          if (action['output-path']) {
            action.outputPath = action['output-path'];
            delete action['output-path'];
          }
          if (action['source-path']) {
            action.sourcePath = action['source-path'];
            delete action['source-path'];
          }
          if (action['dest-path']) {
            action.destPath = action['dest-path'];
            delete action['dest-path'];
          }
          if (action['create-dirs']) {
            action.createDirs = action['create-dirs'] === 'true';
            delete action['create-dirs'];
          }
          
          actions.push(action);
        }
      }
      
      // Extract write and append tags with content
      const writeMatches = content.matchAll(/<write\s+([^>]*)>(.*?)<\/write>/gs);
      for (const match of writeMatches) {
        const parser = new TagParser();
        const attributes = parser.parseAttributes(match[1]);
        const writeContent = match[2].trim();
        
        const action = {
          type: 'write',
          content: writeContent,
          ...attributes
        };
        
        // Normalize attribute names
        if (action['output-path']) {
          action.outputPath = action['output-path'];
          delete action['output-path'];
        }
        if (action['create-dirs']) {
          action.createDirs = action['create-dirs'] === 'true';
          delete action['create-dirs'];
        }
        
        actions.push(action);
      }
      
      const appendMatches = content.matchAll(/<append\s+([^>]*)>(.*?)<\/append>/gs);
      for (const match of appendMatches) {
        const parser = new TagParser();
        const attributes = parser.parseAttributes(match[1]);
        const appendContent = match[2].trim();
        
        const action = {
          type: 'append',
          content: appendContent,
          ...attributes
        };
        
        // Normalize attribute names
        if (action['file-path']) {
          action.filePath = action['file-path'];
          delete action['file-path'];
        }
        
        actions.push(action);
      }
      
      params.actions = actions;
      params.rawContent = content.trim();
      
      this.logger?.debug('Parsed FileSystem tool parameters', {
        totalActions: actions.length,
        actionTypes: actions.map(a => a.type),
        actions: actions.map(a => ({ 
          type: a.type, 
          filePath: a.filePath, 
          outputPath: a.outputPath,
          hasContent: !!a.content 
        }))
      });
      
      return params;
      
    } catch (error) {
      throw new Error(`Failed to parse filesystem parameters: ${error.message}`);
    }
  }

  /**
   * Get required parameters
   * @returns {Array<string>} Array of required parameter names
   */
  getRequiredParameters() {
    return ['actions'];
  }

  /**
   * Custom parameter validation
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    const errors = [];
    
    if (!params.actions || !Array.isArray(params.actions) || params.actions.length === 0) {
      errors.push('At least one action is required');
    } else {
      // Validate each action
      for (const [index, action] of params.actions.entries()) {
        if (!action.type) {
          errors.push(`Action ${index + 1}: type is required`);
          continue;
        }
        
        switch (action.type) {
          case 'read':
          case 'delete':
          case 'exists':
          case 'stats':
            if (!action.filePath) {
              errors.push(`Action ${index + 1}: file-path is required for ${action.type}`);
            }
            break;
            
          case 'write':
            if (!action.outputPath) {
              errors.push(`Action ${index + 1}: output-path is required for write`);
            }
            // Content validation with detailed diagnostics
            if (action.content === undefined) {
              errors.push(`Action ${index + 1}: content is undefined for write (outputPath: ${action.outputPath || 'not set'})`);
              console.error('[FileSystemTool] Write validation failed: content is undefined', {
                outputPath: action.outputPath,
                actionKeys: Object.keys(action)
              });
            } else if (action.content === null) {
              errors.push(`Action ${index + 1}: content is null for write (outputPath: ${action.outputPath || 'not set'})`);
              console.error('[FileSystemTool] Write validation failed: content is null', {
                outputPath: action.outputPath
              });
            } else if (typeof action.content !== 'string') {
              errors.push(`Action ${index + 1}: content must be a string, got ${typeof action.content}`);
              console.error('[FileSystemTool] Write validation failed: content is not a string', {
                outputPath: action.outputPath,
                contentType: typeof action.content
              });
            }
            // Note: empty string content is allowed (creates empty file)
            break;

          case 'append':
            if (!action.filePath) {
              errors.push(`Action ${index + 1}: file-path is required for append`);
            }
            // Content validation with detailed diagnostics
            if (action.content === undefined) {
              errors.push(`Action ${index + 1}: content is undefined for append (filePath: ${action.filePath || 'not set'})`);
              console.error('[FileSystemTool] Append validation failed: content is undefined', {
                filePath: action.filePath,
                actionKeys: Object.keys(action)
              });
            } else if (action.content === null) {
              errors.push(`Action ${index + 1}: content is null for append (filePath: ${action.filePath || 'not set'})`);
              console.error('[FileSystemTool] Append validation failed: content is null', {
                filePath: action.filePath
              });
            } else if (typeof action.content !== 'string') {
              errors.push(`Action ${index + 1}: content must be a string, got ${typeof action.content}`);
              console.error('[FileSystemTool] Append validation failed: content is not a string', {
                filePath: action.filePath,
                contentType: typeof action.content
              });
            } else if (action.content.length === 0) {
              // Empty append is suspicious - log a warning but allow it
              console.warn('[FileSystemTool] Append with empty content', {
                filePath: action.filePath
              });
            }
            break;
            
          case 'copy':
          case 'move':
            if (!action.sourcePath) {
              errors.push(`Action ${index + 1}: source-path is required for ${action.type}`);
            }
            if (!action.destPath) {
              errors.push(`Action ${index + 1}: dest-path is required for ${action.type}`);
            }
            break;
            
          case 'create-dir':
          case 'list':
            if (!action.directory) {
              errors.push(`Action ${index + 1}: directory is required for ${action.type}`);
            }
            break;
            
          default:
            errors.push(`Action ${index + 1}: unknown action type: ${action.type}`);
        }
        
        // Validate file extensions if specified
        if (action.filePath && !this.isAllowedFileExtension(action.filePath)) {
          errors.push(`Action ${index + 1}: file type not allowed: ${path.extname(action.filePath)}`);
        }
        if (action.outputPath && !this.isAllowedFileExtension(action.outputPath)) {
          errors.push(`Action ${index + 1}: file type not allowed: ${path.extname(action.outputPath)}`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object} params - Parsed parameters
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context) {
    // Validate params structure
    if (!params || typeof params !== 'object') {
      throw new Error('Invalid parameters: params must be an object');
    }

    const { actions } = params;

    // Validate actions array
    if (!actions) {
      throw new Error('Invalid parameters: actions is required. Received params: ' + JSON.stringify(Object.keys(params)));
    }

    if (!Array.isArray(actions)) {
      throw new Error('Invalid parameters: actions must be an array. Received type: ' + typeof actions);
    }

    if (actions.length === 0) {
      throw new Error('Invalid parameters: actions array is empty');
    }

    // CRITICAL: Run custom validation (not called by messageProcessor)
    // This ensures write/append actions have required content
    const validation = this.customValidateParameters(params);
    if (!validation.valid) {
      const errorMsg = validation.errors?.join('; ') || validation.error || 'Validation failed';
      console.error('[FileSystemTool] Parameter validation failed:', errorMsg);
      throw new Error(`Parameter validation failed: ${errorMsg}`);
    }

    const { projectDir, agentId, directoryAccess } = context;

    // Per-agent config overrides (agent.toolConfig.filesystem) merged
    // with this tool's global defaults. Applied per-action at the top of
    // the execute loop — every action that touches a file path is
    // gated against the effective extension policy, and write/append
    // payloads are size-gated against the effective maxFileSize.
    const effectiveFs = this.getEffectiveConfig(context, {
      allowedExtensions: this.allowedExtensions,
      blockedExtensions: this.blockedExtensions,
      maxFileSize: this.maxFileSize,
    });
    const effectiveBlockedExt = Array.isArray(effectiveFs.blockedExtensions)
      ? effectiveFs.blockedExtensions.map(e => String(e).toLowerCase())
      : [];
    const effectiveAllowedExt = (Array.isArray(effectiveFs.allowedExtensions) && effectiveFs.allowedExtensions.length > 0)
      ? effectiveFs.allowedExtensions.map(e => String(e).toLowerCase())
      : null;
    const effectiveMaxFileSize = (typeof effectiveFs.maxFileSize === 'number' && effectiveFs.maxFileSize > 0)
      ? effectiveFs.maxFileSize
      : this.maxFileSize;

    const _checkExt = (filePath) => {
      if (!filePath) return null;
      const ext = (filePath.match(/\.[^./\\]+$/)?.[0] || '').toLowerCase();
      if (effectiveBlockedExt.includes(ext)) {
        return `File extension ${ext || '(none)'} is blocked by agent policy: ${filePath}`;
      }
      if (effectiveAllowedExt && !effectiveAllowedExt.includes(ext)) {
        return `File extension ${ext || '(none)'} is not in the agent's allowed list: ${filePath}`;
      }
      return null;
    };

    // Get directory access configuration from agent or create default
    const accessConfig = directoryAccess ||
      this.directoryAccessManager.createDirectoryAccess({
        workingDirectory: projectDir || process.cwd(),
        writeEnabledDirectories: [projectDir || process.cwd()],
        restrictToProject: true
      });
    
    // IMPORTANT: If the agent has directoryAccess configured, use its workingDirectory
    // This ensures UI-configured project directories are respected
    if (directoryAccess && directoryAccess.workingDirectory) {
      // Agent has explicitly configured working directory from UI - use it
      console.log('FileSystem DEBUG: Using agent configured working directory:', directoryAccess.workingDirectory);
      console.log('FileSystem DEBUG: Full directoryAccess object:', JSON.stringify(directoryAccess, null, 2));
    } else {
      // Using fallback to projectDir or process.cwd()
      console.log('FileSystem DEBUG: Using fallback working directory:', projectDir || process.cwd());
      console.log('FileSystem DEBUG: directoryAccess is:', directoryAccess);
      console.log('FileSystem DEBUG: projectDir is:', projectDir);
    }
    
    const results = [];
    
    for (const action of actions) {
      try {
        // Per-agent extension policy gate — runs BEFORE the action so
        // disallowed file types never reach the filesystem layer. Terminal
        // and web tools use the same short-circuit pattern.
        const pathsToCheck = [action.filePath, action.outputPath].filter(Boolean);
        for (const p of pathsToCheck) {
          const err = _checkExt(p);
          if (err) {
            results.push({ success: false, action: action.type, error: err });
            throw new Error('__skip');
          }
        }
        // Per-agent maxFileSize gate for write/append — fires ONLY when
        // the agent explicitly overrides maxFileSize via toolConfig. When
        // the agent has no override, the existing `this.maxFileSize`
        // check downstream handles it with its original error message,
        // preserving backward compatibility. Read-side and stat-based
        // size checks still use `this.maxFileSize` at deeper call sites.
        const perAgentMaxFileSize = (typeof context?.toolConfig?.maxFileSize === 'number' && context.toolConfig.maxFileSize > 0)
          ? context.toolConfig.maxFileSize
          : null;
        if (perAgentMaxFileSize != null
            && (action.type === 'write' || action.type === 'append')
            && typeof action.content === 'string') {
          const payloadBytes = Buffer.byteLength(action.content, 'utf8');
          if (payloadBytes > perAgentMaxFileSize) {
            results.push({
              success: false,
              action: action.type,
              error: `Content too large: ${payloadBytes} bytes exceeds per-agent maxFileSize (${perAgentMaxFileSize})`,
            });
            throw new Error('__skip');
          }
        }

        let result;

        switch (action.type) {
          case 'read':
            result = await this.readFile(action.filePath, accessConfig, action.encoding);
            break;

          case 'write':
            result = await this.writeFile(action.outputPath, action.content, accessConfig, {
              encoding: action.encoding,
              createDirs: action.createDirs,
              wasTruncated: context.wasTruncated || false
            });
            break;
            
          case 'append':
            result = await this.appendToFile(action.filePath, action.content, accessConfig, action.encoding);
            break;
            
          case 'delete':
            result = await this.deleteFile(action.filePath, accessConfig);
            break;
            
          case 'copy':
            result = await this.copyFile(action.sourcePath, action.destPath, accessConfig);
            break;
            
          case 'move':
            result = await this.moveFile(action.sourcePath, action.destPath, accessConfig);
            break;
            
          case 'create-dir':
            result = await this.createDirectory(action.directory, accessConfig);
            break;
            
          case 'list':
            result = await this.listDirectory(action.directory, accessConfig);
            break;
            
          case 'exists':
            result = await this.checkExists(action.filePath, accessConfig);
            break;
            
          case 'stats':
            result = await this.getFileStats(action.filePath, accessConfig);
            break;
            
          default:
            throw new Error(`Unknown action type: ${action.type}`);
        }
        
        results.push(result);
        this.addToHistory(action, result, context.agentId);
        
      } catch (error) {
        // Per-agent policy gate above uses "__skip" to signal that it
        // already pushed a useful error onto results — don't double-log
        // or double-push.
        if (error.message === '__skip') {
          this.addToHistory(action, results[results.length - 1], context.agentId);
          continue;
        }

        // Log detailed error for debugging
        console.error(`[FileSystemTool] Action '${action.type}' failed:`, {
          action: action.type,
          filePath: action.filePath || action.outputPath || action.directory,
          error: error.message,
          stack: error.stack?.split('\n').slice(0, 3).join('\n'),
          contentLength: action.content?.length,
          hasContent: action.content !== undefined && action.content !== null
        });

        const errorResult = {
          success: false,
          action: action.type,
          error: error.message,
          filePath: action.filePath || action.outputPath || action.directory,
          // Include debug info for troubleshooting
          debug: {
            contentProvided: action.content !== undefined && action.content !== null,
            contentLength: action.content?.length || 0,
            contentPreview: action.content ? action.content.substring(0, 100) + (action.content.length > 100 ? '...' : '') : null
          }
        };

        results.push(errorResult);
        this.addToHistory(action, errorResult, context.agentId);
      }
    }
    
    // Determine overall success - only true if ALL actions succeeded
    const allSucceeded = results.every(r => r.success === true);
    const failedCount = results.filter(r => r.success === false).length;

    return {
      success: allSucceeded,
      actions: results,
      executedActions: actions.length,
      successfulActions: actions.length - failedCount,
      failedActions: failedCount,
      toolUsed: 'filesys',
      ...(failedCount > 0 && {
        warning: `${failedCount} of ${actions.length} action(s) failed. Check individual action results for details.`
      })
    };
  }

  /**
   * Read file contents
   * @private
   */
  async readFile(filePath, accessConfig, encoding = 'utf8') {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullPath = this.resolvePath(filePath, workingDir);
    
    // Validate read access using DirectoryAccessManager
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason} (${accessResult.path})`);
    }
    
    try {
      const stats = await fs.stat(fullPath);
      
      if (stats.size > this.maxFileSize) {
        throw new Error(`File too large: ${stats.size} bytes (max ${this.maxFileSize})`);
      }
      
      const content = await fs.readFile(fullPath, encoding);
      
      return {
        success: true,
        action: 'read',
        filePath: this.directoryAccessManager.createRelativePath(fullPath, accessConfig),
        content,
        size: stats.size,
        encoding,
        lastModified: stats.mtime.toISOString(),
        message: `Read ${stats.size} bytes from ${filePath}`
      };
      
    } catch (error) {
      throw new Error(`Failed to read file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Write content to file
   * @private
   */
  async writeFile(outputPath, content, accessConfig, options = {}) {
    const { encoding = 'utf8', createDirs = true, wasTruncated = false } = options;
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullPath = this.resolvePath(outputPath, workingDir);

    // Validate write access using DirectoryAccessManager
    const accessResult = this.directoryAccessManager.validateWriteAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Write access denied: ${accessResult.reason} (${accessResult.path})`);
    }

    // Handle truncated content - append notice if AI response was cut off
    let finalContent = content;
    let truncationApplied = false;

    if (wasTruncated && content) {
      const fileExt = getFileExtension(outputPath);
      const truncationNotice = createTruncationNotice(fileExt);
      if (truncationNotice) {
        finalContent = content + truncationNotice;
        truncationApplied = true;
        console.log(`[FileSystemTool] Appending truncation notice to ${outputPath} (AI response was truncated)`);
      }
    }

    try {
      // Check content size
      const contentSize = Buffer.byteLength(finalContent, encoding);
      if (contentSize > this.maxFileSize) {
        throw new Error(`Content too large: ${contentSize} bytes (max ${this.maxFileSize})`);
      }

      // Create parent directories if requested
      if (createDirs) {
        const dirPath = path.dirname(fullPath);
        await fs.mkdir(dirPath, { recursive: true });
      }

      // Create backup if file exists
      let backupPath = null;
      try {
        await fs.access(fullPath);
        backupPath = `${fullPath}.backup-${Date.now()}`;
        await fs.copyFile(fullPath, backupPath);
      } catch {
        // File doesn't exist, no backup needed
      }

      await fs.writeFile(fullPath, finalContent, encoding);

      // VERIFICATION: Confirm file was written correctly
      const stats = await fs.stat(fullPath);

      // Verify file size matches expected content size
      const expectedSize = Buffer.byteLength(finalContent, encoding);
      if (stats.size !== expectedSize) {
        throw new Error(`Write verification failed: expected ${expectedSize} bytes but file is ${stats.size} bytes`);
      }

      // For text files, verify content was written (read back and compare hash)
      if (encoding === 'utf8' || encoding === 'utf-8') {
        const writtenContent = await fs.readFile(fullPath, encoding);
        if (writtenContent !== finalContent) {
          throw new Error(`Write verification failed: content mismatch after write`);
        }
      }

      const relativePath = this.directoryAccessManager.createRelativePath(fullPath, accessConfig);

      // Build base result
      const result = {
        success: true,
        action: 'write',
        outputPath: relativePath,
        fullPath: fullPath,
        size: stats.size,
        encoding,
        verified: true, // Content was verified after write
        backupPath: backupPath ? this.directoryAccessManager.createRelativePath(backupPath, accessConfig) : null,
        backupFullPath: backupPath || null,
        message: `Wrote ${stats.size} bytes to ${fullPath} (verified)`,
        // Include truncation info if applicable
        ...(truncationApplied && {
          wasTruncated: true,
          truncationWarning: 'Content was truncated due to AI response token limit. A notice was appended to the file.'
        }),
        // Warn if content is empty
        ...(stats.size === 0 && {
          emptyContent: true,
          emptyWarning: 'File was written with empty content'
        })
      };

      // Add truncation warning to message
      if (truncationApplied) {
        result.message += ' [PARTIAL: AI response was truncated - content may be incomplete]';
      }

      // Post-write validation for structured files (plug-and-play via structuredFileValidator)
      if (this.validateStructuredFiles) {
        const validation = validateForToolResponse(content, fullPath);
        if (validation) {
          result.validation = validation;
          // Add warning to message if validation failed
          if (!validation.valid) {
            result.message += ` [WARNING: ${validation.format.toUpperCase()} validation failed with ${validation.errorCount} error(s)]`;
          }
        }
      }

      return result;
      
    } catch (error) {
      throw new Error(`Failed to write file ${fullPath}: ${error.message}`);
    }
  }

  /**
   * Append content to file
   * @private
   */
  async appendToFile(filePath, content, accessConfig, encoding = 'utf8') {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullPath = this.resolvePath(filePath, workingDir);
    
    // Validate write access using DirectoryAccessManager
    const accessResult = this.directoryAccessManager.validateWriteAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Write access denied: ${accessResult.reason} (${accessResult.path})`);
    }
    
    try {
      // Check if file exists and get current size
      let currentSize = 0;
      try {
        const stats = await fs.stat(fullPath);
        currentSize = stats.size;
      } catch {
        // File doesn't exist, will be created
      }
      
      const contentSize = Buffer.byteLength(content, encoding);
      if (currentSize + contentSize > this.maxFileSize) {
        throw new Error(`File would become too large: ${currentSize + contentSize} bytes (max ${this.maxFileSize})`);
      }
      
      // Store size before append for verification
      const sizeBefore = currentSize;

      await fs.appendFile(fullPath, content, encoding);

      const stats = await fs.stat(fullPath);
      const relativePath = this.directoryAccessManager.createRelativePath(fullPath, accessConfig);

      // VERIFICATION: Confirm append actually happened
      const expectedSize = sizeBefore + contentSize;
      if (stats.size < expectedSize) {
        throw new Error(`Append verification failed: expected at least ${expectedSize} bytes but file is ${stats.size} bytes`);
      }

      // For text files, verify the appended content is at the end
      if (encoding === 'utf8' || encoding === 'utf-8') {
        const fileContent = await fs.readFile(fullPath, encoding);
        if (!fileContent.endsWith(content)) {
          throw new Error(`Append verification failed: appended content not found at end of file`);
        }
      }

      return {
        success: true,
        action: 'append',
        filePath: relativePath,
        fullPath: fullPath,
        appendedBytes: contentSize,
        totalSize: stats.size,
        sizeBefore: sizeBefore,
        encoding,
        verified: true,
        message: `Appended ${contentSize} bytes to ${fullPath} (verified)`
      };
      
    } catch (error) {
      throw new Error(`Failed to append to file ${fullPath}: ${error.message}`);
    }
  }

  /**
   * Delete file
   * @private
   */
  async deleteFile(filePath, accessConfig) {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullPath = this.resolvePath(filePath, workingDir);
    
    // Validate write access for deletion
    const accessResult = this.directoryAccessManager.validateWriteAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Delete access denied: ${accessResult.reason} (${accessResult.path})`);
    }
    
    try {
      const stats = await fs.stat(fullPath);
      
      // Create backup before deletion
      const backupPath = `${fullPath}.deleted-backup-${Date.now()}`;
      await fs.copyFile(fullPath, backupPath);
      
      await fs.unlink(fullPath);
      
      const relativePath = this.directoryAccessManager.createRelativePath(fullPath, accessConfig);
      const backupRelativePath = this.directoryAccessManager.createRelativePath(backupPath, accessConfig);
      
      return {
        success: true,
        action: 'delete',
        filePath: relativePath,
        fullPath: fullPath,
        size: stats.size,
        backupPath: backupRelativePath,
        backupFullPath: backupPath,
        message: `Deleted ${fullPath} (backup created)`
      };
      
    } catch (error) {
      throw new Error(`Failed to delete file ${fullPath}: ${error.message}`);
    }
  }

  /**
   * Copy file
   * @private
   */
  async copyFile(sourcePath, destPath, accessConfig) {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullSourcePath = this.resolvePath(sourcePath, workingDir);
    const fullDestPath = this.resolvePath(destPath, workingDir);
    
    // Validate read access for source
    const sourceAccessResult = this.directoryAccessManager.validateReadAccess(fullSourcePath, accessConfig);
    if (!sourceAccessResult.allowed) {
      throw new Error(`Source read access denied: ${sourceAccessResult.reason} (${sourceAccessResult.path})`);
    }
    
    // Validate write access for destination
    const destAccessResult = this.directoryAccessManager.validateWriteAccess(fullDestPath, accessConfig);
    if (!destAccessResult.allowed) {
      throw new Error(`Destination write access denied: ${destAccessResult.reason} (${destAccessResult.path})`);
    }
    
    try {
      const sourceStats = await fs.stat(fullSourcePath);
      
      if (sourceStats.size > this.maxFileSize) {
        throw new Error(`Source file too large: ${sourceStats.size} bytes`);
      }
      
      // Create destination directory if needed
      const destDir = path.dirname(fullDestPath);
      await fs.mkdir(destDir, { recursive: true });
      
      await fs.copyFile(fullSourcePath, fullDestPath);
      
      const sourceRelativePath = this.directoryAccessManager.createRelativePath(fullSourcePath, accessConfig);
      const destRelativePath = this.directoryAccessManager.createRelativePath(fullDestPath, accessConfig);
      
      return {
        success: true,
        action: 'copy',
        sourcePath: sourceRelativePath,
        destPath: destRelativePath,
        sourceFullPath: fullSourcePath,
        destFullPath: fullDestPath,
        size: sourceStats.size,
        message: `Copied ${fullSourcePath} to ${fullDestPath}`
      };
      
    } catch (error) {
      throw new Error(`Failed to copy ${fullSourcePath} to ${fullDestPath}: ${error.message}`);
    }
  }

  /**
   * Move/rename file
   * @private
   */
  async moveFile(sourcePath, destPath, accessConfig) {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullSourcePath = this.resolvePath(sourcePath, workingDir);
    const fullDestPath = this.resolvePath(destPath, workingDir);

    // Validate read access for source
    const readResult = this.directoryAccessManager.validateReadAccess(fullSourcePath, accessConfig);
    if (!readResult.allowed) {
      throw new Error(`Read access denied for source: ${readResult.reason} (${readResult.path})`);
    }

    // Validate write access for destination
    const writeResult = this.directoryAccessManager.validateWriteAccess(fullDestPath, accessConfig);
    if (!writeResult.allowed) {
      throw new Error(`Write access denied for destination: ${writeResult.reason} (${writeResult.path})`);
    }

    try {
      const sourceStats = await fs.stat(fullSourcePath);

      // Create destination directory if needed
      const destDir = path.dirname(fullDestPath);
      await fs.mkdir(destDir, { recursive: true });

      await fs.rename(fullSourcePath, fullDestPath);

      const relativeSource = this.directoryAccessManager.createRelativePath(fullSourcePath, accessConfig);
      const relativeDest = this.directoryAccessManager.createRelativePath(fullDestPath, accessConfig);

      return {
        success: true,
        action: 'move',
        sourcePath: relativeSource,
        destPath: relativeDest,
        fullSourcePath: fullSourcePath,
        fullDestPath: fullDestPath,
        size: sourceStats.size,
        message: `Moved ${sourcePath} to ${destPath}`
      };

    } catch (error) {
      throw new Error(`Failed to move ${sourcePath} to ${destPath}: ${error.message}`);
    }
  }

  /**
   * Create directory
   * @private
   */
  async createDirectory(directory, accessConfig) {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullPath = this.resolvePath(directory, workingDir);

    // Validate write access using DirectoryAccessManager
    const accessResult = this.directoryAccessManager.validateWriteAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Write access denied: ${accessResult.reason} (${accessResult.path})`);
    }

    try {
      await fs.mkdir(fullPath, { recursive: true });

      const relativePath = this.directoryAccessManager.createRelativePath(fullPath, accessConfig);

      return {
        success: true,
        action: 'create-dir',
        directory: relativePath,
        fullPath: fullPath,
        message: `Created directory ${directory}`
      };

    } catch (error) {
      throw new Error(`Failed to create directory ${directory}: ${error.message}`);
    }
  }

  /**
   * List directory contents
   * @private
   */
  async listDirectory(directory, accessConfig) {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullPath = this.resolvePath(directory, workingDir);

    // Validate read access using DirectoryAccessManager
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason} (${accessResult.path})`);
    }

    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });

      const contents = [];
      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry.name);
        const stats = await fs.stat(entryPath);

        contents.push({
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isFile() ? stats.size : undefined,
          lastModified: stats.mtime.toISOString(),
          permissions: stats.mode,
          isSymlink: entry.isSymbolicLink()
        });
      }

      const relativePath = this.directoryAccessManager.createRelativePath(fullPath, accessConfig);

      return {
        success: true,
        action: 'list',
        directory: relativePath,
        fullPath: fullPath,
        contents,
        totalItems: contents.length,
        directories: contents.filter(item => item.type === 'directory').length,
        files: contents.filter(item => item.type === 'file').length,
        message: `Listed ${contents.length} items in ${directory}`
      };

    } catch (error) {
      throw new Error(`Failed to list directory ${directory}: ${error.message}`);
    }
  }

  /**
   * Check if file/directory exists
   * @private
   */
  async checkExists(filePath, accessConfig) {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullPath = this.resolvePath(filePath, workingDir);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason} (${accessResult.path})`);
    }

    try {
      const stats = await fs.stat(fullPath);

      const relativePath = this.directoryAccessManager.createRelativePath(fullPath, accessConfig);

      return {
        success: true,
        action: 'exists',
        filePath: relativePath,
        fullPath: fullPath,
        exists: true,
        type: stats.isDirectory() ? 'directory' : 'file',
        message: `${filePath} exists as ${stats.isDirectory() ? 'directory' : 'file'}`
      };

    } catch (error) {
      if (error.code === 'ENOENT') {
        const relativePath = this.directoryAccessManager.createRelativePath(fullPath, accessConfig);
        return {
          success: true,
          action: 'exists',
          filePath: relativePath,
          fullPath: fullPath,
          exists: false,
          message: `${filePath} does not exist`
        };
      }

      throw new Error(`Failed to check existence of ${filePath}: ${error.message}`);
    }
  }

  /**
   * Get file statistics
   * @private
   */
  async getFileStats(filePath, accessConfig) {
    const workingDir = this.directoryAccessManager.getWorkingDirectory(accessConfig);
    const fullPath = this.resolvePath(filePath, workingDir);

    // Validate read access
    const accessResult = this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
    if (!accessResult.allowed) {
      throw new Error(`Read access denied: ${accessResult.reason} (${accessResult.path})`);
    }

    try {
      const stats = await fs.stat(fullPath);

      const relativePath = this.directoryAccessManager.createRelativePath(fullPath, accessConfig);

      return {
        success: true,
        action: 'stats',
        filePath: relativePath,
        fullPath: fullPath,
        stats: {
          size: stats.size,
          type: stats.isDirectory() ? 'directory' : 'file',
          lastModified: stats.mtime.toISOString(),
          lastAccessed: stats.atime.toISOString(),
          created: stats.birthtime.toISOString(),
          permissions: stats.mode,
          isSymlink: stats.isSymbolicLink()
        },
        message: `Retrieved stats for ${filePath}`
      };

    } catch (error) {
      throw new Error(`Failed to get stats for ${filePath}: ${error.message}`);
    }
  }

  /**
   * Resolve file path safely (legacy method for compatibility)
   * @private
   */
  resolvePath(filePath, workingDir) {
    const resolved = path.isAbsolute(filePath)
      ? path.normalize(filePath)
      : path.resolve(workingDir, filePath);

    // Guard against the "doubled folder" trap. Reasoning models lose track
    // of the session CWD after a change-directory and re-prepend the
    // project folder name to every relative path — turning
    // CWD=".../foo" + "foo/bar/x.js" into ".../foo/foo/bar/x.js", which
    // the filesystem silently creates. We detect this by scanning the
    // FINAL resolved path for consecutive duplicate segments, so the
    // guard fires whether the duplication came from (a) relative prefix
    // (`foo/...` while inside `.../foo`), (b) relative mid-path
    // (`pkg/foo/foo/bar`), or (c) an absolute path written out in full
    // (`C:\...\foo\foo\bar`). Root-level duplicates like Windows drives
    // are ignored by design (`C:\C:\...` is impossible in normalized form).
    const segs = resolved.split(/[\\/]/).filter(Boolean);
    for (let i = 1; i < segs.length; i++) {
      if (segs[i].toLowerCase() === segs[i - 1].toLowerCase()) {
        throw new Error(
          `Refused: resolved path contains a duplicated segment "${segs[i]}" (${resolved}). ` +
          `Current working directory: ${workingDir}. ` +
          `This almost always means the project folder name was prepended to a relative path while the CWD is already inside it. ` +
          `Drop the duplicated "${segs[i]}/" from the path — relative paths are resolved from the CWD — or pass an absolute path with no duplication.`
        );
      }
    }

    return resolved;
  }

  /**
   * Validate path access using DirectoryAccessManager
   * @private
   */
  validatePathAccess(fullPath, accessConfig, operation = 'read') {
    const accessResult = operation === 'write' 
      ? this.directoryAccessManager.validateWriteAccess(fullPath, accessConfig)
      : this.directoryAccessManager.validateReadAccess(fullPath, accessConfig);
      
    if (!accessResult.allowed) {
      throw new Error(`${operation} access denied: ${accessResult.reason} (${accessResult.path})`);
    }
    
    return accessResult;
  }

  /**
   * Check if file extension is allowed
   * @private
   */
  isAllowedFileExtension(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    if (this.blockedExtensions.includes(ext)) {
      return false;
    }
    
    if (this.allowedExtensions && !this.allowedExtensions.includes(ext)) {
      return false;
    }
    
    return true;
  }

  /**
   * Add operation to history
   * @private
   */
  addToHistory(action, result, agentId) {
    const historyEntry = {
      timestamp: new Date().toISOString(),
      agentId,
      action: action.type,
      filePath: action.filePath || action.outputPath || action.directory,
      success: result.success,
      size: result.size
    };
    
    this.operationHistory.push(historyEntry);
    
    // Keep only last 200 entries
    if (this.operationHistory.length > 200) {
      this.operationHistory = this.operationHistory.slice(-200);
    }
  }

  /**
   * Get supported actions for this tool
   * @returns {Array<string>} Array of supported action names
   */
  getSupportedActions() {
    return [
      'read', 'write', 'append', 'delete', 'copy', 'move', 
      'create-dir', 'list', 'exists', 'stats'
    ];
  }

  /**
   * Get parameter schema for validation
   * @returns {Object} Parameter schema
   */
  getParameterSchema() {
    return {
      type: 'object',
      properties: {
        actions: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: this.getSupportedActions()
              },
              filePath: { type: 'string' },
              outputPath: { type: 'string' },
              sourcePath: { type: 'string' },
              destPath: { type: 'string' },
              directory: { type: 'string' },
              content: { type: 'string' },
              encoding: { type: 'string' },
              createDirs: { type: 'boolean' }
            },
            required: ['type']
          }
        }
      },
      required: ['actions']
    };
  }

  /**
   * Get operation history for debugging
   * @returns {Array} Operation history
   */
  getOperationHistory(agentId = null) {
    if (agentId) {
      return this.operationHistory.filter(entry => entry.agentId === agentId);
    }
    return [...this.operationHistory];
  }
}

export default FileSystemTool;