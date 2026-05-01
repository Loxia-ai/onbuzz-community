/**
 * DirectoryAccessManager - Manage directory access permissions for agents
 * 
 * Purpose:
 * - Control agent access to directories and files
 * - Distinguish between read-only and write-enabled directories
 * - Validate paths against access permissions
 * - Provide working directory management
 * - Support both absolute and relative path resolution
 */

import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { getSystemRestrictedPaths } from './platformUtils.js';

class DirectoryAccessManager {
  constructor(config = {}, logger = null) {
    this.logger = logger;
    this.config = config;
    
    // Default system restrictions (platform-aware from platformUtils)
    this.systemRestrictedPaths = [
      ...getSystemRestrictedPaths(),
      // User sensitive directories (cross-platform)
      path.join(os.homedir(), '.ssh'),
      path.join(os.homedir(), '.aws'),
      path.join(os.homedir(), '.config'),
      path.join(os.homedir(), '.gnupg'),
      // Common package managers and git internals
      'node_modules/.bin',
      '.git/objects',
      '.git/hooks'
    ];
  }

  /**
   * Create directory access configuration for an agent
   * @param {Object} options - Access configuration options
   * @returns {Object} Directory access configuration
   */
  createDirectoryAccess(options = {}) {
    const {
      workingDirectory = process.cwd(),
      readOnlyDirectories = [],
      writeEnabledDirectories = [],
      restrictToProject = true,
      allowSystemAccess = false,
      customRestrictions = []
    } = options;

    // Normalize all paths to absolute
    const workingDir = path.resolve(workingDirectory);
    const readOnlyDirs = readOnlyDirectories.map(dir => this.normalizePath(dir, workingDir));
    const writeEnabledDirs = writeEnabledDirectories.map(dir => this.normalizePath(dir, workingDir));

    // If restrict to project, ensure working directory is included
    const finalReadOnlyDirs = restrictToProject 
      ? [...new Set([...readOnlyDirs, workingDir])]
      : readOnlyDirs;

    const finalWriteEnabledDirs = restrictToProject
      ? writeEnabledDirs.filter(dir => this.isPathWithinDirectory(dir, workingDir))
      : writeEnabledDirs;

    return {
      workingDirectory: workingDir,
      readOnlyDirectories: finalReadOnlyDirs,
      writeEnabledDirectories: finalWriteEnabledDirs,
      restrictToProject,
      allowSystemAccess,
      customRestrictions: customRestrictions.map(restriction => path.resolve(restriction)),
      createdAt: new Date().toISOString(),
      version: '1.0'
    };
  }

  /**
   * Validate if a path can be accessed for reading
   * @param {string} targetPath - Path to validate
   * @param {Object} accessConfig - Directory access configuration
   * @returns {Object} Validation result
   */
  validateReadAccess(targetPath, accessConfig) {
    try {
      const resolvedPath = this.resolvePath(targetPath, accessConfig.workingDirectory);
      
      // Check system restrictions first
      if (!accessConfig.allowSystemAccess && this.isSystemRestrictedPath(resolvedPath)) {
        return {
          allowed: false,
          reason: 'System path access denied',
          path: resolvedPath,
          category: 'system_restricted'
        };
      }

      // Check custom restrictions
      if (this.isCustomRestricted(resolvedPath, accessConfig.customRestrictions)) {
        return {
          allowed: false,
          reason: 'Custom restriction applied',
          path: resolvedPath,
          category: 'custom_restricted'
        };
      }

      // If restricting to project, ensure path is within allowed boundaries
      if (accessConfig.restrictToProject) {
        // Build list of allowed directories, using workingDirectory as fallback if lists are empty
        const allowedDirs = [
          ...(accessConfig.readOnlyDirectories || []),
          ...(accessConfig.writeEnabledDirectories || [])
        ];

        // If no explicit directories configured, use workingDirectory as the project scope
        if (allowedDirs.length === 0 && accessConfig.workingDirectory) {
          allowedDirs.push(accessConfig.workingDirectory);
        }

        const isWithinProject = this.isPathWithinAnyDirectory(resolvedPath, allowedDirs);

        if (!isWithinProject) {
          return {
            allowed: false,
            reason: 'Path outside project scope',
            path: resolvedPath,
            category: 'project_restricted'
          };
        }
      }

      // Check if path is within any allowed directory
      const isWithinAllowed = this.isPathWithinAnyDirectory(resolvedPath, [
        ...accessConfig.readOnlyDirectories,
        ...accessConfig.writeEnabledDirectories
      ]);

      if (!isWithinAllowed && accessConfig.readOnlyDirectories.length > 0) {
        return {
          allowed: false,
          reason: 'Path not in allowed directories',
          path: resolvedPath,
          category: 'directory_restricted'
        };
      }

      return {
        allowed: true,
        path: resolvedPath,
        category: 'allowed'
      };

    } catch (error) {
      return {
        allowed: false,
        reason: `Path validation error: ${error.message}`,
        path: targetPath,
        category: 'validation_error'
      };
    }
  }

  /**
   * Validate if a path can be accessed for writing
   * @param {string} targetPath - Path to validate
   * @param {Object} accessConfig - Directory access configuration
   * @returns {Object} Validation result
   */
  validateWriteAccess(targetPath, accessConfig) {
    // First check read access
    const readResult = this.validateReadAccess(targetPath, accessConfig);
    if (!readResult.allowed) {
      return {
        ...readResult,
        writeAllowed: false
      };
    }

    const resolvedPath = readResult.path;

    // Build effective write-enabled directories list
    // If writeEnabledDirectories is empty but we have a workingDirectory,
    // treat the workingDirectory as implicitly write-enabled
    let effectiveWriteEnabled = [...(accessConfig.writeEnabledDirectories || [])];

    if (effectiveWriteEnabled.length === 0 && accessConfig.workingDirectory) {
      // Fallback: working directory is implicitly write-enabled when no explicit dirs configured
      effectiveWriteEnabled = [accessConfig.workingDirectory];
      this.logger?.debug('No writeEnabledDirectories configured, using workingDirectory as fallback', {
        workingDirectory: accessConfig.workingDirectory
      });
    }

    // Check if path is within write-enabled directories
    const isWithinWriteEnabled = this.isPathWithinAnyDirectory(
      resolvedPath,
      effectiveWriteEnabled
    );

    if (!isWithinWriteEnabled) {
      // Check if it's in read-only directories
      const isWithinReadOnly = this.isPathWithinAnyDirectory(
        resolvedPath,
        accessConfig.readOnlyDirectories || []
      );

      if (isWithinReadOnly) {
        return {
          allowed: false,
          writeAllowed: false,
          reason: 'Path is in read-only directory',
          path: resolvedPath,
          category: 'read_only_restricted'
        };
      }

      return {
        allowed: false,
        writeAllowed: false,
        reason: 'Path not in write-enabled directories',
        path: resolvedPath,
        category: 'write_restricted'
      };
    }

    return {
      allowed: true,
      writeAllowed: true,
      path: resolvedPath,
      category: 'write_allowed'
    };
  }

  /**
   * Get the effective working directory for an agent
   * @param {Object} accessConfig - Directory access configuration
   * @returns {string} Working directory path
   */
  getWorkingDirectory(accessConfig) {
    return accessConfig.workingDirectory || process.cwd();
  }

  /**
   * List accessible directories for an agent
   * @param {Object} accessConfig - Directory access configuration
   * @returns {Object} Directory listing with permissions
   */
  getAccessibleDirectories(accessConfig) {
    return {
      workingDirectory: accessConfig.workingDirectory,
      readOnly: [...accessConfig.readOnlyDirectories],
      writeEnabled: [...accessConfig.writeEnabledDirectories],
      projectRestricted: accessConfig.restrictToProject,
      systemAccessAllowed: accessConfig.allowSystemAccess,
      totalDirectories: accessConfig.readOnlyDirectories.length + accessConfig.writeEnabledDirectories.length
    };
  }

  /**
   * Update directory access configuration
   * @param {Object} currentConfig - Current access configuration
   * @param {Object} updates - Updates to apply
   * @returns {Object} Updated configuration
   */
  updateDirectoryAccess(currentConfig, updates) {
    const updatedConfig = { ...currentConfig };

    if (updates.workingDirectory) {
      updatedConfig.workingDirectory = path.resolve(updates.workingDirectory);
    }

    if (updates.readOnlyDirectories !== undefined) {
      updatedConfig.readOnlyDirectories = updates.readOnlyDirectories.map(dir => 
        this.normalizePath(dir, updatedConfig.workingDirectory)
      );
    }

    if (updates.writeEnabledDirectories !== undefined) {
      updatedConfig.writeEnabledDirectories = updates.writeEnabledDirectories.map(dir =>
        this.normalizePath(dir, updatedConfig.workingDirectory)
      );
    }

    if (updates.restrictToProject !== undefined) {
      updatedConfig.restrictToProject = updates.restrictToProject;
    }

    if (updates.allowSystemAccess !== undefined) {
      updatedConfig.allowSystemAccess = updates.allowSystemAccess;
    }

    if (updates.customRestrictions !== undefined) {
      updatedConfig.customRestrictions = updates.customRestrictions.map(restriction =>
        path.resolve(restriction)
      );
    }

    updatedConfig.version = currentConfig.version || '1.0';
    updatedConfig.updatedAt = new Date().toISOString();

    return updatedConfig;
  }

  /**
   * Validate directory access configuration
   * @param {Object} accessConfig - Configuration to validate
   * @returns {Object} Validation result
   */
  validateAccessConfiguration(accessConfig) {
    const errors = [];
    const warnings = [];

    // Validate working directory exists
    if (!accessConfig.workingDirectory) {
      errors.push('Working directory is required');
    } else {
      // Convert relative paths to absolute paths relative to process.cwd()
      if (!path.isAbsolute(accessConfig.workingDirectory)) {
        accessConfig.workingDirectory = path.resolve(process.cwd(), accessConfig.workingDirectory);
      }
    }

    // Validate directory arrays
    if (!Array.isArray(accessConfig.readOnlyDirectories)) {
      errors.push('readOnlyDirectories must be an array');
    } else {
      // Convert relative paths to absolute paths
      accessConfig.readOnlyDirectories = accessConfig.readOnlyDirectories.map(dir => 
        path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
      );
    }

    if (!Array.isArray(accessConfig.writeEnabledDirectories)) {
      errors.push('writeEnabledDirectories must be an array');
    } else {
      // Convert relative paths to absolute paths
      accessConfig.writeEnabledDirectories = accessConfig.writeEnabledDirectories.map(dir => 
        path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir)
      );
    }

    // Check for overlapping directories
    if (accessConfig.readOnlyDirectories && accessConfig.writeEnabledDirectories) {
      const overlapping = this.findOverlappingPaths(
        accessConfig.readOnlyDirectories,
        accessConfig.writeEnabledDirectories
      );
      
      if (overlapping.length > 0) {
        warnings.push(`Overlapping directories found: ${overlapping.join(', ')}`);
      }
    }

    // Check for system path access
    if (accessConfig.allowSystemAccess) {
      warnings.push('System path access is enabled - use with caution');
    }

    // Validate paths exist (async check would be needed in real implementation)
    const allPaths = [
      ...accessConfig.readOnlyDirectories,
      ...accessConfig.writeEnabledDirectories
    ];

    for (const dirPath of allPaths) {
      if (!path.isAbsolute(dirPath)) {
        errors.push(`Directory path must be absolute: ${dirPath}`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        readOnlyCount: accessConfig.readOnlyDirectories?.length || 0,
        writeEnabledCount: accessConfig.writeEnabledDirectories?.length || 0,
        restrictToProject: accessConfig.restrictToProject,
        allowSystemAccess: accessConfig.allowSystemAccess
      }
    };
  }

  /**
   * Create relative path from absolute path within accessible directories
   * @param {string} absolutePath - Absolute path to convert
   * @param {Object} accessConfig - Directory access configuration
   * @returns {string} Relative path or original if not within accessible directories
   */
  createRelativePath(absolutePath, accessConfig) {
    const allDirectories = [
      ...accessConfig.readOnlyDirectories,
      ...accessConfig.writeEnabledDirectories,
      accessConfig.workingDirectory
    ];

    for (const dir of allDirectories) {
      if (this.isPathWithinDirectory(absolutePath, dir)) {
        return path.relative(dir, absolutePath);
      }
    }

    return absolutePath;
  }

  /**
   * Resolve path relative to working directory or as absolute
   * @private
   */
  resolvePath(targetPath, workingDirectory) {
    if (path.isAbsolute(targetPath)) {
      return path.normalize(targetPath);
    }
    return path.resolve(workingDirectory, targetPath);
  }

  /**
   * Normalize path to absolute, resolving relative to working directory
   * @private
   */
  normalizePath(targetPath, workingDirectory) {
    if (path.isAbsolute(targetPath)) {
      return path.normalize(targetPath);
    }
    return path.resolve(workingDirectory, targetPath);
  }

  /**
   * Check if path is within a directory
   * Uses case-insensitive comparison on macOS and Windows
   * @private
   */
  isPathWithinDirectory(targetPath, parentDirectory) {
    // macOS (APFS/HFS+) and Windows (NTFS) are case-insensitive
    const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';

    // Normalize paths for comparison
    let normalizedTarget = path.normalize(targetPath);
    let normalizedParent = path.normalize(parentDirectory);

    // Apply case-insensitive comparison if needed
    if (caseInsensitive) {
      normalizedTarget = normalizedTarget.toLowerCase();
      normalizedParent = normalizedParent.toLowerCase();
    }

    const relative = path.relative(normalizedParent, normalizedTarget);
    return !relative.startsWith('..') && !path.isAbsolute(relative);
  }

  /**
   * Check if path is within any of the provided directories
   * @private
   */
  isPathWithinAnyDirectory(targetPath, directories) {
    return directories.some(dir => this.isPathWithinDirectory(targetPath, dir));
  }

  /**
   * Check if path is system restricted
   * Uses case-insensitive comparison on macOS and Windows
   * @private
   */
  isSystemRestrictedPath(targetPath) {
    // macOS (APFS/HFS+) and Windows (NTFS) are case-insensitive
    const caseInsensitive = process.platform === 'darwin' || process.platform === 'win32';

    const normalizedTarget = caseInsensitive ? targetPath.toLowerCase() : targetPath;

    return this.systemRestrictedPaths.some(restrictedPath => {
      const normalizedRestricted = caseInsensitive ? restrictedPath.toLowerCase() : restrictedPath;
      return normalizedTarget.startsWith(normalizedRestricted) || normalizedTarget === normalizedRestricted;
    });
  }

  /**
   * Check if path is custom restricted
   * @private
   */
  isCustomRestricted(targetPath, customRestrictions) {
    if (!customRestrictions || customRestrictions.length === 0) {
      return false;
    }

    return customRestrictions.some(restriction => {
      return targetPath.startsWith(restriction) || targetPath === restriction;
    });
  }

  /**
   * Find overlapping paths between two arrays
   * @private
   */
  findOverlappingPaths(paths1, paths2) {
    const overlapping = [];

    for (const path1 of paths1) {
      for (const path2 of paths2) {
        if (this.isPathWithinDirectory(path1, path2) || this.isPathWithinDirectory(path2, path1)) {
          overlapping.push(`${path1} <-> ${path2}`);
        }
      }
    }

    return overlapping;
  }

  /**
   * Get directory access summary for logging/debugging
   * @param {Object} accessConfig - Directory access configuration
   * @returns {Object} Summary object
   */
  getAccessSummary(accessConfig) {
    return {
      workingDirectory: accessConfig.workingDirectory,
      readOnlyCount: accessConfig.readOnlyDirectories.length,
      writeEnabledCount: accessConfig.writeEnabledDirectories.length,
      projectRestricted: accessConfig.restrictToProject,
      systemAccessAllowed: accessConfig.allowSystemAccess,
      customRestrictionsCount: accessConfig.customRestrictions?.length || 0,
      configVersion: accessConfig.version || 'unknown',
      lastUpdated: accessConfig.updatedAt || accessConfig.createdAt
    };
  }

  /**
   * Create default directory access for project-based agents
   * @param {string} projectDir - Project directory path
   * @returns {Object} Default directory access configuration
   */
  static createProjectDefaults(projectDir) {
    const resolvedProject = path.resolve(projectDir);
    
    return {
      workingDirectory: resolvedProject,
      readOnlyDirectories: [resolvedProject],
      writeEnabledDirectories: [resolvedProject],
      restrictToProject: true,
      allowSystemAccess: false,
      customRestrictions: [],
      createdAt: new Date().toISOString(),
      version: '1.0'
    };
  }

  /**
   * Create permissive directory access (use with caution)
   * @param {string} workingDir - Working directory
   * @returns {Object} Permissive directory access configuration
   */
  static createPermissiveDefaults(workingDir = process.cwd()) {
    return {
      workingDirectory: path.resolve(workingDir),
      readOnlyDirectories: [os.homedir()],
      writeEnabledDirectories: [path.resolve(workingDir)],
      restrictToProject: false,
      allowSystemAccess: false,
      customRestrictions: [],
      createdAt: new Date().toISOString(),
      version: '1.0'
    };
  }
}

export default DirectoryAccessManager;