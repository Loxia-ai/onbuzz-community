/**
 * Context Reference Data Model - Type definitions and validation for context references
 * 
 * Purpose:
 * - Define the structure and properties of context references
 * - Provide validation functions for context reference data
 * - Handle context reference resolution and management
 */

import { CONTEXT_REFERENCE_TYPES, FILE_EXTENSIONS, CONTEXT_ICONS, FILE_ICONS } from '../utilities/constants.js';

/**
 * Context Reference data model
 * @typedef {Object} ContextReference
 * @property {string} id - Unique reference identifier
 * @property {string} type - Reference type (file, component, selection, directory)
 * @property {string} path - Path or identifier of referenced item
 * @property {string} name - Human-readable name
 * @property {string} [content] - Referenced content (if loaded)
 * @property {ReferenceMetadata} metadata - Reference metadata
 * @property {ReferenceScope} scope - Reference scope and boundaries
 * @property {string} createdAt - ISO timestamp of creation
 * @property {string} [lastAccessed] - ISO timestamp of last access
 * @property {string} [lastModified] - ISO timestamp of last modification
 * @property {boolean} isValid - Whether reference is still valid
 * @property {string} [invalidReason] - Reason for invalidity
 * @property {number} accessCount - Number of times accessed
 * @property {Object} tags - Reference tags and labels
 */

/**
 * Reference metadata
 * @typedef {Object} ReferenceMetadata
 * @property {string} [language] - Programming language (for code files)
 * @property {string} [encoding] - File encoding
 * @property {number} [size] - Content size in bytes
 * @property {string} [mimeType] - MIME type
 * @property {string} [checksum] - Content checksum for integrity
 * @property {string[]} [keywords] - Extracted keywords
 * @property {string} [description] - Reference description
 * @property {Object} [customFields] - Custom metadata fields
 * @property {string} [icon] - Display icon identifier
 * @property {Object} [permissions] - Access permissions
 */

/**
 * Reference scope and boundaries
 * @typedef {Object} ReferenceScope
 * @property {number} [startLine] - Start line number (for selections)
 * @property {number} [endLine] - End line number (for selections)
 * @property {number} [startColumn] - Start column number
 * @property {number} [endColumn] - End column number
 * @property {string} [functionName] - Function/method name (for code)
 * @property {string} [className] - Class name (for code)
 * @property {string} [namespace] - Namespace or module (for code)
 * @property {string[]} [includePaths] - Included sub-paths (for directories)
 * @property {string[]} [excludePaths] - Excluded sub-paths (for directories)
 * @property {number} [maxDepth] - Maximum directory depth
 */

/**
 * File Reference (extends ContextReference)
 * @typedef {Object} FileReference
 * @property {string} absolutePath - Absolute file path
 * @property {string} relativePath - Relative file path from workspace
 * @property {string} extension - File extension
 * @property {boolean} exists - Whether file exists on filesystem
 * @property {FileStats} [stats] - File system statistics
 * @property {string} [gitStatus] - Git status of file
 * @property {DependencyInfo} [dependencies] - File dependencies
 */

/**
 * Directory Reference (extends ContextReference)
 * @typedef {Object} DirectoryReference
 * @property {string} absolutePath - Absolute directory path
 * @property {string} relativePath - Relative directory path from workspace
 * @property {FileSystemTree} [tree] - Directory tree structure
 * @property {number} [fileCount] - Number of files in directory
 * @property {number} [totalSize] - Total size of directory contents
 * @property {string[]} [fileTypes] - File types present in directory
 */

/**
 * Selection Reference (extends ContextReference)
 * @typedef {Object} SelectionReference
 * @property {string} sourceFile - Source file path
 * @property {string} selectedText - Selected text content
 * @property {SyntaxInfo} [syntax] - Syntax information
 * @property {ContextInfo} [context] - Surrounding context
 * @property {string} [purpose] - Purpose of selection
 */

/**
 * Component Reference (extends ContextReference)
 * @typedef {Object} ComponentReference
 * @property {string} componentType - Type of component
 * @property {string} [sourceFile] - Source file containing component
 * @property {Object} [properties] - Component properties
 * @property {string[]} [dependencies] - Component dependencies
 * @property {string} [documentation] - Component documentation
 */

/**
 * File system statistics
 * @typedef {Object} FileStats
 * @property {number} size - File size in bytes
 * @property {string} created - Creation timestamp
 * @property {string} modified - Last modification timestamp
 * @property {string} accessed - Last access timestamp
 * @property {boolean} isDirectory - Whether item is directory
 * @property {boolean} isFile - Whether item is file
 * @property {number} mode - File permissions mode
 */

/**
 * File system tree structure
 * @typedef {Object} FileSystemTree
 * @property {string} name - Item name
 * @property {string} path - Item path
 * @property {string} type - Item type (file, directory)
 * @property {FileSystemTree[]} [children] - Child items (for directories)
 * @property {number} [size] - Item size
 * @property {string} [extension] - File extension
 */

/**
 * Syntax information
 * @typedef {Object} SyntaxInfo
 * @property {string} language - Programming language
 * @property {string[]} [symbols] - Identified symbols
 * @property {string[]} [imports] - Import statements
 * @property {string[]} [functions] - Function definitions
 * @property {string[]} [classes] - Class definitions
 * @property {string[]} [variables] - Variable definitions
 */

/**
 * Context information
 * @typedef {Object} ContextInfo
 * @property {string} [beforeText] - Text before selection
 * @property {string} [afterText] - Text after selection
 * @property {number} [indentLevel] - Indentation level
 * @property {string[]} [surroundingFunctions] - Surrounding function names
 * @property {string[]} [surroundingClasses] - Surrounding class names
 */

/**
 * Dependency information
 * @typedef {Object} DependencyInfo
 * @property {string[]} imports - Imported modules/files
 * @property {string[]} exports - Exported items
 * @property {string[]} dependencies - External dependencies
 * @property {string[]} dependents - Files that depend on this file
 */

/**
 * Context Reference validation functions
 */
export class ContextReferenceValidator {
  /**
   * Validate context reference data structure
   * @param {Object} reference - Context reference to validate
   * @returns {Object} Validation result
   */
  static validate(reference) {
    const errors = [];
    const warnings = [];

    // Required fields
    if (!reference.id || typeof reference.id !== 'string') {
      errors.push('Reference ID is required and must be a string');
    }

    if (!reference.type || typeof reference.type !== 'string') {
      errors.push('Reference type is required and must be a string');
    }

    if (!reference.path || typeof reference.path !== 'string') {
      errors.push('Reference path is required and must be a string');
    }

    if (!reference.name || typeof reference.name !== 'string') {
      errors.push('Reference name is required and must be a string');
    }

    // Type validation
    if (reference.type && !Object.values(CONTEXT_REFERENCE_TYPES).includes(reference.type)) {
      errors.push(`Invalid reference type: ${reference.type}`);
    }

    // Content validation
    if (reference.content && typeof reference.content !== 'string') {
      errors.push('Reference content must be a string');
    }

    if (reference.content && reference.content.length > 1000000) { // 1MB
      warnings.push('Reference content is very large (>1MB)');
    }

    // Metadata validation
    if (reference.metadata) {
      const metadataValidation = this.validateMetadata(reference.metadata);
      errors.push(...metadataValidation.errors);
      warnings.push(...metadataValidation.warnings);
    }

    // Scope validation
    if (reference.scope) {
      const scopeValidation = this.validateScope(reference.scope);
      errors.push(...scopeValidation.errors);
      warnings.push(...scopeValidation.warnings);
    }

    // Access count validation
    if (reference.accessCount !== undefined && typeof reference.accessCount !== 'number') {
      errors.push('Access count must be a number');
    }

    // Timestamp validation
    const timestampFields = ['createdAt', 'lastAccessed', 'lastModified'];
    timestampFields.forEach(field => {
      if (reference[field] && !this.isValidTimestamp(reference[field])) {
        errors.push(`Invalid timestamp for ${field}: ${reference[field]}`);
      }
    });

    // Type-specific validation
    switch (reference.type) {
      case CONTEXT_REFERENCE_TYPES.FILE:
        const fileValidation = this.validateFileReference(reference);
        errors.push(...fileValidation.errors);
        warnings.push(...fileValidation.warnings);
        break;
      case CONTEXT_REFERENCE_TYPES.SELECTION:
        const selectionValidation = this.validateSelectionReference(reference);
        errors.push(...selectionValidation.errors);
        warnings.push(...selectionValidation.warnings);
        break;
      case CONTEXT_REFERENCE_TYPES.DIRECTORY:
        const directoryValidation = this.validateDirectoryReference(reference);
        errors.push(...directoryValidation.errors);
        warnings.push(...directoryValidation.warnings);
        break;
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Validate reference metadata
   * @param {Object} metadata - Metadata to validate
   * @returns {Object} Validation result
   */
  static validateMetadata(metadata) {
    const errors = [];
    const warnings = [];

    if (metadata.size !== undefined && (typeof metadata.size !== 'number' || metadata.size < 0)) {
      errors.push('Metadata size must be a non-negative number');
    }

    if (metadata.language && typeof metadata.language !== 'string') {
      errors.push('Metadata language must be a string');
    }

    if (metadata.encoding && typeof metadata.encoding !== 'string') {
      errors.push('Metadata encoding must be a string');
    }

    if (metadata.keywords && !Array.isArray(metadata.keywords)) {
      errors.push('Metadata keywords must be an array');
    }

    if (metadata.mimeType && typeof metadata.mimeType !== 'string') {
      errors.push('Metadata MIME type must be a string');
    }

    return { errors, warnings };
  }

  /**
   * Validate reference scope
   * @param {Object} scope - Scope to validate
   * @returns {Object} Validation result
   */
  static validateScope(scope) {
    const errors = [];
    const warnings = [];

    const numericFields = ['startLine', 'endLine', 'startColumn', 'endColumn', 'maxDepth'];
    numericFields.forEach(field => {
      if (scope[field] !== undefined && (typeof scope[field] !== 'number' || scope[field] < 0)) {
        errors.push(`Scope ${field} must be a non-negative number`);
      }
    });

    // Line range validation
    if (scope.startLine !== undefined && scope.endLine !== undefined) {
      if (scope.startLine > scope.endLine) {
        errors.push('Start line must be <= end line');
      }
    }

    // Column range validation
    if (scope.startColumn !== undefined && scope.endColumn !== undefined) {
      if (scope.startColumn > scope.endColumn) {
        errors.push('Start column must be <= end column');
      }
    }

    const arrayFields = ['includePaths', 'excludePaths'];
    arrayFields.forEach(field => {
      if (scope[field] && !Array.isArray(scope[field])) {
        errors.push(`Scope ${field} must be an array`);
      }
    });

    return { errors, warnings };
  }

  /**
   * Validate file reference specific fields
   * @param {Object} reference - File reference to validate
   * @returns {Object} Validation result
   */
  static validateFileReference(reference) {
    const errors = [];
    const warnings = [];

    if (reference.absolutePath && typeof reference.absolutePath !== 'string') {
      errors.push('Absolute path must be a string');
    }

    if (reference.relativePath && typeof reference.relativePath !== 'string') {
      errors.push('Relative path must be a string');
    }

    if (reference.extension && typeof reference.extension !== 'string') {
      errors.push('File extension must be a string');
    }

    if (reference.exists !== undefined && typeof reference.exists !== 'boolean') {
      errors.push('File exists flag must be a boolean');
    }

    return { errors, warnings };
  }

  /**
   * Validate selection reference specific fields
   * @param {Object} reference - Selection reference to validate
   * @returns {Object} Validation result
   */
  static validateSelectionReference(reference) {
    const errors = [];
    const warnings = [];

    if (!reference.scope || (!reference.scope.startLine && !reference.scope.endLine)) {
      warnings.push('Selection reference should have line scope defined');
    }

    if (reference.selectedText && typeof reference.selectedText !== 'string') {
      errors.push('Selected text must be a string');
    }

    if (reference.sourceFile && typeof reference.sourceFile !== 'string') {
      errors.push('Source file must be a string');
    }

    return { errors, warnings };
  }

  /**
   * Validate directory reference specific fields
   * @param {Object} reference - Directory reference to validate
   * @returns {Object} Validation result
   */
  static validateDirectoryReference(reference) {
    const errors = [];
    const warnings = [];

    if (reference.fileCount !== undefined && (typeof reference.fileCount !== 'number' || reference.fileCount < 0)) {
      errors.push('File count must be a non-negative number');
    }

    if (reference.totalSize !== undefined && (typeof reference.totalSize !== 'number' || reference.totalSize < 0)) {
      errors.push('Total size must be a non-negative number');
    }

    if (reference.fileTypes && !Array.isArray(reference.fileTypes)) {
      errors.push('File types must be an array');
    }

    return { errors, warnings };
  }

  /**
   * Check if a timestamp is valid ISO string
   * @param {string} timestamp - Timestamp to validate
   * @returns {boolean} True if valid
   */
  static isValidTimestamp(timestamp) {
    if (typeof timestamp !== 'string') return false;
    const date = new Date(timestamp);
    return date instanceof Date && !isNaN(date.getTime());
  }
}

/**
 * Context Reference factory functions
 */
export class ContextReferenceFactory {
  /**
   * Create a new context reference
   * @param {string} type - Reference type
   * @param {string} path - Reference path
   * @param {string} name - Reference name
   * @param {Object} options - Additional options
   * @returns {ContextReference} New context reference
   */
  static create(type, path, name, options = {}) {
    const now = new Date().toISOString();
    const referenceId = this.generateReferenceId();

    return {
      id: referenceId,
      type,
      path,
      name,
      content: options.content || null,
      metadata: this.createDefaultMetadata(type, path, options.metadata),
      scope: options.scope || {},
      createdAt: now,
      lastAccessed: null,
      lastModified: options.lastModified || null,
      isValid: true,
      invalidReason: null,
      accessCount: 0,
      tags: options.tags || {}
    };
  }

  /**
   * Create a file reference
   * @param {string} absolutePath - Absolute file path
   * @param {string} relativePath - Relative file path
   * @param {Object} options - Additional options
   * @returns {FileReference} File reference
   */
  static createFileReference(absolutePath, relativePath, options = {}) {
    const name = options.name || this.extractFileName(absolutePath);
    const extension = this.extractFileExtension(absolutePath);
    
    const reference = this.create(CONTEXT_REFERENCE_TYPES.FILE, relativePath, name, options);
    
    return {
      ...reference,
      absolutePath,
      relativePath,
      extension,
      exists: options.exists !== undefined ? options.exists : true,
      stats: options.stats || null,
      gitStatus: options.gitStatus || null,
      dependencies: options.dependencies || null
    };
  }

  /**
   * Create a selection reference
   * @param {string} sourceFile - Source file path
   * @param {string} selectedText - Selected text
   * @param {Object} scope - Selection scope
   * @param {Object} options - Additional options
   * @returns {SelectionReference} Selection reference
   */
  static createSelectionReference(sourceFile, selectedText, scope, options = {}) {
    const name = options.name || this.generateSelectionName(sourceFile, scope);
    
    const reference = this.create(CONTEXT_REFERENCE_TYPES.SELECTION, sourceFile, name, {
      ...options,
      scope,
      content: selectedText
    });
    
    return {
      ...reference,
      sourceFile,
      selectedText,
      syntax: options.syntax || null,
      context: options.context || null,
      purpose: options.purpose || null
    };
  }

  /**
   * Create a directory reference
   * @param {string} absolutePath - Absolute directory path
   * @param {string} relativePath - Relative directory path
   * @param {Object} options - Additional options
   * @returns {DirectoryReference} Directory reference
   */
  static createDirectoryReference(absolutePath, relativePath, options = {}) {
    const name = options.name || this.extractDirectoryName(absolutePath);
    
    const reference = this.create(CONTEXT_REFERENCE_TYPES.DIRECTORY, relativePath, name, options);
    
    return {
      ...reference,
      absolutePath,
      relativePath,
      tree: options.tree || null,
      fileCount: options.fileCount || null,
      totalSize: options.totalSize || null,
      fileTypes: options.fileTypes || null
    };
  }

  /**
   * Create a component reference
   * @param {string} componentType - Component type
   * @param {string} path - Component path/identifier
   * @param {string} name - Component name
   * @param {Object} options - Additional options
   * @returns {ComponentReference} Component reference
   */
  static createComponentReference(componentType, path, name, options = {}) {
    const reference = this.create(CONTEXT_REFERENCE_TYPES.COMPONENT, path, name, options);
    
    return {
      ...reference,
      componentType,
      sourceFile: options.sourceFile || null,
      properties: options.properties || null,
      dependencies: options.dependencies || null,
      documentation: options.documentation || null
    };
  }

  /**
   * Create default metadata for reference type
   * @param {string} type - Reference type
   * @param {string} path - Reference path
   * @param {Object} overrides - Metadata overrides
   * @returns {ReferenceMetadata} Default metadata
   */
  static createDefaultMetadata(type, path, overrides = {}) {
    const metadata = {
      language: null,
      encoding: 'utf-8',
      size: null,
      mimeType: null,
      checksum: null,
      keywords: [],
      description: '',
      customFields: {},
      icon: this.getDefaultIcon(type, path),
      permissions: {},
      ...overrides
    };

    // Set language for file references
    if (type === CONTEXT_REFERENCE_TYPES.FILE) {
      const extension = this.extractFileExtension(path);
      metadata.language = this.getLanguageFromExtension(extension);
      metadata.mimeType = this.getMimeTypeFromExtension(extension);
    }

    return metadata;
  }

  /**
   * Generate unique reference ID
   * @returns {string} Unique reference ID
   */
  static generateReferenceId() {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 9);
    return `ref_${timestamp}_${random}`;
  }

  /**
   * Extract file name from path
   * @param {string} path - File path
   * @returns {string} File name
   */
  static extractFileName(path) {
    return path.split(/[/\\]/).pop() || path;
  }

  /**
   * Extract directory name from path
   * @param {string} path - Directory path
   * @returns {string} Directory name
   */
  static extractDirectoryName(path) {
    const parts = path.split(/[/\\]/).filter(Boolean);
    return parts[parts.length - 1] || 'Root';
  }

  /**
   * Extract file extension from path
   * @param {string} path - File path
   * @returns {string} File extension
   */
  static extractFileExtension(path) {
    const fileName = this.extractFileName(path);
    const lastDot = fileName.lastIndexOf('.');
    return lastDot !== -1 ? fileName.substring(lastDot) : '';
  }

  /**
   * Generate selection name from file and scope
   * @param {string} sourceFile - Source file path
   * @param {Object} scope - Selection scope
   * @returns {string} Selection name
   */
  static generateSelectionName(sourceFile, scope) {
    const fileName = this.extractFileName(sourceFile);
    
    if (scope.startLine && scope.endLine) {
      if (scope.startLine === scope.endLine) {
        return `${fileName}:${scope.startLine}`;
      } else {
        return `${fileName}:${scope.startLine}-${scope.endLine}`;
      }
    }
    
    if (scope.functionName) {
      return `${fileName}:${scope.functionName}()`;
    }
    
    if (scope.className) {
      return `${fileName}:${scope.className}`;
    }
    
    return `${fileName} (selection)`;
  }

  /**
   * Get default icon for reference type and path
   * @param {string} type - Reference type
   * @param {string} path - Reference path
   * @returns {string} Icon identifier
   */
  static getDefaultIcon(type, path) {
    if (type === CONTEXT_REFERENCE_TYPES.FILE) {
      const extension = this.extractFileExtension(path);
      return FILE_ICONS[extension] || CONTEXT_ICONS.DEFAULT;
    }
    
    return CONTEXT_ICONS[type] || CONTEXT_ICONS.DEFAULT;
  }

  /**
   * Get programming language from file extension
   * @param {string} extension - File extension
   * @returns {string|null} Programming language
   */
  static getLanguageFromExtension(extension) {
    const languageMap = {
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
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
      '.xml': 'xml',
      '.sql': 'sql',
      '.md': 'markdown'
    };
    
    return languageMap[extension.toLowerCase()] || null;
  }

  /**
   * Get MIME type from file extension
   * @param {string} extension - File extension
   * @returns {string|null} MIME type
   */
  static getMimeTypeFromExtension(extension) {
    const mimeMap = {
      '.js': 'application/javascript',
      '.jsx': 'application/javascript',
      '.ts': 'application/typescript',
      '.tsx': 'application/typescript',
      '.py': 'text/x-python',
      '.java': 'text/x-java-source',
      '.cpp': 'text/x-c++src',
      '.c': 'text/x-csrc',
      '.cs': 'text/x-csharp',
      '.php': 'application/x-php',
      '.rb': 'application/x-ruby',
      '.go': 'text/x-go',
      '.rs': 'text/x-rust',
      '.html': 'text/html',
      '.css': 'text/css',
      '.scss': 'text/x-scss',
      '.json': 'application/json',
      '.yml': 'application/x-yaml',
      '.yaml': 'application/x-yaml',
      '.xml': 'application/xml',
      '.sql': 'application/sql',
      '.md': 'text/markdown',
      '.txt': 'text/plain'
    };
    
    return mimeMap[extension.toLowerCase()] || 'text/plain';
  }
}

/**
 * Context Reference utility functions
 */
export class ContextReferenceUtils {
  /**
   * Check if reference is still valid
   * @param {ContextReference} reference - Reference to check
   * @returns {boolean} True if valid
   */
  static isValid(reference) {
    return reference.isValid && !reference.invalidReason;
  }

  /**
   * Mark reference as accessed
   * @param {ContextReference} reference - Reference to mark
   * @returns {ContextReference} Updated reference
   */
  static markAccessed(reference) {
    return {
      ...reference,
      lastAccessed: new Date().toISOString(),
      accessCount: reference.accessCount + 1
    };
  }

  /**
   * Mark reference as invalid
   * @param {ContextReference} reference - Reference to invalidate
   * @param {string} reason - Reason for invalidation
   * @returns {ContextReference} Updated reference
   */
  static markInvalid(reference, reason) {
    return {
      ...reference,
      isValid: false,
      invalidReason: reason
    };
  }

  /**
   * Get reference display name with context
   * @param {ContextReference} reference - Reference to format
   * @returns {string} Display name
   */
  static getDisplayName(reference) {
    if (reference.type === CONTEXT_REFERENCE_TYPES.SELECTION && reference.scope) {
      return ContextReferenceFactory.generateSelectionName(reference.path, reference.scope);
    }
    
    return reference.name;
  }

  /**
   * Get reference description
   * @param {ContextReference} reference - Reference to describe
   * @returns {string} Description
   */
  static getDescription(reference) {
    if (reference.metadata?.description) {
      return reference.metadata.description;
    }

    switch (reference.type) {
      case CONTEXT_REFERENCE_TYPES.FILE:
        return `File: ${reference.path}`;
      case CONTEXT_REFERENCE_TYPES.DIRECTORY:
        return `Directory: ${reference.path}`;
      case CONTEXT_REFERENCE_TYPES.SELECTION:
        return `Selection from ${reference.path}`;
      case CONTEXT_REFERENCE_TYPES.COMPONENT:
        return `Component: ${reference.name}`;
      default:
        return reference.path;
    }
  }

  /**
   * Calculate reference relevance score
   * @param {ContextReference} reference - Reference to score
   * @param {Object} context - Scoring context
   * @returns {number} Relevance score (0-1)
   */
  static calculateRelevance(reference, context = {}) {
    let score = 0.5; // Base score

    // Recent access bonus
    if (reference.lastAccessed) {
      const daysSinceAccess = (Date.now() - new Date(reference.lastAccessed)) / (1000 * 60 * 60 * 24);
      score += Math.max(0, 0.2 * (1 - daysSinceAccess / 30)); // Decay over 30 days
    }

    // Access frequency bonus
    if (reference.accessCount > 0) {
      score += Math.min(0.2, reference.accessCount * 0.01);
    }

    // Type-specific scoring
    switch (reference.type) {
      case CONTEXT_REFERENCE_TYPES.FILE:
        if (context.fileTypes && reference.metadata?.language) {
          if (context.fileTypes.includes(reference.metadata.language)) {
            score += 0.2;
          }
        }
        break;
      case CONTEXT_REFERENCE_TYPES.SELECTION:
        score += 0.1; // Selections are often more relevant
        break;
    }

    // Keyword matching
    if (context.keywords && reference.metadata?.keywords) {
      const matches = context.keywords.filter(k => 
        reference.metadata.keywords.includes(k)
      ).length;
      score += Math.min(0.3, matches * 0.1);
    }

    // Invalid references get heavy penalty
    if (!reference.isValid) {
      score *= 0.1;
    }

    return Math.min(1, Math.max(0, score));
  }

  /**
   * Group references by type
   * @param {ContextReference[]} references - References to group
   * @returns {Object} Grouped references
   */
  static groupByType(references) {
    return references.reduce((groups, reference) => {
      const type = reference.type;
      if (!groups[type]) {
        groups[type] = [];
      }
      groups[type].push(reference);
      return groups;
    }, {});
  }

  /**
   * Sort references by relevance
   * @param {ContextReference[]} references - References to sort
   * @param {Object} context - Sorting context
   * @returns {ContextReference[]} Sorted references
   */
  static sortByRelevance(references, context = {}) {
    return [...references].sort((a, b) => {
      const scoreA = this.calculateRelevance(a, context);
      const scoreB = this.calculateRelevance(b, context);
      return scoreB - scoreA;
    });
  }

  /**
   * Filter references by criteria
   * @param {ContextReference[]} references - References to filter
   * @param {Object} criteria - Filter criteria
   * @returns {ContextReference[]} Filtered references
   */
  static filter(references, criteria = {}) {
    return references.filter(reference => {
      // Type filter
      if (criteria.types && !criteria.types.includes(reference.type)) {
        return false;
      }

      // Valid filter
      if (criteria.validOnly && !reference.isValid) {
        return false;
      }

      // Language filter
      if (criteria.languages && reference.metadata?.language) {
        if (!criteria.languages.includes(reference.metadata.language)) {
          return false;
        }
      }

      // Path filter
      if (criteria.pathPattern) {
        const regex = new RegExp(criteria.pathPattern, 'i');
        if (!regex.test(reference.path)) {
          return false;
        }
      }

      // Keyword filter
      if (criteria.keywords && reference.metadata?.keywords) {
        const hasKeyword = criteria.keywords.some(keyword =>
          reference.metadata.keywords.includes(keyword)
        );
        if (!hasKeyword) {
          return false;
        }
      }

      // Date range filter
      if (criteria.createdAfter) {
        if (new Date(reference.createdAt) < new Date(criteria.createdAfter)) {
          return false;
        }
      }

      if (criteria.createdBefore) {
        if (new Date(reference.createdAt) > new Date(criteria.createdBefore)) {
          return false;
        }
      }

      return true;
    });
  }

  /**
   * Format reference for display
   * @param {ContextReference} reference - Reference to format
   * @returns {Object} Formatted reference
   */
  static formatForDisplay(reference) {
    return {
      id: reference.id,
      type: reference.type,
      name: this.getDisplayName(reference),
      description: this.getDescription(reference),
      path: reference.path,
      icon: reference.metadata?.icon || CONTEXT_ICONS[reference.type] || CONTEXT_ICONS.DEFAULT,
      isValid: reference.isValid,
      lastAccessed: reference.lastAccessed,
      accessCount: reference.accessCount,
      size: reference.metadata?.size || null,
      language: reference.metadata?.language || null
    };
  }
}

export default {
  ContextReferenceValidator,
  ContextReferenceFactory,
  ContextReferenceUtils
};