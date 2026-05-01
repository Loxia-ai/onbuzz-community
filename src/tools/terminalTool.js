/**
 * TerminalTool - Execute terminal/command line operations
 * 
 * Purpose:
 * - Execute system commands safely
 * - Handle directory navigation
 * - Manage command output and errors
 * - Support both synchronous and asynchronous execution
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import DirectoryAccessManager from '../utilities/directoryAccessManager.js';
import { spawn, exec } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

import {
  TOOL_STATUS,
  SYSTEM_DEFAULTS,
  TERMINAL_CONFIG
} from '../utilities/constants.js';
import { checkDedup, denialResult } from './terminalDedup.js';

/**
 * PromptDetector - Detects interactive prompts in command output
 * Phase 2: Prompt Detection System
 */
class PromptDetector {
  constructor() {
    // Common prompt patterns (case-insensitive)
    this.promptPatterns = [
      // Yes/No prompts
      { pattern: /\(y\/n\)/i, type: 'yes-no', description: 'Yes/No question' },
      { pattern: /\(Y\/n\)/i, type: 'yes-no-default-yes', description: 'Yes/No (default Yes)' },
      { pattern: /\(y\/N\)/i, type: 'yes-no-default-no', description: 'Yes/No (default No)' },
      { pattern: /\[y\/n\]/i, type: 'yes-no', description: 'Yes/No question' },
      { pattern: /\[Y\/n\]/i, type: 'yes-no-default-yes', description: 'Yes/No (default Yes)' },
      { pattern: /\[y\/N\]/i, type: 'yes-no-default-no', description: 'Yes/No (default No)' },

      // Continue prompts
      { pattern: /continue\?/i, type: 'continue', description: 'Continue prompt' },
      { pattern: /proceed\?/i, type: 'continue', description: 'Proceed prompt' },
      { pattern: /press any key to continue/i, type: 'keypress', description: 'Press any key' },
      { pattern: /press enter to continue/i, type: 'keypress', description: 'Press enter' },
      { pattern: /hit enter to continue/i, type: 'keypress', description: 'Hit enter' },

      // Password/Authentication prompts
      { pattern: /password:/i, type: 'password', description: 'Password prompt' },
      { pattern: /enter password/i, type: 'password', description: 'Password prompt' },
      { pattern: /passphrase:/i, type: 'password', description: 'Passphrase prompt' },
      { pattern: /username:/i, type: 'username', description: 'Username prompt' },
      { pattern: /enter username/i, type: 'username', description: 'Username prompt' },

      // Input prompts
      { pattern: /enter\s+\w+:/i, type: 'input', description: 'Generic input prompt' },
      { pattern: /please enter/i, type: 'input', description: 'Generic input prompt' },
      { pattern: /input:/i, type: 'input', description: 'Generic input prompt' },

      // Confirmation prompts
      { pattern: /are you sure\?/i, type: 'confirmation', description: 'Confirmation prompt' },
      { pattern: /do you want to/i, type: 'confirmation', description: 'Confirmation prompt' },
      { pattern: /would you like to/i, type: 'confirmation', description: 'Confirmation prompt' },

      // Selection prompts
      { pattern: /select an option/i, type: 'selection', description: 'Selection prompt' },
      { pattern: /choose/i, type: 'selection', description: 'Selection prompt' },
      { pattern: /\d+\)\s+\w+/g, type: 'menu', description: 'Menu selection' } // Matches: 1) Option
    ];
  }

  /**
   * Analyze output for prompt patterns
   * @param {string} output - Output text to analyze (stdout or stderr)
   * @param {string} source - Source of output ('stdout' or 'stderr')
   * @returns {Object|null} Prompt detection result or null
   */
  detectPrompt(output, source = 'stdout') {
    if (!output || output.trim().length === 0) {
      return null;
    }

    // Get the last few lines (prompts are usually at the end)
    const lines = output.split('\n');
    const lastLines = lines.slice(-5).join('\n'); // Check last 5 lines

    // Check each pattern
    for (const promptDef of this.promptPatterns) {
      const match = lastLines.match(promptDef.pattern);
      if (match) {
        return {
          detected: true,
          type: promptDef.type,
          description: promptDef.description,
          matchedText: match[0],
          matchIndex: match.index,
          source: source,
          fullContext: lastLines,
          timestamp: Date.now()
        };
      }
    }

    // Check for generic prompt indicators
    // Look for lines ending with : or ? without newline after
    const lastLine = lines[lines.length - 1] || '';
    if (lastLine.trim().length > 0) {
      const endsWithColon = /:\s*$/.test(lastLine);
      const endsWithQuestion = /\?\s*$/.test(lastLine);

      if (endsWithColon || endsWithQuestion) {
        // Might be a prompt - check if it's asking for input
        const looksLikePrompt = /\b(enter|type|provide|specify|input)\b/i.test(lastLine);
        if (looksLikePrompt) {
          return {
            detected: true,
            type: 'generic',
            description: 'Generic input prompt detected',
            matchedText: lastLine.trim(),
            source: source,
            fullContext: lastLines,
            timestamp: Date.now(),
            confidence: 0.7 // Lower confidence for generic detection
          };
        }
      }
    }

    return null;
  }

  /**
   * Check if output indicates command is waiting (no prompt but no output)
   * @param {number} lastOutputTime - Timestamp of last output
   * @param {number} hangThresholdMs - Milliseconds to consider as hanging
   * @returns {Object} Hang detection result
   */
  detectHang(lastOutputTime, hangThresholdMs = 30000) {
    const now = Date.now();
    const timeSinceLastOutput = now - lastOutputTime;

    return {
      isHanging: timeSinceLastOutput >= hangThresholdMs,
      timeSinceLastOutput: timeSinceLastOutput,
      threshold: hangThresholdMs,
      likelyWaiting: timeSinceLastOutput >= hangThresholdMs / 2 // 50% threshold
    };
  }
}

class TerminalTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Tool metadata
    this.requiresProject = false;
    this.isAsync = false; // Most commands are quick, use sync execution
    this.timeout = config.timeout || 120000; // 2 minutes default
    this.maxConcurrentOperations = config.maxConcurrentOperations || 3;

    // Current working directories per context
    this.workingDirectories = new Map();

    // Command history
    this.commandHistory = [];

    // Security settings
    this.allowedCommands = config.allowedCommands || null; // null = all allowed
    this.blockedCommands = config.blockedCommands || [
      'rm -rf /',
      'format',
      'del /f /q',
      'shutdown',
      'reboot',
      'halt'
    ];

    // Directory access manager
    this.directoryAccessManager = new DirectoryAccessManager(config, logger);

    // Prompt detector (Phase 2)
    this.promptDetector = new PromptDetector();

    // Phase 3 & 4: Background command tracking
    this.commandTracker = new Map(); // commandId -> { agentId, pid, process, state, buffers, timestamps }

    // Per-agent denial token for the duplicate-command dedup feature.
    // Map<agentId, { command, deniedAt }>. Set when the dedup check
    // refuses a duplicate-while-running. Consumed (single-use) when the
    // agent retries the SAME command with force:true. The token's
    // existence is what makes force:true meaningful — without a prior
    // denial, force is silently ignored, which prevents agents from
    // preemptively passing force on every call to bypass dedup.
    this.lastDeniedExec = new Map();
    this.commandIdCounter = 0;

    // Resource limits
    this.MAX_BACKGROUND_COMMANDS_PER_AGENT = config.maxBackgroundCommandsPerAgent || 5;
    this.MAX_BACKGROUND_COMMANDS_GLOBAL = config.maxBackgroundCommandsGlobal || 20;
    this.MAX_COMMAND_AGE_MINUTES = config.maxCommandAgeMinutes || 60;

    // Terminal detection
    this.detectedTerminal = null;
    this.platformType = null;
    this.initializeTerminalDetection();
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Terminal Tool: Execute system commands and manage terminal operations safely.

IMPORTANT: For file and directory creation, prefer using the FileSystem tool.
Reserve the Terminal tool for command-line operations like npm, git, curl, etc.

USAGE:
\`\`\`json
{
  "toolId": "terminal",
  "actions": [
    {"type": "run-command", "command": "npm install express"},
    {"type": "change-directory", "directory": "project/backend"}
  ]
}
\`\`\`

SUPPORTED ACTIONS:
- run-command: Execute a command (command)
- change-directory: Change working directory (directory)
- list-directory: List directory contents (directory)
- create-directory: Create directory (directory) - prefer FileSystem tool
- get-working-directory: Get current directory

PARAMETERS:
- command: The command to execute
- directory: Directory path for navigation/operations
- timeout: Optional timeout in milliseconds (max ${this.timeout}ms)
- async: Whether to run command asynchronously (true/false)

EXAMPLES:

Run npm install:
\`\`\`json
{"toolId": "terminal", "actions": [{"type": "run-command", "command": "npm install"}]}
\`\`\`

Git operations:
\`\`\`json
{
  "toolId": "terminal",
  "actions": [
    {"type": "run-command", "command": "git status"},
    {"type": "run-command", "command": "git add ."},
    {"type": "run-command", "command": "git commit -m \\"Update files\\""}
  ]
}
\`\`\`

Change directory and build:
\`\`\`json
{
  "toolId": "terminal",
  "actions": [
    {"type": "change-directory", "directory": "../frontend"},
    {"type": "run-command", "command": "npm run build"}
  ]
}
\`\`\`

SECURITY:
- Dangerous commands are blocked
- Commands execute in isolated environment
- Output is captured and returned safely

BEST PRACTICES:
- Use FileSystem tool for file/directory operations
- Use Terminal for CLI utilities (npm, git, curl, etc.)
- Check command output to verify success

After each invocation you will get a tool-result embedded in the following user message, avoid invoking identical consecutive commands and always check the tool-result and output before retrying same command.
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
      
      // Extract individual action parameters
      const runCommandMatches = TagParser.extractContent(content, 'run-command');
      const changeDirMatches = TagParser.extractContent(content, 'change-directory');
      const listDirMatches = TagParser.extractContent(content, 'list-directory');
      const createDirMatches = TagParser.extractContent(content, 'create-directory');
      const getWdMatches = TagParser.extractContent(content, 'get-working-directory');
      const timeoutMatches = TagParser.extractContent(content, 'timeout');
      const asyncMatches = TagParser.extractContent(content, 'async');
      
      // Build actions array
      const actions = [];
      
      if (runCommandMatches.length > 0) {
        actions.push({
          type: 'run-command',
          command: runCommandMatches[0].trim()
        });
      }
      
      if (changeDirMatches.length > 0) {
        actions.push({
          type: 'change-directory',
          directory: changeDirMatches[0].trim()
        });
      }
      
      if (listDirMatches.length > 0) {
        actions.push({
          type: 'list-directory',
          directory: listDirMatches[0].trim() || '.'
        });
      }
      
      if (createDirMatches.length > 0) {
        actions.push({
          type: 'create-directory',
          directory: createDirMatches[0].trim()
        });
      }
      
      if (getWdMatches.length > 0) {
        actions.push({
          type: 'get-working-directory'
        });
      }
      
      params.actions = actions;
      
      // Parse additional options
      if (timeoutMatches.length > 0) {
        params.timeout = parseInt(timeoutMatches[0], 10);
      }
      
      if (asyncMatches.length > 0) {
        params.async = asyncMatches[0].toLowerCase() === 'true';
      }
      
      params.rawContent = content.trim();
      
      return params;
      
    } catch (error) {
      throw new Error(`Failed to parse terminal parameters: ${error.message}`);
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
          case 'run-command':
            if (!action.command || !action.command.trim()) {
              errors.push(`Action ${index + 1}: command is required for run-command`);
            } else if (this.isBlockedCommand(action.command)) {
              errors.push(`Action ${index + 1}: command is blocked for security: ${action.command}`);
            } else if (this.allowedCommands && !this.isAllowedCommand(action.command)) {
              errors.push(`Action ${index + 1}: command is not in allowed list: ${action.command}`);
            }
            break;
            
          case 'change-directory':
          case 'list-directory':
          case 'create-directory':
            if (!action.directory || !action.directory.trim()) {
              errors.push(`Action ${index + 1}: directory is required for ${action.type}`);
            }
            break;
            
          case 'get-working-directory':
            // No additional validation needed
            break;
            
          default:
            errors.push(`Action ${index + 1}: unknown action type: ${action.type}`);
        }
      }
    }
    
    if (params.timeout && (params.timeout < 1000 || params.timeout > this.timeout)) {
      errors.push(`Timeout must be between 1000 and ${this.timeout} milliseconds`);
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
    const { actions, timeout: customTimeout, async: forceAsync } = params;
    const { agentId, projectDir, directoryAccess } = context;

    // Per-agent terminal config overrides (agent.toolConfig.terminal).
    // Falls back to this.config-level lists from constructor (global
    // defaults). If neither is set, allowedCommands is null (=any) and
    // blockedCommands is the class-default set from the constructor.
    const effectiveConfig = this.getEffectiveConfig(context, {
      allowedCommands: this.allowedCommands,
      blockedCommands: this.blockedCommands,
      maxBackgroundCommandsPerAgent: this.MAX_BACKGROUND_COMMANDS_PER_AGENT,
    });
    const allowedOverride = Array.isArray(effectiveConfig.allowedCommands)
      ? effectiveConfig.allowedCommands
      : this.allowedCommands;
    const blockedOverride = Array.isArray(effectiveConfig.blockedCommands)
      ? effectiveConfig.blockedCommands
      : this.blockedCommands;

    // Re-validate each run-command action against the per-agent rules.
    // customValidateParameters() runs BEFORE execute and cannot see the
    // context, so it only applies global rules. This pass catches
    // commands that the per-agent overrides forbid.
    for (const action of actions) {
      if (action.type === 'run-command' && typeof action.command === 'string') {
        if (this._matchesAny(action.command, blockedOverride)) {
          return {
            success: false,
            error: `Command is blocked by agent policy: ${action.command}`,
            actions: [],
          };
        }
        if (allowedOverride && allowedOverride.length > 0
            && !this._matchesAny(action.command, allowedOverride, { prefix: true })) {
          return {
            success: false,
            error: `Command is not in the agent's allowed list: ${action.command}`,
            actions: [],
          };
        }
      }
    }

    // Get directory access configuration from agent or create default
    const accessConfig = directoryAccess ||
      this.directoryAccessManager.createDirectoryAccess({
        workingDirectory: projectDir || process.cwd(),
        writeEnabledDirectories: [projectDir || process.cwd()],
        restrictToProject: true
      });
    
    // IMPORTANT: If the agent has directoryAccess configured, use its workingDirectory
    // This ensures UI-configured project directories are respected
    
    // Get or set current working directory for this agent
    const contextKey = `${agentId}-${projectDir || 'default'}`;
    let currentWorkingDir = this.workingDirectories.get(contextKey) || 
      this.directoryAccessManager.getWorkingDirectory(accessConfig);
    
    const results = [];
    
    for (const action of actions) {
      try {
        let result;
        
        switch (action.type) {
          case 'run-command':
            // Dedup gate: if an identical command is already running for
            // this agent, deny — unless the agent has been previously
            // denied for this exact command and now passes force:true.
            // See terminalDedup.js for the full contract.
            {
              const dedup = checkDedup({
                commandTracker:  this.commandTracker,
                lastDeniedExec:  this.lastDeniedExec,
                agentId,
                command:         action.command,
                force:           action.force === true,
                config:          effectiveConfig,
              });
              if (!dedup.allow) {
                result = denialResult(dedup, action.command);
                break;
              }
            }
            result = await this.executeCommand(action.command, currentWorkingDir, {
              timeout: customTimeout || this.timeout,
              async: forceAsync || false,
              agentId,
              context: {
                toolsRegistry: context.toolsRegistry,
                aiService: context.aiService,
                apiKey: context.apiKey,
                customApiKeys: context.customApiKeys,
              }
            });
            break;
            
          case 'change-directory':
            result = await this.changeDirectory(action.directory, currentWorkingDir, accessConfig);
            currentWorkingDir = result.newDirectory;
            this.workingDirectories.set(contextKey, currentWorkingDir);
            // Propagate to the agent's directoryAccess so all other tools
            // (filesystem, seek, etc.) resolve paths from the same base
            if (directoryAccess) {
              directoryAccess.workingDirectory = currentWorkingDir;
            }
            break;
            
          case 'list-directory':
            result = await this.listDirectory(action.directory === '.' ? currentWorkingDir : action.directory);
            break;
            
          case 'create-directory':
            result = await this.createDirectory(action.directory, currentWorkingDir);
            break;
            
          case 'get-working-directory':
            result = {
              success: true,
              action: 'get-working-directory',
              workingDirectory: currentWorkingDir,
              message: `Current working directory: ${currentWorkingDir}`
            };
            break;
            
          default:
            throw new Error(`Unknown action type: ${action.type}`);
        }
        
        results.push(result);
        
        // Add to command history
        this.addToHistory(action, result, agentId);
        
      } catch (error) {
        const errorResult = {
          success: false,
          action: action.type,
          error: error.message,
          command: action.command || action.directory,
          workingDirectory: currentWorkingDir
        };
        
        results.push(errorResult);
        this.addToHistory(action, errorResult, agentId);
      }
    }
    
    // Determine overall success based on individual action results
    const overallSuccess = results.every(result => result.success);
    const failedActions = results.filter(result => !result.success);
    
    return {
      success: overallSuccess,
      actions: results,
      workingDirectory: currentWorkingDir,
      executedActions: actions.length,
      failedActions: failedActions.length,
      toolUsed: 'terminal',
      message: overallSuccess 
        ? `All ${actions.length} actions completed successfully`
        : `${failedActions.length} of ${actions.length} actions failed`
    };
  }

  /**
   * Execute a command in the specified directory
   * @private
   */
  async executeCommand(command, workingDir, options = {}) {
    const { timeout = this.timeout, async: isAsync = false, agentId, context } = options;

    // Translate command for current terminal (now async with AI support)
    const originalCommand = command;
    let translatedCommand;

    try {
      translatedCommand = await this.translateCommand(command, {
        agentId,
        toolsRegistry: context?.toolsRegistry,
        messageProcessor: context?.messageProcessor,
        aiService: context?.aiService,
        apiKey: context?.apiKey,
        customApiKeys: context?.customApiKeys,
      });
    } catch (error) {
      this.logger?.warn('Command translation failed, using original command', {
        originalCommand,
        error: error.message
      });
      translatedCommand = command;
    }

    // Generate command ID for tracking
    const commandId = `${agentId || 'unknown'}-cmd-${Date.now()}-${++this.commandIdCounter}`;

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      this.logger?.info(`Executing command: ${translatedCommand}`, {
        originalCommand,
        translatedCommand,
        terminal: this.detectedTerminal,
        workingDirectory: workingDir,
        timeout,
        agentId,
        commandId
      });

      // Track this command in commandTracker for UI visibility
      const commandInfo = {
        commandId,
        agentId: agentId || 'unknown',
        pid: null,
        command: originalCommand,
        translatedCommand,
        workingDirectory: workingDir,
        startTime: new Date().toISOString(),
        state: TERMINAL_CONFIG.STATES.RUNNING,
        exitCode: null,
        stdoutBuffer: '',
        stderrBuffer: '',
        lastOutputTime: Date.now(),
        promptDetected: null,
        process: null,
        isBackground: false
      };
      this.commandTracker.set(commandId, commandInfo);

      const childProcess = exec(translatedCommand, {
        cwd: workingDir,
        timeout,
        maxBuffer: 1024 * 1024, // 1MB buffer
        env: { ...process.env }
      }, (error, stdout, stderr) => {
        const executionTime = Date.now() - startTime;

        // Update tracked command info
        commandInfo.stdoutBuffer = stdout;
        commandInfo.stderrBuffer = stderr;
        commandInfo.endTime = new Date().toISOString();
        commandInfo.lastOutputTime = Date.now();

        if (error) {
          commandInfo.state = TERMINAL_CONFIG.STATES.FAILED;
          commandInfo.exitCode = error.code || -1;
          commandInfo.error = error.message;

          this.logger?.error(`Command failed: ${translatedCommand}`, {
            originalCommand,
            translatedCommand,
            error: error.message,
            workingDirectory: workingDir,
            executionTime,
            commandId
          });

          resolve({
            success: false,
            action: 'run-command',
            command: originalCommand,
            commandId,
            translatedCommand: translatedCommand !== originalCommand ? translatedCommand : undefined,
            error: error.message,
            stderr: stderr.trim(),
            stdout: stdout.trim(),
            exitCode: error.code,
            executionTime,
            workingDirectory: workingDir
          });
          return;
        }

        commandInfo.state = TERMINAL_CONFIG.STATES.COMPLETED;
        commandInfo.exitCode = 0;

        this.logger?.info(`Command completed: ${translatedCommand}`, {
          originalCommand,
          translatedCommand,
          executionTime,
          stdoutLength: stdout.length,
          stderrLength: stderr.length,
          commandId
        });

        resolve({
          success: true,
          action: 'run-command',
          command: originalCommand,
          commandId,
          translatedCommand: translatedCommand !== originalCommand ? translatedCommand : undefined,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          exitCode: 0,
          executionTime,
          workingDirectory: workingDir,
          message: `Command executed successfully in ${executionTime}ms`
        });
      });

      // Store PID
      commandInfo.pid = childProcess.pid;
      commandInfo.process = childProcess;

      // Handle timeout - only if command is still running
      setTimeout(() => {
        if (commandInfo.state === TERMINAL_CONFIG.STATES.RUNNING && !childProcess.killed) {
          childProcess.kill('SIGTERM');
          commandInfo.state = TERMINAL_CONFIG.STATES.FAILED;
          commandInfo.error = `Command timed out after ${timeout}ms`;
          commandInfo.endTime = new Date().toISOString();
          reject(new Error(`Command timed out after ${timeout}ms: ${translatedCommand} (original: ${originalCommand})`));
        }
      }, timeout);
    });
  }

  /**
   * Execute a command using spawn() for streaming output
   * @param {string} command - Command to execute
   * @param {string} workingDir - Working directory
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Execution result
   * @private
   */
  async executeCommandWithSpawn(command, workingDir, options = {}) {
    const { timeout = this.timeout, agentId, context } = options;

    // Translate command for current terminal
    const originalCommand = command;
    let translatedCommand;

    try {
      translatedCommand = await this.translateCommand(command, {
        agentId,
        toolsRegistry: context?.toolsRegistry,
        messageProcessor: context?.messageProcessor,
        aiService: context?.aiService,
        apiKey: context?.apiKey,
        customApiKeys: context?.customApiKeys,
      });
    } catch (error) {
      this.logger?.warn('Command translation failed, using original command', {
        originalCommand,
        error: error.message
      });
      translatedCommand = command;
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      this.logger?.info(`Executing command with spawn: ${translatedCommand}`, {
        originalCommand,
        translatedCommand,
        terminal: this.detectedTerminal,
        workingDirectory: workingDir,
        timeout,
        agentId
      });

      // Parse command into program and args
      // For shell commands, we need to run them through a shell
      let childProcess;

      if (this.detectedTerminal === 'cmd' || this.detectedTerminal === 'powershell') {
        // Windows: Use cmd /c or powershell -Command
        const shell = this.detectedTerminal === 'powershell' ? 'powershell' : 'cmd';
        const shellArgs = this.detectedTerminal === 'powershell'
          ? ['-Command', translatedCommand]
          : ['/c', translatedCommand];

        childProcess = spawn(shell, shellArgs, {
          cwd: workingDir,
          env: { ...process.env },
          windowsHide: true
        });
      } else {
        // Unix/macOS: Use user's shell (respects zsh on macOS, bash on Linux, etc.)
        const userShell = process.env.SHELL || '/bin/sh';
        childProcess = spawn(userShell, ['-c', translatedCommand], {
          cwd: workingDir,
          env: { ...process.env }
        });
      }

      // Buffers for stdout and stderr
      let stdoutData = '';
      let stderrData = '';
      let isTimedOut = false;
      let exitCode = null;

      // Phase 2: Prompt detection tracking
      let lastOutputTime = Date.now();
      let promptDetectionResult = null;

      // Set up timeout
      const timeoutId = setTimeout(() => {
        if (!childProcess.killed && exitCode === null) {
          isTimedOut = true;
          this.logger?.warn(`Command timed out, killing process: ${translatedCommand}`, {
            timeout,
            agentId
          });
          childProcess.kill('SIGTERM');

          // If SIGTERM doesn't work, try SIGKILL after 5s
          setTimeout(() => {
            if (!childProcess.killed) {
              childProcess.kill('SIGKILL');
            }
          }, 5000);
        }
      }, timeout);

      // Stream stdout
      childProcess.stdout.on('data', (chunk) => {
        const data = chunk.toString();
        stdoutData += data;
        lastOutputTime = Date.now(); // Update last output time

        this.logger?.debug(`Command output chunk: ${data.substring(0, 100)}`, {
          agentId,
          command: originalCommand.substring(0, 50)
        });

        // Phase 2: Check for prompts in stdout
        if (!promptDetectionResult) {
          const detection = this.promptDetector.detectPrompt(stdoutData, 'stdout');
          if (detection) {
            promptDetectionResult = detection;
            this.logger?.info('Prompt detected in stdout', {
              type: detection.type,
              description: detection.description,
              matchedText: detection.matchedText,
              agentId,
              command: originalCommand.substring(0, 50)
            });
          }
        }
      });

      // Stream stderr
      childProcess.stderr.on('data', (chunk) => {
        const data = chunk.toString();
        stderrData += data;
        lastOutputTime = Date.now(); // Update last output time

        this.logger?.debug(`Command error chunk: ${data.substring(0, 100)}`, {
          agentId,
          command: originalCommand.substring(0, 50)
        });

        // Phase 2: Check for prompts in stderr
        if (!promptDetectionResult) {
          const detection = this.promptDetector.detectPrompt(stderrData, 'stderr');
          if (detection) {
            promptDetectionResult = detection;
            this.logger?.info('Prompt detected in stderr', {
              type: detection.type,
              description: detection.description,
              matchedText: detection.matchedText,
              agentId,
              command: originalCommand.substring(0, 50)
            });
          }
        }
      });

      // Handle process exit
      childProcess.on('exit', (code, signal) => {
        clearTimeout(timeoutId);
        exitCode = code;
        const executionTime = Date.now() - startTime;

        // Phase 2: Calculate time since last output
        const timeSinceLastOutput = Date.now() - lastOutputTime;

        this.logger?.info(`Command process exited: ${translatedCommand}`, {
          exitCode: code,
          signal,
          executionTime,
          timedOut: isTimedOut,
          stdoutLength: stdoutData.length,
          stderrLength: stderrData.length,
          promptDetected: !!promptDetectionResult,
          timeSinceLastOutput
        });

        // Build common result object with Phase 2 additions
        const baseResult = {
          action: 'run-command',
          command: originalCommand,
          translatedCommand: translatedCommand !== originalCommand ? translatedCommand : undefined,
          stdout: stdoutData.trim(),
          stderr: stderrData.trim(),
          exitCode: code,
          executionTime,
          workingDirectory: workingDir,
          // Phase 2: Prompt detection fields
          promptDetected: !!promptDetectionResult,
          promptInfo: promptDetectionResult || undefined,
          lastOutputTime: lastOutputTime,
          timeSinceLastOutput: timeSinceLastOutput
        };

        // If timed out, reject
        if (isTimedOut) {
          resolve({
            ...baseResult,
            success: false,
            error: `Command timed out after ${timeout}ms`,
            exitCode: code || -1,
            timedOut: true
          });
          return;
        }

        // If exit code is not 0, consider it a failure
        if (code !== 0) {
          this.logger?.error(`Command failed with exit code ${code}: ${translatedCommand}`, {
            originalCommand,
            translatedCommand,
            exitCode: code,
            stderr: stderrData.substring(0, 200),
            executionTime,
            promptDetected: !!promptDetectionResult
          });

          resolve({
            ...baseResult,
            success: false,
            error: `Command exited with code ${code}`
          });
          return;
        }

        // Success
        this.logger?.info(`Command completed successfully: ${translatedCommand}`, {
          originalCommand,
          executionTime,
          stdoutLength: stdoutData.length,
          stderrLength: stderrData.length,
          promptDetected: !!promptDetectionResult
        });

        resolve({
          ...baseResult,
          success: true,
          exitCode: 0,
          message: `Command executed successfully in ${executionTime}ms`
        });
      });

      // Handle spawn errors
      childProcess.on('error', (error) => {
        clearTimeout(timeoutId);
        const executionTime = Date.now() - startTime;
        const timeSinceLastOutput = Date.now() - lastOutputTime;

        this.logger?.error(`Command spawn error: ${translatedCommand}`, {
          originalCommand,
          error: error.message,
          executionTime,
          promptDetected: !!promptDetectionResult
        });

        resolve({
          success: false,
          action: 'run-command',
          command: originalCommand,
          translatedCommand: translatedCommand !== originalCommand ? translatedCommand : undefined,
          error: error.message,
          stderr: stderrData.trim(),
          stdout: stdoutData.trim(),
          exitCode: -1,
          executionTime,
          workingDirectory: workingDir,
          // Phase 2: Prompt detection fields
          promptDetected: !!promptDetectionResult,
          promptInfo: promptDetectionResult || undefined,
          lastOutputTime: lastOutputTime,
          timeSinceLastOutput: timeSinceLastOutput
        });
      });
    });
  }

  /**
   * Change current working directory
   * @private
   */
  async changeDirectory(targetDir, currentDir, accessConfig) {
    try {
      let newDirectory;

      if (path.isAbsolute(targetDir)) {
        newDirectory = targetDir;
      } else {
        newDirectory = path.resolve(currentDir, targetDir);
      }

      // Guard against doubled directory nesting. Reasoning models frequently
      // forget that `change-directory` persists the CWD for the session, so
      // after cd-ing into `foo` they issue another `change-directory foo`,
      // which resolves to `.../foo/foo` and either (a) fails here, or (b)
      // succeeds because some earlier typo created that nested directory,
      // silently entrenching the confusion. Detect the duplicate-segment
      // pattern and refuse with a clear, actionable error that tells the
      // agent it's already inside the target and should drop this action.
      const segs = newDirectory.split(/[\\/]/).filter(Boolean);
      for (let i = 1; i < segs.length; i++) {
        if (segs[i].toLowerCase() === segs[i - 1].toLowerCase()) {
          throw new Error(
            `Refused to enter duplicated path segment "${segs[i]}". ` +
            `Resolved path would be ${newDirectory}. ` +
            `You are already inside "${segs[i]}" (current directory: ${currentDir}). ` +
            `Do NOT prepend the project folder name again — relative paths are resolved from the current directory. ` +
            `Use \`get-working-directory\` if you need to confirm where you are.`
          );
        }
      }

      // Verify directory exists
      const stats = await fs.stat(newDirectory);
      if (!stats.isDirectory()) {
        throw new Error(`Not a directory: ${newDirectory}`);
      }
      
      // Security check: validate directory access using DirectoryAccessManager
      const accessResult = this.directoryAccessManager.validateReadAccess(newDirectory, accessConfig);
      if (!accessResult.allowed) {
        this.logger?.warn(`Directory change blocked: ${accessResult.reason}`, {
          targetDirectory: newDirectory,
          reason: accessResult.reason,
          category: accessResult.category
        });
        throw new Error(`Access denied: ${accessResult.reason}`);
      }
      
      return {
        success: true,
        action: 'change-directory',
        previousDirectory: currentDir,
        newDirectory,
        message: `Changed directory to ${newDirectory}`
      };
      
    } catch (error) {
      throw new Error(`Failed to change directory to ${targetDir}: ${error.message}`);
    }
  }

  /**
   * List directory contents
   * @private
   */
  async listDirectory(dirPath) {
    try {
      const files = await fs.readdir(dirPath, { withFileTypes: true });
      
      const contents = files.map(file => ({
        name: file.name,
        type: file.isDirectory() ? 'directory' : 'file',
        isSymlink: file.isSymbolicLink()
      }));
      
      return {
        success: true,
        action: 'list-directory',
        directory: dirPath,
        contents,
        totalItems: contents.length,
        directories: contents.filter(item => item.type === 'directory').length,
        files: contents.filter(item => item.type === 'file').length,
        message: `Listed ${contents.length} items in ${dirPath}`
      };
      
    } catch (error) {
      throw new Error(`Failed to list directory ${dirPath}: ${error.message}`);
    }
  }

  /**
   * Create directory
   * @private
   */
  async createDirectory(dirPath, currentDir) {
    try {
      let fullPath;
      
      if (path.isAbsolute(dirPath)) {
        fullPath = dirPath;
      } else {
        fullPath = path.resolve(currentDir, dirPath);
      }
      
      await fs.mkdir(fullPath, { recursive: true });
      
      return {
        success: true,
        action: 'create-directory',
        directory: fullPath,
        relativePath: path.relative(currentDir, fullPath),
        message: `Created directory: ${fullPath}`
      };
      
    } catch (error) {
      throw new Error(`Failed to create directory ${dirPath}: ${error.message}`);
    }
  }

  /**
   * Test if a command matches ANY pattern in a list. Patterns match if:
   *   - exact equality (case-insensitive), OR
   *   - command starts with `${pattern} ` (the base command matches).
   *
   * Shared helper used by the per-agent config check in execute(). The
   * class-level isBlockedCommand/isAllowedCommand still exist for the
   * pre-execute validator pass.
   * @private
   */
  _matchesAny(command, patterns, _opts = {}) {
    if (!Array.isArray(patterns) || patterns.length === 0) return false;
    const cmd = (command || '').toLowerCase().trim();
    const base = cmd.split(' ')[0];
    return patterns.some((p) => {
      const pat = (p || '').toLowerCase();
      return pat === cmd || pat === base || cmd.startsWith(pat + ' ');
    });
  }

  /**
   * Check if command is blocked for security
   * @private
   */
  isBlockedCommand(command) {
    const cmdLower = command.toLowerCase().trim();
    
    return this.blockedCommands.some(blocked => {
      const blockedLower = blocked.toLowerCase();
      return cmdLower === blockedLower || cmdLower.startsWith(blockedLower + ' ');
    });
  }

  /**
   * Check if command is in allowed list
   * @private
   */
  isAllowedCommand(command) {
    if (!this.allowedCommands) return true;
    
    const cmdLower = command.toLowerCase().trim();
    const cmdBase = cmdLower.split(' ')[0];
    
    return this.allowedCommands.some(allowed => 
      allowed.toLowerCase() === cmdBase || 
      cmdLower.startsWith(allowed.toLowerCase() + ' ')
    );
  }

  /**
   * Add command to history
   * @private
   */
  addToHistory(action, result, agentId) {
    const historyEntry = {
      timestamp: new Date().toISOString(),
      agentId,
      action: action.type,
      command: action.command || action.directory,
      success: result.success,
      executionTime: result.executionTime || 0,
      workingDirectory: result.workingDirectory
    };
    
    this.commandHistory.push(historyEntry);
    
    // Keep only last 100 entries
    if (this.commandHistory.length > 100) {
      this.commandHistory = this.commandHistory.slice(-100);
    }
  }

  /**
   * Get supported actions for this tool
   * @returns {Array<string>} Array of supported action names
   */
  getSupportedActions() {
    return ['run-command', 'change-directory', 'list-directory', 'create-directory', 'get-working-directory'];
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
              command: { type: 'string' },
              directory: { type: 'string' }
            },
            required: ['type']
          }
        },
        timeout: {
          type: 'integer',
          minimum: 1000,
          maximum: this.timeout
        },
        async: {
          type: 'boolean'
        }
      },
      required: ['actions']
    };
  }

  /**
   * Get command history for debugging
   * @returns {Array} Command history
   */
  getCommandHistory(agentId = null) {
    if (agentId) {
      return this.commandHistory.filter(entry => entry.agentId === agentId);
    }
    return [...this.commandHistory];
  }

  /**
   * Clear working directory context for agent
   * @param {string} agentId - Agent identifier
   */
  clearWorkingDirectory(agentId) {
    for (const [key] of this.workingDirectories) {
      if (key.startsWith(`${agentId}-`)) {
        this.workingDirectories.delete(key);
      }
    }
  }

  /**
   * Get current working directory for agent
   * @param {string} agentId - Agent identifier
   * @param {string} projectDir - Project directory
   * @returns {string} Current working directory
   */
  getCurrentWorkingDirectory(agentId, projectDir = null) {
    const contextKey = `${agentId}-${projectDir || 'default'}`;
    return this.workingDirectories.get(contextKey) || projectDir || process.cwd();
  }

  /**
   * Initialize terminal detection
   * @private
   */
  initializeTerminalDetection() {
    // Detect platform
    this.platformType = process.platform;
    
    // Detect terminal type based on environment
    if (process.platform === 'win32') {
      // Windows detection
      if (process.env.PSModulePath) {
        this.detectedTerminal = 'powershell';
      } else if (process.env.SHELL && process.env.SHELL.includes('bash')) {
        this.detectedTerminal = 'bash'; // Git Bash or WSL
      } else {
        this.detectedTerminal = 'cmd'; // Windows Command Prompt
      }
    } else if (process.platform === 'darwin') {
      // macOS: Detect actual shell (zsh is default since Catalina 10.15)
      const shell = process.env.SHELL || '/bin/zsh';
      if (shell.includes('zsh')) {
        this.detectedTerminal = 'zsh';
      } else if (shell.includes('fish')) {
        this.detectedTerminal = 'fish';
      } else {
        this.detectedTerminal = 'bash';
      }
    } else {
      // Linux/Unix: Detect actual shell from $SHELL
      const shell = process.env.SHELL || '/bin/bash';
      if (shell.includes('zsh')) {
        this.detectedTerminal = 'zsh';
      } else if (shell.includes('fish')) {
        this.detectedTerminal = 'fish';
      } else {
        this.detectedTerminal = 'bash';
      }
    }
    
    this.logger?.info('Terminal detected', {
      platform: this.platformType,
      terminal: this.detectedTerminal,
      shell: process.env.SHELL
    });
  }

  /**
   * Translate command for current terminal using AI if needed
   * @param {string} command - Original command
   * @param {Object} context - Execution context with aiService access
   * @returns {Promise<string>} Translated command
   * @private
   */
  async translateCommand(command, context = {}) {
    const trimmedCommand = command.trim();
    
    // Perform comprehensive command analysis
    const analysis = this.analyzeCommandCompatibility(trimmedCommand);
    
    this.logger?.info('Command compatibility analysis', {
      command: trimmedCommand,
      detectedTerminal: analysis.detectedTerminal,
      commandType: analysis.commandType,
      commandCategory: analysis.commandCategory,
      compatible: analysis.compatible,
      issues: analysis.specificIssues,
      suggestedAction: analysis.suggestedAction,
      confidence: analysis.confidence
    });
    
    if (analysis.compatible) {
      return command;
    }
    
    // Try simple translations first (fast path)
    let simpleTranslation = null;
    if (this.detectedTerminal === 'cmd') {
      simpleTranslation = this.translateToWindowsCmd(trimmedCommand);
    } else if (this.detectedTerminal === 'powershell') {
      simpleTranslation = this.translateToPowerShell(trimmedCommand);
    } else if (this.detectedTerminal === 'bash') {
      simpleTranslation = this.translateToBash(trimmedCommand);
    }
    
    // If simple translation looks sufficient and command is simple, use it
    if (simpleTranslation && this.isSimpleCommand(trimmedCommand)) {
      this.logger?.info('Using simple translation', {
        original: command,
        translated: simpleTranslation,
        method: 'simple'
      });
      return simpleTranslation;
    }
    
    // For complex commands, use AI translation
    if (context.aiService || (context.toolsRegistry && context.agentId)) {
      this.logger?.info('Attempting AI translation for complex command', {
        command: command.substring(0, 100) + '...',
        hasAiService: !!context.aiService,
        hasToolsRegistry: !!context.toolsRegistry,
        agentId: context.agentId
      });
      
      try {
        const aiTranslation = await this.translateCommandWithAI(command, context);
        if (aiTranslation && aiTranslation.trim() !== command.trim()) {
          this.logger?.info('Using AI translation', {
            original: command,
            translated: aiTranslation,
            method: 'ai'
          });
          return aiTranslation;
        } else {
          this.logger?.warn('AI translation returned same command', {
            original: command,
            translated: aiTranslation
          });
        }
      } catch (error) {
        this.logger?.warn('AI translation failed, falling back to simple translation', {
          original: command,
          error: error.message,
          stack: error.stack
        });
      }
    } else {
      this.logger?.warn('AI translation not available - missing context', {
        hasAiService: !!context.aiService,
        hasToolsRegistry: !!context.toolsRegistry,
        hasAgentId: !!context.agentId,
        contextKeys: Object.keys(context)
      });
    }
    
    // Fallback to simple translation or original command
    return simpleTranslation || command;
  }

  /**
   * Check if command is simple enough for regex translation
   * @param {string} command - Command to check
   * @returns {boolean} Whether command is simple
   * @private
   */
  isSimpleCommand(command) {
    // Check for complex command patterns using simple string methods
    const cmd = command.toLowerCase();
    
    // Multi-line or escape sequences
    if (command.includes('\\n') || command.includes('\\r') || command.includes('\\t')) return false;
    if (command.includes('\n') || command.includes('\r')) return false;
    
    // Code content
    if (command.includes('#include') || command.includes('printf') || command.includes('main()')) return false;
    if (command.includes('def ') || command.includes('function ') || command.includes('class ')) return false;
    
    // Single quotes (problematic on Windows CMD)
    if (command.includes("echo '") && !command.includes('echo "')) return false;
    
    // Long complex strings (likely contain complex content)
    const singleQuoteMatch = command.match(/'([^']*)'/);
    if (singleQuoteMatch && singleQuoteMatch[1].length > 50) return false;
    
    // Unix-style paths in redirections on Windows
    if (this.detectedTerminal === 'cmd' && command.includes('>') && command.includes('/') && !command.includes('\\')) {
      return false;
    }
    
    // Multiple commands
    if (command.includes(' && ') || command.includes(' || ') || command.includes('; ')) return false;
    
    // Command substitution or complex shell features
    if (command.includes('$(') || command.includes('`') || command.includes('{') || command.includes('[')) return false;
    
    // Loops and conditionals
    if (cmd.includes('for ') || cmd.includes('while ') || cmd.includes('if ')) return false;
    if (cmd.includes('export ') || cmd.includes('source ')) return false;
    
    // Pipes and redirections
    if (command.includes(' | ') || command.includes(' > &')) return false;
    
    return true; // Command is simple
  }

  /**
   * Translate command using AI service
   * @param {string} command - Original command
   * @param {Object} context - Execution context
   * @returns {Promise<string>} AI-translated command
   * @private
   */
  async translateCommandWithAI(command, context) {
    // Get AI service - either directly provided or through tools registry
    let aiService = context.aiService;
    if (!aiService && context.toolsRegistry && context.agentId) {
      // Try to get AI service through the system (this would need to be passed through context)
      const messageProcessor = context.messageProcessor; // Would need to be passed in context
      if (messageProcessor && messageProcessor.aiService) {
        aiService = messageProcessor.aiService;
      }
    }
    
    if (!aiService) {
      throw new Error('AI service not available for command translation');
    }
    
    const translationPrompt = this.buildTranslationPrompt(command);
    
    // Use a lightweight model for translation
    const model = 'gpt-4-mini'; // Fast and cost-effective for simple translations
    
    try {
      const response = await aiService.sendMessage(model, translationPrompt, {
        agentId: context.agentId,
        temperature: 0.1, // Low temperature for consistent translations
        maxTokens: 200, // Short response expected
        apiKey: context.apiKey,
        customApiKeys: context.customApiKeys,
      });
      
      // Extract the translated command from the response
      const translatedCommand = this.extractTranslatedCommand(response.content);
      
      this.logger?.debug('AI command translation completed', {
        original: command,
        translated: translatedCommand,
        model: model,
        terminal: this.detectedTerminal
      });
      
      return translatedCommand;
      
    } catch (error) {
      this.logger?.error('AI command translation failed', {
        command,
        terminal: this.detectedTerminal,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Build translation prompt for AI service
   * @param {string} command - Command to translate
   * @returns {string} Translation prompt
   * @private
   */
  buildTranslationPrompt(command) {
    const terminalInfo = {
      'cmd': 'Windows Command Prompt (cmd.exe)',
      'powershell': 'Windows PowerShell',
      'bash': 'Bash shell (Linux/Unix)',
      'zsh': 'Z shell (macOS default since Catalina)',
      'fish': 'Fish shell (friendly interactive shell)'
    };
    
    const currentTerminal = terminalInfo[this.detectedTerminal] || this.detectedTerminal;
    
    // Get detailed analysis for better translation context
    const analysis = this.analyzeCommandCompatibility(command);
    
    let prompt = `Translate this command to work correctly in ${currentTerminal}:

ORIGINAL COMMAND:
\`\`\`
${command}
\`\`\`

COMMAND ANALYSIS:
- Command Type: ${analysis.commandType}
- Category: ${analysis.commandCategory}
- Target Terminal: ${currentTerminal}
- Compatibility Issues: ${analysis.specificIssues.join(', ') || 'None detected'}`;

    // Add alternative suggestions if available
    if (analysis.commandType === 'unix' && analysis.alternatives && analysis.alternatives[this.detectedTerminal]) {
      prompt += `\n- Suggested Alternative: ${analysis.alternatives[this.detectedTerminal]}`;
    }

    prompt += `

REQUIREMENTS:
1. Make the command work correctly in ${currentTerminal}
2. Preserve the original intent and functionality
3. Handle file paths, quoting, and syntax correctly
4. If creating files, ensure proper encoding and line endings
5. Address the specific compatibility issues identified above
6. Return ONLY the translated command, nothing else

TRANSLATED COMMAND:`;

    return prompt;
  }

  /**
   * Extract translated command from AI response
   * @param {string} response - AI response content
   * @returns {string} Extracted command
   * @private
   */
  extractTranslatedCommand(response) {
    // Remove markdown code blocks if present
    let extracted = response.replace(/```[a-z]*\n?(.*?)\n?```/s, '$1');
    
    // Remove common prefixes
    extracted = extracted.replace(/^(TRANSLATED COMMAND:|Command:|Result:)\s*/i, '');
    
    // Take first line if multiple lines (unless it's intentionally multiline)
    const lines = extracted.trim().split('\n');
    if (lines.length > 1 && !extracted.includes('&&') && !extracted.includes('||')) {
      extracted = lines[0].trim();
    }
    
    return extracted.trim();
  }

  /**
   * Analyze command compatibility with current terminal
   * @param {string} command - Command to check
   * @returns {Object} Compatibility analysis result
   * @private
   */
  analyzeCommandCompatibility(command) {
    const analysis = this.classifyCommand(command);
    const isCompatible = this.isCommandCompatibleWithTerminal(analysis, this.detectedTerminal);
    
    return {
      compatible: isCompatible,
      detectedTerminal: this.detectedTerminal,
      commandType: analysis.type,
      commandCategory: analysis.category,
      specificIssues: analysis.issues,
      suggestedAction: isCompatible ? 'execute' : 'translate',
      confidence: analysis.confidence
    };
  }

  /**
   * Legacy wrapper for backward compatibility
   * @param {string} command - Command to check
   * @returns {boolean} Whether command is compatible
   * @private
   */
  isCommandCompatible(command) {
    return this.analyzeCommandCompatibility(command).compatible;
  }

  /**
   * Classify command type and detect potential issues
   * @param {string} command - Command to analyze
   * @returns {Object} Command classification
   * @private
   */
  classifyCommand(command) {
    const cmd = command.toLowerCase().trim();
    const firstWord = cmd.split(' ')[0];
    const issues = [];
    let confidence = 0.9;

    // Unix/Linux commands
    const unixCommands = {
      // File operations
      'ls': { category: 'file-listing', alternatives: { cmd: 'dir', powershell: 'Get-ChildItem' }},
      'cat': { category: 'file-viewing', alternatives: { cmd: 'type', powershell: 'Get-Content' }},
      'grep': { category: 'text-search', alternatives: { cmd: 'findstr', powershell: 'Select-String' }},
      'find': { category: 'file-search', alternatives: { cmd: 'dir /s', powershell: 'Get-ChildItem -Recurse' }},
      'head': { category: 'file-viewing', alternatives: { cmd: 'more', powershell: 'Get-Content -Head' }},
      'tail': { category: 'file-viewing', alternatives: { cmd: 'more +n', powershell: 'Get-Content -Tail' }},
      'wc': { category: 'text-analysis', alternatives: { cmd: 'find /c', powershell: 'Measure-Object' }},
      
      // File manipulation
      'cp': { category: 'file-copy', alternatives: { cmd: 'copy', powershell: 'Copy-Item' }},
      'mv': { category: 'file-move', alternatives: { cmd: 'move', powershell: 'Move-Item' }},
      'rm': { category: 'file-delete', alternatives: { cmd: 'del', powershell: 'Remove-Item' }},
      'mkdir': { category: 'directory-create', alternatives: { cmd: 'mkdir', powershell: 'New-Item -Type Directory' }},
      'rmdir': { category: 'directory-delete', alternatives: { cmd: 'rmdir', powershell: 'Remove-Item' }},
      'touch': { category: 'file-create', alternatives: { cmd: 'type nul >', powershell: 'New-Item -Type File' }},
      
      // Permissions and ownership
      'chmod': { category: 'permissions', alternatives: { cmd: 'icacls', powershell: 'Set-Acl' }},
      'chown': { category: 'ownership', alternatives: { cmd: 'takeown', powershell: 'Set-Acl' }},
      
      // Process management
      'ps': { category: 'process-list', alternatives: { cmd: 'tasklist', powershell: 'Get-Process' }},
      'kill': { category: 'process-kill', alternatives: { cmd: 'taskkill', powershell: 'Stop-Process' }},
      'killall': { category: 'process-kill', alternatives: { cmd: 'taskkill /f /im', powershell: 'Get-Process | Stop-Process' }},
      'top': { category: 'process-monitor', alternatives: { cmd: 'tasklist', powershell: 'Get-Process | Sort-Object CPU' }},
      
      // Network
      'wget': { category: 'download', alternatives: { cmd: 'curl', powershell: 'Invoke-WebRequest' }},
      'curl': { category: 'http-client', alternatives: { cmd: 'curl', powershell: 'Invoke-RestMethod' }},
      'ping': { category: 'network-test', alternatives: { cmd: 'ping', powershell: 'Test-NetConnection' }},
      
      // Text processing
      'awk': { category: 'text-processing', alternatives: { cmd: 'for /f', powershell: 'ForEach-Object' }},
      'sed': { category: 'text-edit', alternatives: { cmd: 'powershell -c', powershell: 'native' }},
      'sort': { category: 'text-sort', alternatives: { cmd: 'sort', powershell: 'Sort-Object' }},
      'uniq': { category: 'text-dedupe', alternatives: { cmd: 'sort /unique', powershell: 'Sort-Object -Unique' }},
      
      // Environment
      'pwd': { category: 'directory-current', alternatives: { cmd: 'cd', powershell: 'Get-Location' }},
      'whoami': { category: 'user-info', alternatives: { cmd: 'echo %USERNAME%', powershell: 'whoami' }},
      'env': { category: 'environment', alternatives: { cmd: 'set', powershell: 'Get-ChildItem Env:' }},
      'export': { category: 'environment', alternatives: { cmd: 'set', powershell: '$env:' }},
      'source': { category: 'script-execute', alternatives: { cmd: 'call', powershell: '. ' }},
      
      // Archives
      'tar': { category: 'archive', alternatives: { cmd: '7z', powershell: 'Compress-Archive' }},
      'zip': { category: 'archive', alternatives: { cmd: 'powershell Compress-Archive', powershell: 'Compress-Archive' }},
      'unzip': { category: 'archive', alternatives: { cmd: 'powershell Expand-Archive', powershell: 'Expand-Archive' }},
      
      // System info
      'df': { category: 'disk-info', alternatives: { cmd: 'fsutil volume diskfree', powershell: 'Get-WmiObject -Class Win32_LogicalDisk' }},
      'du': { category: 'disk-usage', alternatives: { cmd: 'dir /s', powershell: 'Get-ChildItem -Recurse | Measure-Object' }},
      'free': { category: 'memory-info', alternatives: { cmd: 'systeminfo', powershell: 'Get-WmiObject -Class Win32_PhysicalMemory' }},
      'uname': { category: 'system-info', alternatives: { cmd: 'systeminfo', powershell: 'Get-ComputerInfo' }}
    };

    // Windows CMD commands
    const cmdCommands = {
      'dir': { category: 'file-listing', alternatives: { unix: 'ls', powershell: 'Get-ChildItem' }},
      'type': { category: 'file-viewing', alternatives: { unix: 'cat', powershell: 'Get-Content' }},
      'copy': { category: 'file-copy', alternatives: { unix: 'cp', powershell: 'Copy-Item' }},
      'move': { category: 'file-move', alternatives: { unix: 'mv', powershell: 'Move-Item' }},
      'del': { category: 'file-delete', alternatives: { unix: 'rm', powershell: 'Remove-Item' }},
      'tasklist': { category: 'process-list', alternatives: { unix: 'ps', powershell: 'Get-Process' }},
      'taskkill': { category: 'process-kill', alternatives: { unix: 'kill', powershell: 'Stop-Process' }},
      'findstr': { category: 'text-search', alternatives: { unix: 'grep', powershell: 'Select-String' }}
    };

    // PowerShell commands
    const powershellCommands = {
      'get-childitem': { category: 'file-listing', alternatives: { unix: 'ls', cmd: 'dir' }},
      'get-content': { category: 'file-viewing', alternatives: { unix: 'cat', cmd: 'type' }},
      'copy-item': { category: 'file-copy', alternatives: { unix: 'cp', cmd: 'copy' }},
      'move-item': { category: 'file-move', alternatives: { unix: 'mv', cmd: 'move' }},
      'remove-item': { category: 'file-delete', alternatives: { unix: 'rm', cmd: 'del' }},
      'get-process': { category: 'process-list', alternatives: { unix: 'ps', cmd: 'tasklist' }},
      'stop-process': { category: 'process-kill', alternatives: { unix: 'kill', cmd: 'taskkill' }}
    };

    // Determine command type
    let commandType = 'unknown';
    let category = 'unknown';
    let alternatives = {};

    if (unixCommands[firstWord]) {
      commandType = 'unix';
      category = unixCommands[firstWord].category;
      alternatives = unixCommands[firstWord].alternatives;
    } else if (cmdCommands[firstWord]) {
      commandType = 'windows-cmd';
      category = cmdCommands[firstWord].category;
      alternatives = cmdCommands[firstWord].alternatives;
    } else if (powershellCommands[firstWord]) {
      commandType = 'powershell';
      category = powershellCommands[firstWord].category;
      alternatives = powershellCommands[firstWord].alternatives;
    } else {
      // Check for built-in commands that work everywhere
      const universalCommands = ['echo', 'cd', 'exit', 'help'];
      if (universalCommands.includes(firstWord)) {
        commandType = 'universal';
        category = 'builtin';
      } else {
        commandType = 'unknown';
        confidence = 0.3;
      }
    }

    // Check for syntax issues
    if (command.includes("'") && !command.includes('"')) {
      issues.push('single-quotes-problematic');
    }
    if (command.includes('/') && !command.includes('\\') && !command.includes('http') && command.includes('>')) {
      issues.push('unix-style-paths');
    }
    if (command.includes('\\n') || command.includes('\\t')) {
      issues.push('escape-sequences');
    }
    if (command.includes(' && ') || command.includes(' || ') || command.includes(';')) {
      issues.push('command-chaining');
    }

    return {
      type: commandType,
      category: category,
      alternatives: alternatives,
      issues: issues,
      confidence: confidence,
      firstWord: firstWord,
      fullCommand: command
    };
  }

  /**
   * Check if classified command is compatible with terminal
   * @param {Object} analysis - Command analysis
   * @param {string} terminal - Target terminal type
   * @returns {boolean} Whether compatible
   * @private
   */
  isCommandCompatibleWithTerminal(analysis, terminal) {
    switch (terminal) {
      case 'cmd':
        if (analysis.type === 'unix') return false;
        if (analysis.issues.includes('single-quotes-problematic')) return false;
        if (analysis.issues.includes('unix-style-paths')) return false;
        return analysis.type === 'windows-cmd' || analysis.type === 'universal';

      case 'powershell':
        if (analysis.type === 'unix' && !analysis.alternatives.powershell) return false;
        return true; // PowerShell is quite compatible

      case 'zsh':
      case 'fish':
      case 'bash':
        // All Unix-like shells handle Unix commands similarly
        if (analysis.type === 'windows-cmd') return false;
        return analysis.type === 'unix' || analysis.type === 'universal';

      default:
        return false;
    }
  }

  /**
   * Translate command to Windows CMD syntax
   * @param {string} command - Original command
   * @returns {string} Windows CMD equivalent
   * @private
   */
  translateToWindowsCmd(command) {
    let translated = command;
    
    // Common Unix to Windows translations
    const translations = new Map([
      // Directory listing
      [/^ls\s*$/, 'dir'],
      [/^ls\s+-la?$/, 'dir'],
      [/^ls\s+-l$/, 'dir'],
      [/^ls\s+-a$/, 'dir /a'],
      
      // File operations
      [/^cat\s+(.+)$/, 'type $1'],
      [/^cp\s+(.+)\s+(.+)$/, 'copy $1 $2'],
      [/^mv\s+(.+)\s+(.+)$/, 'move $1 $2'],
      [/^rm\s+(.+)$/, 'del $1'],
      [/^mkdir\s+(.+)$/, 'mkdir $1'],
      [/^rmdir\s+(.+)$/, 'rmdir $1'],
      
      // Process management
      [/^ps\s*$/, 'tasklist'],
      [/^kill\s+(.+)$/, 'taskkill /PID $1'],
      
      // Environment
      [/^pwd\s*$/, 'cd'],
      [/^whoami\s*$/, 'echo %USERNAME%'],
      
      // Network
      [/^ping\s+(.+)$/, 'ping $1'],
      [/^wget\s+(.+)$/, 'curl -O $1'],
      [/^curl\s+(.+)$/, 'curl $1']
    ]);
    
    // Apply translations
    for (const [regex, replacement] of translations) {
      if (regex.test(translated)) {
        translated = translated.replace(regex, replacement);
        break;
      }
    }
    
    // Fix echo command with single quotes
    translated = translated.replace(/echo\s+'([^']+)'\s*>/g, 'echo "$1" >');
    translated = translated.replace(/echo\s+'([^']+)'$/g, 'echo "$1"');
    
    // Fix multi-line echo commands
    if (translated.includes("echo '") && translated.includes("\\n")) {
      // Convert multi-line echo to multiple echo commands or use different approach
      const match = translated.match(/echo\s+'(.+?)'\s*>\s*(.+)$/);
      if (match) {
        const content = match[1].replace(/\\n/g, '\n');
        const filename = match[2];
        const lines = content.split('\n');
        
        // Create a batch file approach for multi-line content
        translated = `(${lines.map(line => `echo ${line}`).join(' & ')}) > ${filename}`;
      }
    }
    
    this.logger?.info('Command translated for Windows CMD', {
      original: command,
      translated: translated
    });
    
    return translated;
  }

  /**
   * Translate command to PowerShell syntax
   * @param {string} command - Original command
   * @returns {string} PowerShell equivalent
   * @private
   */
  translateToPowerShell(command) {
    let translated = command;
    
    const translations = new Map([
      [/^ls\s*$/, 'Get-ChildItem'],
      [/^ls\s+-la?$/, 'Get-ChildItem -Force'],
      [/^cat\s+(.+)$/, 'Get-Content $1'],
      [/^cp\s+(.+)\s+(.+)$/, 'Copy-Item $1 $2'],
      [/^mv\s+(.+)\s+(.+)$/, 'Move-Item $1 $2'],
      [/^rm\s+(.+)$/, 'Remove-Item $1'],
      [/^pwd\s*$/, 'Get-Location'],
      [/^ps\s*$/, 'Get-Process']
    ]);
    
    for (const [regex, replacement] of translations) {
      if (regex.test(translated)) {
        translated = translated.replace(regex, replacement);
        break;
      }
    }
    
    this.logger?.info('Command translated for PowerShell', {
      original: command,
      translated: translated
    });
    
    return translated;
  }

  /**
   * Translate command to Bash syntax
   * @param {string} command - Original command
   * @returns {string} Bash equivalent
   * @private
   */
  translateToBash(command) {
    // For bash, mainly fix Windows-specific commands
    let translated = command;
    
    const translations = new Map([
      [/^dir\s*$/, 'ls'],
      [/^dir\s+\/a$/, 'ls -a'],
      [/^type\s+(.+)$/, 'cat $1'],
      [/^copy\s+(.+)\s+(.+)$/, 'cp $1 $2'],
      [/^move\s+(.+)\s+(.+)$/, 'mv $1 $2'],
      [/^del\s+(.+)$/, 'rm $1'],
      [/^tasklist\s*$/, 'ps'],
      [/^cd\s*$/, 'pwd']
    ]);
    
    for (const [regex, replacement] of translations) {
      if (regex.test(translated)) {
        translated = translated.replace(regex, replacement);
        break;
      }
    }
    
    return translated;
  }

  /**
   * Resource cleanup
   * @param {string} operationId - Operation identifier
   */
  async cleanup(operationId) {
    // Clean up any hanging processes or temporary resources
    // This would be expanded based on specific needs
  }

  /**
   * Phase 3 & 4: Start a background command
   * @param {string} command - Command to execute
   * @param {string} workingDir - Working directory
   * @param {Object} options - Execution options
   * @returns {Promise<Object>} Command info with commandId
   */
  async startBackgroundCommand(command, workingDir, options = {}) {
    const { agentId, context } = options;

    if (!agentId) {
      throw new Error('agentId is required for background commands');
    }

    // Check agent resource limits (only count active commands: running or waiting_for_input)
    const agentCommands = this.getAgentCommands(agentId);
    const activeAgentCommands = agentCommands.filter(cmd =>
      cmd.state === 'running' || cmd.state === 'waiting_for_input'
    );
    if (activeAgentCommands.length >= this.MAX_BACKGROUND_COMMANDS_PER_AGENT) {
      throw new Error(`Maximum background commands per agent exceeded (${this.MAX_BACKGROUND_COMMANDS_PER_AGENT})`);
    }

    // Check global resource limits (only count active commands)
    const allCommands = Array.from(this.commandTracker.values());
    const activeGlobalCommands = allCommands.filter(cmd =>
      cmd.state === 'running' || cmd.state === 'waiting_for_input'
    );
    if (activeGlobalCommands.length >= this.MAX_BACKGROUND_COMMANDS_GLOBAL) {
      throw new Error(`Maximum global background commands exceeded (${this.MAX_BACKGROUND_COMMANDS_GLOBAL})`);
    }

    // Generate unique command ID
    const commandId = `${agentId}-cmd-${Date.now()}-${++this.commandIdCounter}`;

    // Translate command
    const originalCommand = command;
    let translatedCommand;

    try {
      translatedCommand = await this.translateCommand(command, {
        agentId,
        toolsRegistry: context?.toolsRegistry,
        messageProcessor: context?.messageProcessor,
        aiService: context?.aiService,
        apiKey: context?.apiKey,
        customApiKeys: context?.customApiKeys,
      });
    } catch (error) {
      this.logger?.warn('Command translation failed, using original command', {
        originalCommand,
        error: error.message
      });
      translatedCommand = command;
    }

    this.logger?.info(`Starting background command: ${translatedCommand}`, {
      commandId,
      agentId,
      originalCommand,
      workingDirectory: workingDir
    });

    // Spawn process with stdin kept open
    let childProcess;

    if (this.detectedTerminal === 'cmd' || this.detectedTerminal === 'powershell') {
      const shell = this.detectedTerminal === 'powershell' ? 'powershell' : 'cmd';
      const shellArgs = this.detectedTerminal === 'powershell'
        ? ['-Command', translatedCommand]
        : ['/c', translatedCommand];

      childProcess = spawn(shell, shellArgs, {
        cwd: workingDir,
        env: { ...process.env },
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'] // Keep stdin open
      });
    } else {
      childProcess = spawn('sh', ['-c', translatedCommand], {
        cwd: workingDir,
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'] // Keep stdin open
      });
    }

    // Initialize command tracking
    const commandInfo = {
      commandId,
      agentId,
      pid: childProcess.pid,
      command: originalCommand,
      translatedCommand,
      workingDirectory: workingDir,
      startTime: new Date().toISOString(),
      state: 'running',
      exitCode: null,
      stdoutBuffer: '',
      stderrBuffer: '',
      lastOutputTime: Date.now(),
      promptDetected: null,
      process: childProcess
    };

    this.commandTracker.set(commandId, commandInfo);

    // Set up stream handlers
    childProcess.stdout.on('data', (chunk) => {
      const data = chunk.toString();
      commandInfo.stdoutBuffer += data;
      commandInfo.lastOutputTime = Date.now();

      // Check for prompts
      if (!commandInfo.promptDetected) {
        const detection = this.promptDetector.detectPrompt(commandInfo.stdoutBuffer, 'stdout');
        if (detection) {
          commandInfo.promptDetected = detection;
          commandInfo.state = 'waiting_for_input';
          this.logger?.info('Prompt detected in background command', {
            commandId,
            agentId,
            type: detection.type,
            matchedText: detection.matchedText
          });
        }
      }
    });

    childProcess.stderr.on('data', (chunk) => {
      const data = chunk.toString();
      commandInfo.stderrBuffer += data;
      commandInfo.lastOutputTime = Date.now();

      // Check for prompts in stderr too
      if (!commandInfo.promptDetected) {
        const detection = this.promptDetector.detectPrompt(commandInfo.stderrBuffer, 'stderr');
        if (detection) {
          commandInfo.promptDetected = detection;
          commandInfo.state = 'waiting_for_input';
          this.logger?.info('Prompt detected in background command stderr', {
            commandId,
            agentId,
            type: detection.type,
            matchedText: detection.matchedText
          });
        }
      }
    });

    childProcess.on('exit', (code, signal) => {
      commandInfo.exitCode = code;
      commandInfo.state = code === 0 ? 'completed' : 'failed';
      commandInfo.endTime = new Date().toISOString();

      this.logger?.info('Background command exited', {
        commandId,
        agentId,
        exitCode: code,
        signal,
        state: commandInfo.state
      });
    });

    childProcess.on('error', (error) => {
      commandInfo.state = 'failed';
      commandInfo.error = error.message;
      commandInfo.endTime = new Date().toISOString();

      this.logger?.error('Background command error', {
        commandId,
        agentId,
        error: error.message
      });
    });

    // Return command info
    return {
      success: true,
      commandId,
      pid: childProcess.pid,
      command: originalCommand,
      translatedCommand,
      workingDirectory: workingDir,
      message: `Background command started with ID: ${commandId}`
    };
  }

  /**
   * Phase 3: Send input to a background command (stdin)
   * @param {string} commandId - Command identifier
   * @param {string} input - Input to send (will add newline automatically)
   * @param {string} agentId - Agent identifier for ownership validation
   * @returns {Object} Result
   */
  sendInput(commandId, input, agentId) {
    // Validate ownership
    const commandInfo = this.validateCommandOwnership(commandId, agentId);

    if (commandInfo.state === 'completed' || commandInfo.state === 'failed') {
      throw new Error(`Cannot send input to ${commandInfo.state} command`);
    }

    if (!commandInfo.process || commandInfo.process.killed) {
      throw new Error('Command process is not running');
    }

    // Send input with newline
    const inputWithNewline = input.endsWith('\n') ? input : input + '\n';
    commandInfo.process.stdin.write(inputWithNewline);

    this.logger?.info('Input sent to background command', {
      commandId,
      agentId,
      inputLength: input.length
    });

    // Update state if it was waiting
    if (commandInfo.state === 'waiting_for_input') {
      commandInfo.state = 'running';
      commandInfo.promptDetected = null; // Clear prompt after answering
    }

    return {
      success: true,
      commandId,
      message: 'Input sent successfully'
    };
  }

  /**
   * Phase 4: Get status of a background command
   * @param {string} commandId - Command identifier
   * @param {string} agentId - Agent identifier for ownership validation
   * @returns {Object} Command status
   */
  getCommandStatus(commandId, agentId) {
    const commandInfo = this.validateCommandOwnership(commandId, agentId);

    const timeSinceLastOutput = Date.now() - commandInfo.lastOutputTime;

    return {
      success: true,
      commandId,
      pid: commandInfo.pid,
      command: commandInfo.command,
      state: commandInfo.state,
      exitCode: commandInfo.exitCode,
      startTime: commandInfo.startTime,
      endTime: commandInfo.endTime,
      workingDirectory: commandInfo.workingDirectory,
      stdout: commandInfo.stdoutBuffer,
      stderr: commandInfo.stderrBuffer,
      stdoutLength: commandInfo.stdoutBuffer.length,
      stderrLength: commandInfo.stderrBuffer.length,
      lastOutputTime: commandInfo.lastOutputTime,
      timeSinceLastOutput,
      promptDetected: !!commandInfo.promptDetected,
      promptInfo: commandInfo.promptDetected || undefined
    };
  }

  /**
   * Phase 4: Kill a background command
   * @param {string} commandId - Command identifier
   * @param {string} agentId - Agent identifier for ownership validation
   * @returns {Object} Result
   */
  killCommand(commandId, agentId) {
    const commandInfo = this.validateCommandOwnership(commandId, agentId);

    if (commandInfo.state === 'completed' || commandInfo.state === 'failed') {
      return {
        success: true,
        commandId,
        message: 'Command already terminated',
        state: commandInfo.state
      };
    }

    if (commandInfo.process && !commandInfo.process.killed) {
      commandInfo.process.kill('SIGTERM');

      // If SIGTERM doesn't work, try SIGKILL after 5s
      setTimeout(() => {
        if (commandInfo.process && !commandInfo.process.killed) {
          commandInfo.process.kill('SIGKILL');
        }
      }, 5000);

      this.logger?.info('Background command killed', {
        commandId,
        agentId
      });

      return {
        success: true,
        commandId,
        message: 'Command killed successfully'
      };
    }

    return {
      success: false,
      commandId,
      error: 'Command process not found or already killed'
    };
  }

  /**
   * Phase 4: List all commands for an agent
   * @param {string} agentId - Agent identifier
   * @returns {Array} List of command info objects
   */
  listAgentCommands(agentId) {
    const commands = this.getAgentCommands(agentId);

    return commands.map(cmd => ({
      commandId: cmd.commandId,
      command: cmd.command,
      state: cmd.state,
      pid: cmd.pid,
      exitCode: cmd.exitCode,
      startTime: cmd.startTime,
      endTime: cmd.endTime,
      promptDetected: !!cmd.promptDetected,
      timeSinceLastOutput: Date.now() - cmd.lastOutputTime
    }));
  }

  /**
   * Phase 4: Get agent's commands (helper method)
   * @param {string} agentId - Agent identifier
   * @returns {Array} Array of command info objects
   * @private
   */
  getAgentCommands(agentId) {
    return Array.from(this.commandTracker.values())
      .filter(cmd => cmd.agentId === agentId);
  }

  /**
   * Phase 4: Validate command ownership
   * @param {string} commandId - Command identifier
   * @param {string} agentId - Agent identifier
   * @returns {Object} Command info if valid
   * @throws {Error} If command not found or access denied
   * @private
   */
  validateCommandOwnership(commandId, agentId) {
    const commandInfo = this.commandTracker.get(commandId);

    if (!commandInfo) {
      throw new Error(`Command not found: ${commandId}`);
    }

    if (commandInfo.agentId !== agentId) {
      throw new Error(`Access denied: Command belongs to agent ${commandInfo.agentId}`);
    }

    return commandInfo;
  }

  /**
   * Phase 4: Cleanup all commands for an agent (called when agent is deleted)
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupAgent(agentId) {
    const commands = this.getAgentCommands(agentId);

    let killedCount = 0;
    let removedCount = 0;

    for (const commandInfo of commands) {
      // Kill process if still running
      if (commandInfo.process && !commandInfo.process.killed) {
        commandInfo.process.kill('SIGTERM');
        killedCount++;

        // Force kill after delay
        setTimeout(() => {
          if (commandInfo.process && !commandInfo.process.killed) {
            commandInfo.process.kill('SIGKILL');
          }
        }, 3000);
      }

      // Remove from tracker
      this.commandTracker.delete(commandInfo.commandId);
      removedCount++;
    }

    this.logger?.info('Agent commands cleaned up', {
      agentId,
      killedCount,
      removedCount
    });

    return {
      success: true,
      agentId,
      killedCount,
      removedCount,
      message: `Cleaned up ${removedCount} commands for agent ${agentId}`
    };
  }

  /**
   * Phase 4: Auto-cleanup stale completed commands
   * @returns {Object} Cleanup result
   */
  cleanupStaleCommands() {
    const now = Date.now();
    let removedCount = 0;

    for (const [commandId, commandInfo] of this.commandTracker.entries()) {
      // Only clean up completed/failed commands
      if (commandInfo.state !== 'completed' && commandInfo.state !== 'failed') {
        continue;
      }

      // Check age
      const startTime = new Date(commandInfo.startTime).getTime();
      const ageMinutes = (now - startTime) / 1000 / 60;

      if (ageMinutes > this.MAX_COMMAND_AGE_MINUTES) {
        this.commandTracker.delete(commandId);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      this.logger?.info('Stale commands cleaned up', {
        removedCount,
        ageThresholdMinutes: this.MAX_COMMAND_AGE_MINUTES
      });
    }

    return {
      success: true,
      removedCount,
      message: `Cleaned up ${removedCount} stale commands`
    };
  }

  // ============================================
  // UI/API Methods for Terminal Task Viewing
  // ============================================

  /**
   * Get running tasks for UI display (sanitized, no process objects)
   * @param {string} agentId - Agent identifier (optional, if null returns all)
   * @returns {Array} List of running task info for UI
   */
  getRunningTasksForUI(agentId = null) {
    const commands = agentId
      ? this.getAgentCommands(agentId)
      : Array.from(this.commandTracker.values());

    // Filter to only running/waiting tasks and map to UI-safe format
    return commands
      .filter(cmd => cmd.state === 'running' || cmd.state === 'waiting_for_input')
      .map(cmd => ({
        commandId: cmd.commandId,
        agentId: cmd.agentId,
        command: cmd.command,
        workingDirectory: cmd.workingDirectory,
        state: cmd.state,
        pid: cmd.pid,
        startTime: cmd.startTime,
        elapsedMs: Date.now() - new Date(cmd.startTime).getTime(),
        outputSize: (cmd.stdoutBuffer?.length || 0) + (cmd.stderrBuffer?.length || 0),
        hasStderr: (cmd.stderrBuffer?.length || 0) > 0,
        promptDetected: cmd.promptDetected ? {
          type: cmd.promptDetected.type,
          description: cmd.promptDetected.description,
          matchedText: cmd.promptDetected.matchedText
        } : null,
        lastOutputTime: cmd.lastOutputTime,
        timeSinceLastOutput: Date.now() - cmd.lastOutputTime
      }))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime)); // Newest first
  }

  /**
   * Get task output for UI display
   * @param {string} commandId - Command identifier
   * @param {string} agentId - Agent identifier (for ownership validation, optional)
   * @param {Object} options - Output options
   * @param {number} options.tailLines - Number of lines from end (default: 100)
   * @param {boolean} options.includeStderr - Include stderr output (default: true)
   * @param {number} options.maxLength - Maximum total output length (default: 50000)
   * @returns {Object} Task output info
   */
  getTaskOutput(commandId, agentId = null, options = {}) {
    const {
      tailLines = TERMINAL_CONFIG.DEFAULT_TAIL_LINES,
      includeStderr = true,
      maxLength = TERMINAL_CONFIG.MAX_OUTPUT_LENGTH
    } = options;

    const commandInfo = this.commandTracker.get(commandId);

    if (!commandInfo) {
      return { success: false, error: 'Command not found' };
    }

    // Validate ownership if agentId provided
    if (agentId && commandInfo.agentId !== agentId) {
      return { success: false, error: 'Access denied' };
    }

    // Get stdout
    let stdout = commandInfo.stdoutBuffer || '';
    if (tailLines > 0) {
      const lines = stdout.split('\n');
      stdout = lines.slice(-tailLines).join('\n');
    }
    if (stdout.length > maxLength) {
      stdout = '... (truncated) ...\n' + stdout.slice(-maxLength);
    }

    // Get stderr if requested
    let stderr = '';
    if (includeStderr) {
      stderr = commandInfo.stderrBuffer || '';
      if (tailLines > 0) {
        const lines = stderr.split('\n');
        stderr = lines.slice(-tailLines).join('\n');
      }
      if (stderr.length > maxLength / 2) {
        stderr = '... (truncated) ...\n' + stderr.slice(-(maxLength / 2));
      }
    }

    return {
      success: true,
      commandId,
      agentId: commandInfo.agentId,
      command: commandInfo.command,
      workingDirectory: commandInfo.workingDirectory,
      state: commandInfo.state,
      exitCode: commandInfo.exitCode,
      startTime: commandInfo.startTime,
      endTime: commandInfo.endTime,
      stdout,
      stderr,
      totalStdoutSize: commandInfo.stdoutBuffer?.length || 0,
      totalStderrSize: commandInfo.stderrBuffer?.length || 0,
      promptDetected: commandInfo.promptDetected ? {
        type: commandInfo.promptDetected.type,
        description: commandInfo.promptDetected.description,
        matchedText: commandInfo.promptDetected.matchedText
      } : null
    };
  }

  /**
   * Get recent tasks (including completed) for UI display
   * @param {string} agentId - Agent identifier (optional)
   * @param {number} limit - Maximum number of tasks to return (default: 20)
   * @returns {Array} List of recent tasks
   */
  getRecentTasksForUI(agentId = null, limit = TERMINAL_CONFIG.RECENT_TASKS_LIMIT) {
    const commands = agentId
      ? this.getAgentCommands(agentId)
      : Array.from(this.commandTracker.values());

    return commands
      .map(cmd => ({
        commandId: cmd.commandId,
        agentId: cmd.agentId,
        command: cmd.command,
        workingDirectory: cmd.workingDirectory,
        state: cmd.state,
        pid: cmd.pid,
        exitCode: cmd.exitCode,
        startTime: cmd.startTime,
        endTime: cmd.endTime,
        elapsedMs: cmd.endTime
          ? new Date(cmd.endTime).getTime() - new Date(cmd.startTime).getTime()
          : Date.now() - new Date(cmd.startTime).getTime(),
        outputSize: (cmd.stdoutBuffer?.length || 0) + (cmd.stderrBuffer?.length || 0),
        hasStderr: (cmd.stderrBuffer?.length || 0) > 0,
        promptDetected: !!cmd.promptDetected
      }))
      .sort((a, b) => new Date(b.startTime) - new Date(a.startTime))
      .slice(0, limit);
  }

  /**
   * Get terminal tasks summary (counts by state)
   * @param {string} agentId - Agent identifier (optional)
   * @returns {Object} Summary counts
   */
  getTasksSummary(agentId = null) {
    const commands = agentId
      ? this.getAgentCommands(agentId)
      : Array.from(this.commandTracker.values());

    const summary = {
      total: commands.length,
      running: 0,
      waiting_for_input: 0,
      completed: 0,
      failed: 0
    };

    for (const cmd of commands) {
      if (summary[cmd.state] !== undefined) {
        summary[cmd.state]++;
      }
    }

    return summary;
  }
}

export default TerminalTool;