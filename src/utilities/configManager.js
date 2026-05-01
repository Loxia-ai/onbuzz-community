/**
 * ConfigManager - Centralized configuration management for the Loxia AI Agents System
 * 
 * Purpose:
 * - Load and merge configuration from multiple sources
 * - Environment variable support
 * - Configuration validation
 * - Runtime configuration updates
 * - Default configuration management
 */

import { promises as fs } from 'fs';
import path from 'path';

import {
  SYSTEM_DEFAULTS,
  MODELS,
  TOOL_NAMES,
  STATE_DIRECTORIES,
  ERROR_TYPES
} from './constants.js';

class ConfigManager {
  constructor(options = {}) {
    this.configPaths = options.configPaths || [];
    this.envPrefix = options.envPrefix || 'LOXIA';
    this.config = {};
    this.watchers = new Map();
    this.changeListeners = new Set();
    
    // Default configuration
    this.defaultConfig = this.getDefaultConfig();
  }

  /**
   * Load configuration from all sources
   * @returns {Promise<Object>} Loaded configuration
   */
  async loadConfig() {
    let config = { ...this.defaultConfig };
    
    // Load from config files
    for (const configPath of this.configPaths) {
      try {
        const fileConfig = await this.loadConfigFile(configPath);
        config = this.mergeConfig(config, fileConfig);
      } catch (error) {
        console.warn(`Failed to load config file ${configPath}:`, error.message);
      }
    }
    
    // Override with environment variables
    const envConfig = this.loadEnvironmentConfig();
    config = this.mergeConfig(config, envConfig);
    
    // Validate configuration
    const validation = this.validateConfig(config);
    if (!validation.valid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
    }
    
    // Apply configuration transformations
    config = this.transformConfig(config);
    
    this.config = config;
    
    // Notify listeners of config change
    this.notifyConfigChange(config);
    
    return config;
  }

  /**
   * Get current configuration
   * @returns {Object} Current configuration
   */
  getConfig() {
    return { ...this.config };
  }

  /**
   * Get configuration value by path
   * @param {string} path - Configuration path (e.g., 'system.maxAgentsPerProject')
   * @param {*} defaultValue - Default value if path not found
   * @returns {*} Configuration value
   */
  get(path, defaultValue = undefined) {
    const keys = path.split('.');
    let value = this.config;
    
    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = value[key];
      } else {
        return defaultValue;
      }
    }
    
    return value;
  }

  /**
   * Set configuration value by path
   * @param {string} path - Configuration path
   * @param {*} value - Value to set
   */
  set(path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let target = this.config;
    
    // Navigate to parent object
    for (const key of keys) {
      if (!(key in target) || typeof target[key] !== 'object') {
        target[key] = {};
      }
      target = target[key];
    }
    
    target[lastKey] = value;
    
    // Notify listeners of config change
    this.notifyConfigChange(this.config);
  }

  /**
   * Watch configuration files for changes
   * @param {boolean} enable - Enable or disable watching
   * @returns {Promise<void>}
   */
  async watchConfig(enable = true) {
    if (!enable) {
      // Stop all watchers
      for (const [filePath, watcher] of this.watchers) {
        watcher.close();
        this.watchers.delete(filePath);
      }
      return;
    }
    
    // Start watching config files
    for (const configPath of this.configPaths) {
      if (this.watchers.has(configPath)) continue;
      
      try {
        const { watch } = await import('fs');
        const watcher = watch(configPath, async (eventType) => {
          if (eventType === 'change') {
            try {
              await this.loadConfig();
            } catch (error) {
              console.error(`Failed to reload config after change in ${configPath}:`, error.message);
            }
          }
        });
        
        this.watchers.set(configPath, watcher);
      } catch (error) {
        console.warn(`Failed to watch config file ${configPath}:`, error.message);
      }
    }
  }

  /**
   * Add configuration change listener
   * @param {Function} listener - Change listener function
   */
  addChangeListener(listener) {
    this.changeListeners.add(listener);
  }

  /**
   * Remove configuration change listener
   * @param {Function} listener - Change listener function
   */
  removeChangeListener(listener) {
    this.changeListeners.delete(listener);
  }

  /**
   * Load configuration from file
   * @private
   */
  async loadConfigFile(filePath) {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      
      const ext = path.extname(filePath).toLowerCase();
      switch (ext) {
        case '.json':
          return JSON.parse(content);
        
        case '.js':
          // For .js files, use dynamic import
          const fullPath = path.resolve(filePath);
          const module = await import(fullPath);
          return module.default || module;
        
        case '.yaml':
        case '.yml':
          // Would need yaml parser dependency
          throw new Error('YAML configuration files not supported in this implementation');
        
        default:
          throw new Error(`Unsupported configuration file format: ${ext}`);
      }
    } catch (error) {
      throw new Error(`Failed to load config file ${filePath}: ${error.message}`);
    }
  }

  /**
   * Load configuration from environment variables
   * @private
   */
  loadEnvironmentConfig() {
    const envConfig = {};
    
    // Map environment variables to config paths
    const envMappings = {
      [`${this.envPrefix}_LOG_LEVEL`]: 'logging.level',
      [`${this.envPrefix}_MAX_AGENTS`]: 'system.maxAgentsPerProject',
      [`${this.envPrefix}_DEFAULT_MODEL`]: 'system.defaultModel',
      [`${this.envPrefix}_BACKEND_TIMEOUT`]: 'backend.timeout',
      // Provider keys can also flow through env vars (read by ApiKeyManager)
      OPENAI_API_KEY:    'providers.openai.apiKey',
      ANTHROPIC_API_KEY: 'providers.anthropic.apiKey',
      GEMINI_API_KEY:    'providers.gemini.apiKey',
      XAI_API_KEY:       'providers.xai.apiKey',
      OLLAMA_HOST:       'providers.ollama.host',
      LOXIA_MODELS_PATH:     'modelsPath',
      LOXIA_BENCHMARKS_PATH: 'benchmarksPath',
      [`${this.envPrefix}_STATE_DIR`]: 'system.stateDirectory',
      [`${this.envPrefix}_BUDGET_LIMIT`]: 'budget.limit',
      [`${this.envPrefix}_TOOLS_ENABLED`]: 'tools.enabled',
      [`${this.envPrefix}_VISUAL_EDITOR_PORT`]: 'visualEditor.port',
      [`${this.envPrefix}_VISUAL_EDITOR_DEFAULT_APP_URL`]: 'visualEditor.defaultAppUrl',
      [`${this.envPrefix}_PORT`]: 'server.port'
    };
    
    for (const [envVar, configPath] of Object.entries(envMappings)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        this.setNestedValue(envConfig, configPath, this.parseEnvValue(value));
      }
    }
    
    return envConfig;
  }

  /**
   * Parse environment variable value
   * @private
   */
  parseEnvValue(value) {
    // Try to parse as JSON first
    try {
      return JSON.parse(value);
    } catch {
      // Return as string if not valid JSON
      return value;
    }
  }

  /**
   * Set nested object value by path
   * @private
   */
  setNestedValue(obj, path, value) {
    const keys = path.split('.');
    const lastKey = keys.pop();
    let target = obj;
    
    for (const key of keys) {
      if (!(key in target)) {
        target[key] = {};
      }
      target = target[key];
    }
    
    target[lastKey] = value;
  }

  /**
   * Merge configuration objects
   * @private
   */
  mergeConfig(base, override) {
    const result = { ...base };
    
    for (const [key, value] of Object.entries(override)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.mergeConfig(result[key] || {}, value);
      } else {
        result[key] = value;
      }
    }
    
    return result;
  }

  /**
   * Validate configuration
   * @private
   */
  validateConfig(config) {
    const errors = [];
    
    // Validate system configuration
    if (config.system) {
      const { maxAgentsPerProject, defaultModel, stateDirectory } = config.system;
      
      if (maxAgentsPerProject && (typeof maxAgentsPerProject !== 'number' || maxAgentsPerProject < 1)) {
        errors.push('system.maxAgentsPerProject must be a positive number');
      }
      
      if (defaultModel && !Object.values(MODELS).includes(defaultModel)) {
        errors.push(`system.defaultModel must be one of: ${Object.values(MODELS).join(', ')}`);
      }
      
      if (stateDirectory && typeof stateDirectory !== 'string') {
        errors.push('system.stateDirectory must be a string');
      }
    }
    
    // Validate backend configuration (timeout only — no central backend in OSS)
    if (config.backend) {
      const { timeout } = config.backend;
      if (timeout && (typeof timeout !== 'number' || timeout < 1000)) {
        errors.push('backend.timeout must be a number >= 1000');
      }
    }
    
    // Validate tool configuration
    if (config.tools) {
      for (const [toolName, toolConfig] of Object.entries(config.tools)) {
        if (toolConfig && typeof toolConfig !== 'object') {
          errors.push(`tools.${toolName} must be an object`);
        }
        
        if (toolConfig?.timeout && (typeof toolConfig.timeout !== 'number' || toolConfig.timeout < 1000)) {
          errors.push(`tools.${toolName}.timeout must be a number >= 1000`);
        }
      }
    }
    
    // Validate visual editor configuration
    if (config.visualEditor) {
      const { port, defaultAppUrl, maxInstances, connectionTimeout } = config.visualEditor;

      if (port && (typeof port !== 'number' || port < 1 || port > 65535)) {
        errors.push('visualEditor.port must be a valid port number (1-65535)');
      }

      if (defaultAppUrl && typeof defaultAppUrl !== 'string') {
        errors.push('visualEditor.defaultAppUrl must be a string URL');
      }

      if (maxInstances && (typeof maxInstances !== 'number' || maxInstances < 1)) {
        errors.push('visualEditor.maxInstances must be a positive number');
      }

      if (connectionTimeout && (typeof connectionTimeout !== 'number' || connectionTimeout < 1000)) {
        errors.push('visualEditor.connectionTimeout must be a number >= 1000');
      }
    }

    // Validate server configuration
    if (config.server) {
      const { port } = config.server;

      if (port && (typeof port !== 'number' || port < 1 || port > 65535)) {
        errors.push('server.port must be a valid port number (1-65535)');
      }
    }

    // Validate model routing
    if (config.models?.routingTable) {
      const routingTable = config.models.routingTable;
      
      for (const [task, models] of Object.entries(routingTable)) {
        if (!Array.isArray(models)) {
          errors.push(`models.routingTable.${task} must be an array`);
          continue;
        }
        
        for (const model of models) {
          if (!Object.values(MODELS).includes(model)) {
            errors.push(`Invalid model in routing table: ${model}`);
          }
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Transform configuration after loading
   * @private
   */
  transformConfig(config) {
    // Ensure required nested objects exist
    if (!config.system) config.system = {};
    if (!config.backend) config.backend = {};
    if (!config.tools) config.tools = {};
    if (!config.models) config.models = {};
    if (!config.context) config.context = {};
    if (!config.logging) config.logging = {};
    
    // Apply defaults for missing values
    config.system.maxAgentsPerProject = config.system.maxAgentsPerProject || SYSTEM_DEFAULTS.MAX_AGENTS_PER_PROJECT;
    config.system.defaultModel = config.system.defaultModel || SYSTEM_DEFAULTS.DEFAULT_MODEL;
    config.system.stateDirectory = config.system.stateDirectory || SYSTEM_DEFAULTS.STATE_DIRECTORY;
    config.system.maxPauseDuration = config.system.maxPauseDuration || SYSTEM_DEFAULTS.MAX_PAUSE_DURATION;
    
    config.context.maxSize = config.context.maxSize || SYSTEM_DEFAULTS.MAX_CONTEXT_SIZE;
    config.context.maxReferences = config.context.maxReferences || SYSTEM_DEFAULTS.MAX_CONTEXT_REFERENCES;
    config.context.autoValidation = config.context.autoValidation !== false;
    config.context.cacheExpiry = config.context.cacheExpiry || SYSTEM_DEFAULTS.CACHE_EXPIRY;

    // Ensure essential tools are configured
    for (const toolName of Object.values(TOOL_NAMES)) {
      if (!config.tools[toolName]) {
        config.tools[toolName] = {
          enabled: true,
          timeout: SYSTEM_DEFAULTS.MAX_TOOL_EXECUTION_TIME
        };
      }
    }
    
    return config;
  }

  /**
   * Notify configuration change listeners
   * @private
   */
  notifyConfigChange(config) {
    for (const listener of this.changeListeners) {
      try {
        listener(config);
      } catch (error) {
        console.error('Config change listener error:', error.message);
      }
    }
  }

  /**
   * Get default configuration
   * @private
   */
  getDefaultConfig() {
    return {
      system: {
        maxAgentsPerProject: SYSTEM_DEFAULTS.MAX_AGENTS_PER_PROJECT,
        qualityInspectorInterval: SYSTEM_DEFAULTS.QUALITY_INSPECTOR_INTERVAL,
        defaultModel: SYSTEM_DEFAULTS.DEFAULT_MODEL,
        stateDirectory: SYSTEM_DEFAULTS.STATE_DIRECTORY,
        maxPauseDuration: SYSTEM_DEFAULTS.MAX_PAUSE_DURATION
      },
      
      context: {
        maxSize: SYSTEM_DEFAULTS.MAX_CONTEXT_SIZE,
        maxReferences: SYSTEM_DEFAULTS.MAX_CONTEXT_REFERENCES,
        autoValidation: true,
        cacheExpiry: SYSTEM_DEFAULTS.CACHE_EXPIRY
      },
      
      models: {},

      tools: {
        [TOOL_NAMES.TERMINAL]: {
          timeout: 30000,
          enabled: true
        },
        [TOOL_NAMES.FILESYSTEM]: {
          maxFileSize: SYSTEM_DEFAULTS.MAX_FILE_SIZE,
          enabled: true
        },
        [TOOL_NAMES.BROWSER]: {
          timeout: 60000,
          enabled: true
        },
        [TOOL_NAMES.AGENT_DELAY]: {
          maxDuration: SYSTEM_DEFAULTS.MAX_PAUSE_DURATION,
          enabled: true
        }
      },
      
      // LLM provider request timeout (no central backend in OSS — each
      // provider adapter inherits this when the user doesn't override it).
      backend: {
        timeout: 270000,
      },


      budget: {
        limit: 100.00,
        alertThreshold: 0.8,
        trackUsage: true
      },
      
      logging: {
        level: 'info',
        outputs: ['console'],
        colors: true,
        timestamp: true
      },
      
      interfaces: {
        cli: {
          enabled: true,
          historySize: 1000
        },
        web: {
          enabled: true,
          port: 3000,
          host: 'localhost'
        },
        vscode: {
          enabled: true,
          contextMenus: true,
          statusBar: true
        }
      },

      server: {
        port: 8080,
        host: 'localhost'
      },

      visualEditor: {
        port: 4000,
        defaultAppUrl: 'http://localhost:3000',
        maxInstances: 5,
        connectionTimeout: 10000
      }
    };
  }

  /**
   * Export configuration to file
   * @param {string} filePath - Target file path
   * @param {Object} options - Export options
   * @returns {Promise<void>}
   */
  async exportConfig(filePath, options = {}) {
    const config = options.includeDefaults ? 
      this.getConfig() : 
      this.getConfigWithoutDefaults();
    
    const ext = path.extname(filePath).toLowerCase();
    let content;
    
    switch (ext) {
      case '.json':
        content = JSON.stringify(config, null, 2);
        break;
      
      case '.js':
        content = `module.exports = ${JSON.stringify(config, null, 2)};`;
        break;
      
      default:
        throw new Error(`Unsupported export format: ${ext}`);
    }
    
    await fs.writeFile(filePath, content, 'utf8');
  }

  /**
   * Get configuration without default values
   * @private
   */
  getConfigWithoutDefaults() {
    // This would return only explicitly set values
    // For now, return the full config
    return this.getConfig();
  }

  /**
   * Reset configuration to defaults
   */
  resetToDefaults() {
    this.config = { ...this.defaultConfig };
    this.notifyConfigChange(this.config);
  }

  /**
   * Cleanup resources
   */
  cleanup() {
    // Stop watching files
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();
    
    // Clear listeners
    this.changeListeners.clear();
  }
}

/**
 * Create a configuration manager instance
 * @param {Object} options - Configuration options
 * @returns {ConfigManager} ConfigManager instance
 */
function createConfigManager(options = {}) {
  return new ConfigManager(options);
}

export { ConfigManager, createConfigManager };