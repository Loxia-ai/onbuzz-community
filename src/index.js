/**
 * OnBuzz Community - Main Application Entry Point
 * 
 * Purpose:
 * - Initialize all system components
 * - Setup dependency injection
 * - Start interface handlers
 * - Handle graceful shutdown
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { createLogger } from './utilities/logger.js';
import { createConfigManager } from './utilities/configManager.js';
import Orchestrator from './core/orchestrator.js';
import AgentPool from './core/agentPool.js';
import MessageProcessor from './core/messageProcessor.js';
import AgentScheduler from './core/agentScheduler.js';
import ContextManager from './core/contextManager.js';
import StateManager from './core/stateManager.js';
import AIService from './services/aiService.js';
import BudgetService from './services/budgetService.js';
import ErrorHandler from './services/errorHandler.js';
import BenchmarkService from './services/benchmarkService.js';
import ModelRouterService from './services/modelRouterService.js';
import ModelsService from './services/modelsService.js';
import ApiKeyManager from './services/apiKeyManager.js';
import { getCredentialVault } from './services/credentialVault.js';
import FileAttachmentService from './services/fileAttachmentService.js';
import { ToolsRegistry } from './tools/baseTool.js';
import AgentDelayTool from './tools/agentDelayTool.js';
import TerminalTool from './tools/terminalTool.js';
import FileSystemTool from './tools/fileSystemTool.js';
import JobDoneTool from './tools/jobDoneTool.js';
import AgentCommunicationTool from './tools/agentCommunicationTool.js';
import TaskManagerTool from './tools/taskManagerTool.js';
import ImportAnalyzerTool from './tools/importAnalyzerTool.js';
import DependencyResolverTool from './tools/dependencyResolverTool.js';
import StaticAnalysisTool from './tools/staticAnalysisTool.js';
import CloneDetectionTool from './tools/cloneDetectionTool.js';
import FileTreeTool from './tools/fileTreeTool.js';
import FileContentReplaceTool from './tools/fileContentReplaceTool.js';
import SeekTool from './tools/seekTool.js';
import WebTool from './tools/webTool.js';
import VisualEditorTool from './tools/visualEditorTool.js';
import PdfTool from './tools/pdfTool.js';
import HelpTool from './tools/helpTool.js';
import DocxTool from './tools/docxTool.js';
import ExcelTool from './tools/excelTool.js';
import MemoryTool from './tools/memoryTool.js';
import SkillsTool from './tools/skillsTool.js';
import UserPromptTool from './tools/userPromptTool.js';
import CodeMapTool from './tools/codeMapTool.js';
import PlatformControlTool from './tools/platformControlTool.js';
import ScheduleService from './services/scheduleService.js';
import AsyncToolManager from './tools/asyncToolManager.js';
import WebServer from './interfaces/webServer.js';

import {
  SYSTEM_VERSION,
  INTERFACE_TYPES
} from './utilities/constants.js';
import {
  getUserDataDir,
  ensureUserDataDirs,
  migrateFromOldLocation,
  getLegacyDataPaths
} from './utilities/userDataDir.js';

class LoxiaApplication {
  constructor() {
    this.logger = null;
    this.config = null;
    this.orchestrator = null;
    this.interfaces = new Map();
    this.isShuttingDown = false;
    
    // Bind shutdown handler
    this.shutdown = this.shutdown.bind(this);
  }

  /**
   * Initialize the application
   * @param {Object} options - Initialization options
   * @returns {Promise<void>}
   */
  async initialize(options = {}) {
    try {
      console.log(`🚀 Starting OnBuzz Community v${SYSTEM_VERSION}`);

      // Initialize configuration
      await this.initializeConfig(options);

      // Initialize logging
      await this.initializeLogging();

      this.logger.info('OnBuzz Community starting up', {
        version: SYSTEM_VERSION,
        nodeVersion: process.version,
        platform: process.platform,
        projectDir: options.projectDir || process.cwd()
      });

      // IMPORTANT: Initialize persistent user data directory and migrate legacy data
      // This ensures user data (agents, conversations, settings) survives npm updates
      await this.initializeUserDataDirectory();

      // Initialize core components
      await this.initializeCoreComponents();
      
      // Initialize tools
      await this.initializeTools();
      
      this.logger.info('Starting interface initialization...');
      
      // Initialize interfaces
      await this.initializeInterfaces(options);
      
      this.logger.info('Interface initialization completed');
      
      // Setup shutdown handlers
      this.setupShutdownHandlers();
      
      this.logger.info('OnBuzz Community startup complete');
      console.log('✅ OnBuzz Community is ready!');
      
    } catch (error) {
      console.error('❌ Failed to initialize OnBuzz Community:', error.message);
      if (this.logger) {
        this.logger.error('Application initialization failed', {
          error: error.message,
          stack: error.stack
        });
      }
      process.exit(1);
    }
  }

  /**
   * Initialize configuration management
   * @private
   */
  async initializeConfig(options) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    const configPaths = [
      path.join(__dirname, '../config/default.json'),
      ...(options.configPaths || [])
    ];
    
    this.configManager = createConfigManager({
      configPaths,
      envPrefix: 'LOXIA'
    });
    
    this.config = await this.configManager.loadConfig();
    
    // Enable config watching if requested
    if (options.watchConfig) {
      await this.configManager.watchConfig(true);
    }
  }

  /**
   * Initialize logging system
   * @private
   */
  async initializeLogging() {
    const loggingConfig = this.config.logging || {};

    this.logger = createLogger({
      level: loggingConfig.level || 'info',
      outputs: loggingConfig.outputs || ['console'],
      colors: loggingConfig.colors !== false,
      timestamp: loggingConfig.timestamp !== false,
      logFile: loggingConfig.logFile,
      maxFileSize: loggingConfig.maxFileSize,
      maxFiles: loggingConfig.maxFiles
    });

    await this.logger.initialize();
  }

  /**
   * Initialize persistent user data directory and migrate legacy data
   * This ensures user data survives npm package updates
   * @private
   */
  async initializeUserDataDirectory() {
    try {
      // Create user data directory structure
      const paths = await ensureUserDataDirs();
      const userDataDir = getUserDataDir();

      this.logger.info('User data directory initialized', {
        location: userDataDir,
        platform: process.platform
      });

      // Check for legacy data and migrate if needed
      const legacyPaths = getLegacyDataPaths();
      for (const legacyPath of legacyPaths) {
        try {
          const result = await migrateFromOldLocation(legacyPath, {
            dryRun: false,
            logger: this.logger
          });

          if (result.migrated.length > 0) {
            this.logger.info('Successfully migrated data from legacy location', {
              from: legacyPath,
              migratedCount: result.migrated.length
            });
            console.log(`📦 Migrated ${result.migrated.length} items from legacy location to ${userDataDir}`);
          }
        } catch (migrationError) {
          // Non-fatal: log and continue
          this.logger.warn('Failed to migrate from legacy location', {
            legacyPath,
            error: migrationError.message
          });
        }
      }

    } catch (error) {
      this.logger.error('Failed to initialize user data directory', {
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Initialize core system components
   * @private
   */
  async initializeCoreComponents() {
    this.logger.info('Initializing core components...');
    
    // State Manager
    this.stateManager = new StateManager(this.config, this.logger);

    // File Attachment Service
    this.fileAttachmentService = new FileAttachmentService(this.config, this.logger);
    await this.fileAttachmentService.initialize();

    // Context Manager
    this.contextManager = new ContextManager(this.config, this.logger);
    
    // Tools Registry and Async Tool Manager
    this.toolsRegistry = new ToolsRegistry(this.logger);
    this.asyncToolManager = new AsyncToolManager(this.config, this.logger);
    
    // Agent Pool (with tools registry for prompt enhancement)
    this.agentPool = new AgentPool(
      this.config,
      this.logger,
      this.stateManager,
      this.contextManager,
      this.toolsRegistry
    );
    
    // Initialize Budget Service and Error Handler
    this.budgetService = new BudgetService(this.config, this.logger);
    this.errorHandler = new ErrorHandler(this.config, this.logger);
    
    // API Key Manager
    this.apiKeyManager = new ApiKeyManager(this.logger);
    await this.apiKeyManager.initialize(); // Load persisted keys

    // Credential Vault for secure website credential management
    this.credentialVault = getCredentialVault(this.logger);
    await this.credentialVault.initialize(); // Load persisted credentials

    // Telegram Service (optional — requires node-telegram-bot-api)
    try {
      const { getTelegramService } = await import('./services/telegramService.js');
      this.telegramService = getTelegramService(this.logger);
      this.logger.info('Telegram service initialized');
    } catch (e) {
      this.telegramService = null;
      this.logger.info('Telegram service unavailable', { error: e.message });
    }

    // Discord Service (optional — requires discord.js)
    try {
      const { getDiscordService } = await import('./services/discordService.js');
      this.discordService = getDiscordService(this.logger);
      this.logger.info('Discord service initialized');
    } catch (e) {
      this.discordService = null;
      this.logger.info('Discord service unavailable', { error: e.message });
    }

    // Schedule Service
    this.scheduleService = new ScheduleService(this.logger);
    await this.scheduleService.initialize();

    // AI Service
    this.aiService = new AIService(
      this.config,
      this.logger,
      this.budgetService,
      this.errorHandler
    );
    
    // Set API Key Manager reference in AI Service
    this.aiService.setApiKeyManager(this.apiKeyManager);
    
    // Set Agent Pool reference in AI Service
    this.aiService.setAgentPool(this.agentPool);
    
    // Initialize Model Routing Services
    this.benchmarkService = new BenchmarkService(this.config, this.logger);
    this.modelsService = new ModelsService(this.config, this.logger);
    this.modelRouterService = new ModelRouterService(
      this.config,
      this.logger,
      this.benchmarkService,
      this.aiService
    );
    
    // Set API Key Manager reference in ModelsService
    this.modelsService.setApiKeyManager(this.apiKeyManager);

    // ModelsService needs AIService to reach the provider registry so it
    // can ask each adapter for its live /models list on initialize() and
    // refresh(). Without this wiring, loadModels() falls back to manifest
    // only — which silently masks deprecated entries (e.g. gemini-1.5-pro).
    this.modelsService.setAIService(this.aiService);

    // Set ModelsService reference in AI Service (for model suggestions on errors)
    this.aiService.setModelsService(this.modelsService);

    // Set ModelsService reference in BudgetService (for dynamic pricing lookup)
    this.budgetService.setModelsService(this.modelsService);

    // Initialize services
    await this.benchmarkService.initialize();
    await this.modelsService.initialize();
    
    // Message Processor
    this.messageProcessor = new MessageProcessor(
      this.config,
      this.logger,
      this.toolsRegistry,
      this.agentPool,
      this.contextManager,
      this.aiService,
      this.modelRouterService,
      this.modelsService
    );
    
    // Agent Scheduler - NEW ARCHITECTURE
    this.agentScheduler = new AgentScheduler(
      this.agentPool,
      this.messageProcessor,
      this.aiService,
      this.logger,
      null, // webSocketManager will be set later
      this.modelRouterService,
      this.modelsService
    );
    
    // Note: Scheduler will be started after WebSocketManager is initialized
    
    // Orchestrator
    this.orchestrator = new Orchestrator(
      this.config,
      this.logger,
      this.agentPool,
      this.messageProcessor,
      this.aiService,
      this.stateManager
    );

    // Expose toolsRegistry on the orchestrator so downstream wiring (e.g.
    // webServer's flowExecutor init at webServer.js:574 → jobDoneTool
    // setFlowExecutor) can reach it through the orchestrator handle. Without
    // this, `this.orchestrator?.toolsRegistry` is undefined at wiring time
    // and JobDoneTool's flow-contract validation (Phase 8) silently no-ops
    // for the entire process lifetime.
    this.orchestrator.toolsRegistry = this.toolsRegistry;
    this.orchestrator.modelsService = this.modelsService;

    // Set cross-references between components
    this.messageProcessor.orchestrator = this.orchestrator;
    this.messageProcessor.setScheduler(this.agentScheduler);
    this.agentPool.setMessageProcessor(this.messageProcessor);
    this.agentPool.setScheduler(this.agentScheduler);
    this.agentPool.setFileAttachmentService(this.fileAttachmentService);

    // Attach FileAttachmentService to orchestrator for webServer access
    this.orchestrator.fileAttachmentService = this.fileAttachmentService;

    // Wire ScheduleService dependencies
    this.scheduleService.setAgentPool(this.agentPool);
    this.scheduleService.setMessageProcessor(this.messageProcessor);
    this.scheduleService.setOrchestrator(this.orchestrator);

    this.logger.info('Core components initialized');
  }

  /**
   * Initialize tools system
   * @private
   */
  async initializeTools() {
    this.logger.info('Initializing tools...');
    
    // Register Agent Delay Tool
    await this.toolsRegistry.registerTool(AgentDelayTool);
    
    // Register Terminal Tool
    await this.toolsRegistry.registerTool(TerminalTool);
    
    // Register File System Tool
    await this.toolsRegistry.registerTool(FileSystemTool);
    
    // Register Job Done Tool
    await this.toolsRegistry.registerTool(JobDoneTool);
    
    // Register Agent Communication Tool
    await this.toolsRegistry.registerTool(AgentCommunicationTool);
    
    // Register Task Manager Tool
    await this.toolsRegistry.registerTool(TaskManagerTool);

    // Register Import Analyzer Tool
    await this.toolsRegistry.registerTool(ImportAnalyzerTool);

    // Register Dependency Resolver Tool
    await this.toolsRegistry.registerTool(DependencyResolverTool);

    // Register Static Analysis Tool
    await this.toolsRegistry.registerTool(StaticAnalysisTool);

    // Register Clone Detection Tool
    await this.toolsRegistry.registerTool(CloneDetectionTool);

    // Register File Tree Tool
    await this.toolsRegistry.registerTool(FileTreeTool);

    // Register File Content Replace Tool
    await this.toolsRegistry.registerTool(FileContentReplaceTool);

    // Register Seek Tool
    await this.toolsRegistry.registerTool(SeekTool);

    // Register Web Tool
    await this.toolsRegistry.registerTool(WebTool);

    // Register Visual Editor Tool
    await this.toolsRegistry.registerTool(VisualEditorTool);

    // Register PDF Tool
    await this.toolsRegistry.registerTool(PdfTool);

    // Register Help Tool (two-layer tool description system)
    await this.toolsRegistry.registerTool(HelpTool);

    // Register Document (DOCX) Tool
    await this.toolsRegistry.registerTool(DocxTool);

    // Register Spreadsheet (Excel) Tool
    await this.toolsRegistry.registerTool(ExcelTool);

    // Register Memory Tool
    await this.toolsRegistry.registerTool(MemoryTool);
    await this.toolsRegistry.registerTool(SkillsTool);

    // Register User Prompt Tool
    await this.toolsRegistry.registerTool(UserPromptTool);

    // Register Code Map Tool
    await this.toolsRegistry.registerTool(CodeMapTool);

    // Register Platform Control Tool — agent-facing platform control
    // (currently: scheduled tasks; per-agent permission, default DISABLED).
    await this.toolsRegistry.registerTool(PlatformControlTool);

    // widget-module: remove this block if the module is deleted.
    // Registers the WidgetTool for agent-facing custom-UI rendering.
    // Honors LOXIA_DISABLE_WIDGETS=1 env flag for a zero-source kill switch.
    const widgetModule = await import('./modules/widget/index.js');
    if (!widgetModule.isDisabled()) {
      await this.toolsRegistry.registerTool(widgetModule.WidgetTool);
    }

    // Set ToolsRegistry dependency for HelpTool (two-layer tool description system)
    const helpTool = this.toolsRegistry.getTool('help');
    if (helpTool && typeof helpTool.setToolsRegistry === 'function') {
      helpTool.setToolsRegistry(this.toolsRegistry);
      this.logger.info('ToolsRegistry set for Help Tool');
    }

    // Set AgentPool dependency for AgentDelayTool
    const agentDelayTool = this.toolsRegistry.getTool('agentdelay');
    if (agentDelayTool && typeof agentDelayTool.setAgentPool === 'function') {
      agentDelayTool.setAgentPool(this.agentPool);
    }

    // Wire ScheduleService into PlatformControlTool. Without this, the
    // tool reports "ScheduleService is not available" for any feature
    // action — useful as a defensive default but not what we want here.
    const platformControlTool = this.toolsRegistry.getTool('platformcontrol');
    if (platformControlTool) {
      if (typeof platformControlTool.setScheduleService === 'function') {
        platformControlTool.setScheduleService(this.scheduleService);
      }
      // Agent + team CRUD requires AgentPool, StateManager, MemoryService.
      if (typeof platformControlTool.setAgentPool === 'function') {
        platformControlTool.setAgentPool(this.agentPool);
      }
      if (typeof platformControlTool.setStateManager === 'function') {
        platformControlTool.setStateManager(this.stateManager);
      }
      if (typeof platformControlTool.setMemoryService === 'function') {
        const { getMemoryService } = await import('./services/memoryService.js');
        platformControlTool.setMemoryService(getMemoryService(this.logger));
      }
      // Flow CRUD + execution requires the FlowExecutor (created later in
      // the boot sequence by the webServer). The webServer init also
      // calls setFlowExecutor on this tool when it spins up — so this
      // call is the one that fires when the executor is already alive
      // (rare during startup), and the webServer call covers the normal
      // path. Both are idempotent.
      if (typeof platformControlTool.setFlowExecutor === 'function' && this.flowExecutor) {
        platformControlTool.setFlowExecutor(this.flowExecutor);
      }
    }
    
    // Set AgentPool dependency for JobDoneTool
    const jobDoneTool = this.toolsRegistry.getTool('jobdone');
    if (jobDoneTool && typeof jobDoneTool.setAgentPool === 'function') {
      jobDoneTool.setAgentPool(this.agentPool);
    }
    
    // Set AgentPool and Scheduler dependencies for TaskManagerTool
    const taskManagerTool = this.toolsRegistry.getTool('taskmanager');
    if (taskManagerTool && typeof taskManagerTool.setAgentPool === 'function') {
      taskManagerTool.setAgentPool(this.agentPool);
    }
    if (taskManagerTool && typeof taskManagerTool.setScheduler === 'function') {
      taskManagerTool.setScheduler(this.scheduler);
    }
    
    // Note: AgentCommunicationTool receives agentPool through execution context
    // No need to set it directly as it's passed in the context parameter
    const agentCommTool = this.toolsRegistry.getTool('agentcommunication');
    if (agentCommTool) {
      this.logger.info('Agent Communication Tool registered successfully');
    }

    const toolCapabilities = this.toolsRegistry.getToolCapabilities();
    this.logger.info('Tools initialized', {
      toolCount: Object.keys(toolCapabilities).length,
      enabledTools: Object.keys(toolCapabilities).filter(id => toolCapabilities[id].capabilities.enabled),
      registeredTools: this.toolsRegistry.listTools()
    });
    
    // Log tool descriptions for debugging
    if (this.logger.level === 'debug') {
      for (const [toolId, tool] of Object.entries(toolCapabilities)) {
        this.logger.debug(`Tool ${toolId} capabilities`, tool.capabilities);
      }
    }
  }

  /**
   * Initialize interface handlers
   * @private
   */
  async initializeInterfaces(options) {
    this.logger.info('Initializing interfaces...');

    const interfaceConfig = this.config.interfaces || {};
    const uiMode = process.env.LOXIA_UI_MODE || 'cli'; // Default to old CLI

    // CLI Interface - Load old readline CLI (unless terminal UI mode is specified)
    // NOTE: Terminal UI mode runs as a separate WebSocket client, not in the main process
    if (interfaceConfig.cli?.enabled !== false && uiMode !== 'terminal') {
      // Use old CLI (readline-based)
      this.logger.info('Loading CLI (readline)...');
      const { default: CLIInterface } = await import('./interfaces/cli.js');
      const cliInterface = new CLIInterface(
        this.orchestrator,
        this.logger,
        interfaceConfig.cli || {}
      );

      await cliInterface.initialize();
      this.interfaces.set(INTERFACE_TYPES.CLI, cliInterface);

      this.logger.info('CLI interface initialized');
    }

    // If terminal UI mode, skip CLI - Terminal UI will connect as WebSocket client
    if (uiMode === 'terminal') {
      this.logger.info('Terminal UI mode: Server-only startup (Terminal UI will connect as WebSocket client)');
    }
    
    // Web Interface - now implemented
    if (interfaceConfig.web?.enabled !== false) {
      // Read port from environment variables (set by CLI) or use config defaults
      const webPort = parseInt(process.env.LOXIA_PORT || process.env.PORT, 10) || 8080;
      // Use env var, then config, then 0.0.0.0 (accept connections from all interfaces)
      const webHost = process.env.LOXIA_HOST || interfaceConfig.web?.host || '0.0.0.0';

      const webConfig = {
        ...interfaceConfig.web,
        port: webPort,
        host: webHost,
        backend: this.config.backend
      };

      const webServer = new WebServer(
        this.orchestrator,
        this.logger,
        webConfig
      );
      
      // Pass toolsRegistry to webServer for the /api/tools endpoint
      webServer.toolsRegistry = this.toolsRegistry;
      
      // Set API Key Manager reference in Web Server
      webServer.setApiKeyManager(this.apiKeyManager);

      // Set Credential Vault reference in Web Server
      webServer.setCredentialVault(this.credentialVault);

      // Set Telegram Service references
      if (this.telegramService) {
        webServer.setTelegramService(this.telegramService);
        this.telegramService.setOrchestrator(this.orchestrator);
        this.telegramService.setAgentPool(this.agentPool);
        this.telegramService.setWebSocketManager(webServer);
        if (this.flowExecutor) this.telegramService.setFlowExecutor(this.flowExecutor);
        // Let the scheduler query bridge-state per agent so it can inject
        // the <external> routing guidance into system prompts only when the
        // agent is actually addressable from Telegram.
        this.agentScheduler?.setTelegramService?.(this.telegramService);
        // Auto-connect if token exists in config (non-blocking)
        this.telegramService.autoConnect().catch(e =>
          this.logger.warn('Telegram auto-connect failed', { error: e.message })
        );
      }

      // Set Discord Service references
      if (this.discordService) {
        webServer.setDiscordService(this.discordService);
        this.discordService.setOrchestrator(this.orchestrator);
        this.discordService.setAgentPool(this.agentPool);
        this.discordService.setWebSocketManager(webServer);
        if (this.flowExecutor) this.discordService.setFlowExecutor(this.flowExecutor);
        // Same bridge-awareness hook as Telegram above — the scheduler
        // only appends <external> guidance when `isAgentBridged(agentId)`
        // returns true for this channel.
        this.agentScheduler?.setDiscordService?.(this.discordService);
        // Auto-connect if token exists in config (non-blocking)
        this.discordService.autoConnect().catch(e =>
          this.logger.warn('Discord auto-connect failed', { error: e.message })
        );
      }

      await webServer.initialize();
      this.interfaces.set(INTERFACE_TYPES.WEB, webServer);
      
      // Attach WebServer to orchestrator for MessageProcessor broadcasting
      this.orchestrator.webServer = webServer;
      
      // Connect MessageProcessor to WebServer for real-time updates
      this.messageProcessor.setWebSocketManager(webServer);
      
      // Connect AgentScheduler to WebServer for real-time updates
      this.agentScheduler.webSocketManager = webServer;
      
      // Start the scheduler now that WebSocketManager is available
      this.agentScheduler.start();
      this.logger.info('Agent Scheduler started with WebSocket integration');
      
      // Wire ScheduleService to WebServer and FlowExecutor
      webServer.setScheduleService(this.scheduleService);
      this.scheduleService.setWebSocketManager(webServer);
      if (webServer.flowExecutor) {
        this.scheduleService.setFlowExecutor(webServer.flowExecutor);
      }
      this.scheduleService.start();
      this.logger.info('ScheduleService started with WebSocket integration');

      // Set global reference for tools that need to broadcast
      global.loxiaWebServer = webServer;

      // Connect JobDoneTool to WebServer for broadcasting mode changes
      const jobDoneTool = this.toolsRegistry.getTool('jobdone');
      if (jobDoneTool && typeof jobDoneTool.setWebSocketManager === 'function') {
        jobDoneTool.setWebSocketManager(webServer);
        this.logger.info('WebSocketManager set for JobDone Tool');
      }

      // Connect UserPromptTool to WebServer and AgentPool for user prompting
      const userPromptTool = this.toolsRegistry.getTool('userprompt');
      if (userPromptTool) {
        if (typeof userPromptTool.setWebSocketManager === 'function') {
          userPromptTool.setWebSocketManager(webServer);
        }
        if (typeof userPromptTool.setAgentPool === 'function') {
          userPromptTool.setAgentPool(this.agentPool);
        }
        this.logger.info('Dependencies set for UserPrompt Tool');
      }

      const status = webServer.getStatus();
      this.logger.info('Web interface initialized', { url: status.url });
      console.log(`🌐 Server running at ${status.url}`);
      console.log(`📱 Web UI available at: ${status.url}`);

      // Auto-open browser (skip when running inside Electron — it creates its own window)
      if (!process.env.LOXIA_ELECTRON) {
        const url = status.url.replace('0.0.0.0', 'localhost');
        const platform = process.platform;
        const openCmd = platform === 'win32' ? `start "" "${url}"`
                      : platform === 'darwin' ? `open "${url}"`
                      : `xdg-open "${url}"`;
        exec(openCmd, (err) => {
          if (err) this.logger.debug('Could not auto-open browser', { error: err.message });
        });
      }
    }
    
    // VSCode Extension Interface (placeholder)
    if (interfaceConfig.vscode?.enabled === true) {
      this.logger.info('VSCode interface configured but not implemented yet');
      // TODO: Initialize VSCode extension interface
    }
  }

  /**
   * Setup graceful shutdown handlers
   * @private
   */
  setupShutdownHandlers() {
    // Handle SIGINT (Ctrl+C)
    process.on('SIGINT', async () => {
      console.log('\n📋 Received SIGINT, shutting down gracefully...');
      await this.shutdown();
    });
    
    // Handle SIGTERM
    process.on('SIGTERM', async () => {
      console.log('\n📋 Received SIGTERM, shutting down gracefully...');
      await this.shutdown();
    });
    
    // Handle uncaught exceptions
    process.on('uncaughtException', async (error) => {
      console.error('❌ Uncaught exception:', error);
      if (this.logger) {
        this.logger.error('Uncaught exception', {
          error: error.message,
          stack: error.stack
        });
      }
      
      await this.shutdown();
      process.exit(1);
    });
    
    // Handle unhandled promise rejections
    process.on('unhandledRejection', async (reason, promise) => {
      const reasonMessage = reason?.message || String(reason);

      // List of known non-critical rejections that shouldn't crash the server
      const nonCriticalPatterns = [
        'Credential request cancelled',
        'Credential request timed out',
        'Target closed',
        'Session closed',
        'Protocol error',
        'Navigation timeout',
        'net::ERR_',
        'Requesting main frame too early',
        'Connection closed',
        // AI/model errors should NOT crash the server
        'HTTP 4',            // 400, 401, 403, 404, 429, etc.
        'HTTP 5',            // 500, 502, 503, etc.
        'circuit breaker',
        'Rate limit',
        'Insufficient credits',
        'not suitable for chat',
        'No API key configured',
        'Message content is empty',
        'Backend returned malformed',
        'stream generator',
        'No response choices',
        'model error',
        'isModelError',
        'Service temporarily unavailable',
        'Failed to fetch models',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ECONNRESET',
        'fetch failed',
        'AbortError',
        'The operation was aborted'
      ];

      const isNonCritical = nonCriticalPatterns.some(pattern =>
        reasonMessage.includes(pattern)
      );

      if (isNonCritical) {
        console.warn('⚠️ Non-critical promise rejection (server continues):', reasonMessage);
        if (this.logger) {
          this.logger.warn('Non-critical promise rejection', {
            reason: reasonMessage,
            promise: promise.toString()
          });
        }
        return; // Don't crash for non-critical errors
      }

      console.error('❌ Unhandled promise rejection:', reason);
      if (this.logger) {
        this.logger.error('Unhandled promise rejection', {
          reason: reasonMessage,
          promise: promise.toString()
        });
      }

      await this.shutdown();
      process.exit(1);
    });
  }

  /**
   * Gracefully shutdown the application
   * @returns {Promise<void>}
   */
  async shutdown() {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;

    // Force-exit safety net: if graceful shutdown hangs, kill the process after 10s
    const forceExitTimer = setTimeout(() => {
      console.error('⚠️ Graceful shutdown timed out after 10s — forcing exit');
      process.exit(1);
    }, 10000);
    forceExitTimer.unref(); // Don't let this timer keep the process alive on its own

    try {
      console.log('🛑 Shutting down OnBuzz Community...');
      
      if (this.logger) {
        this.logger.info('Application shutdown initiated');
      }
      
      // Stop schedule service first
      if (this.scheduleService) {
        this.scheduleService.stop();
        this.logger?.info('Schedule service stopped');
      }

      // Stop agent scheduler (prevents new work from starting mid-shutdown)
      if (this.agentScheduler) {
        this.agentScheduler.stop();
        this.logger?.info('Agent scheduler stopped');
      }

      // Cancel any pending model fetch retries
      if (this.modelsService?._cancelRetry) {
        this.modelsService._cancelRetry();
        this.logger?.info('Models service retries cancelled');
      }

      // Close Puppeteer browser (webTool) — it holds DevTools ports
      if (this.toolsRegistry) {
        for (const toolId of ['web']) {
          try {
            const tool = this.toolsRegistry.getTool(toolId);
            if (tool?.cleanup) {
              await tool.cleanup();
              this.logger?.info(`${toolId} tool cleanup complete`);
            }
          } catch (error) {
            this.logger?.warn(`Failed to cleanup ${toolId} tool`, { error: error.message });
          }
        }
      }

      // Kill ALL running terminal processes across all agents
      if (this.toolsRegistry) {
        try {
          const terminalTool = this.toolsRegistry.getTool('terminal');
          if (terminalTool?.commandTracker) {
            let killed = 0;
            for (const [cmdId, cmdInfo] of terminalTool.commandTracker) {
              if (cmdInfo.process && cmdInfo.state === 'RUNNING') {
                try {
                  cmdInfo.process.kill('SIGTERM');
                  killed++;
                } catch { /* already dead */ }
              }
            }
            if (killed > 0) {
              this.logger?.info(`Killed ${killed} running terminal process(es) on shutdown`);
            }
          }
        } catch (error) {
          this.logger?.warn('Failed to cleanup terminal processes', { error: error.message });
        }
      }

      // Shutdown interfaces (web server, visual editor, WS connections)
      for (const [type, interface_] of this.interfaces) {
        try {
          if (interface_.shutdown) {
            await interface_.shutdown();
          }
          this.logger?.info(`${type} interface shutdown complete`);
        } catch (error) {
          console.error(`Failed to shutdown ${type} interface:`, error.message);
        }
      }

      // Shutdown async tool manager
      if (this.asyncToolManager) {
        await this.asyncToolManager.shutdown();
        this.logger?.info('Async tool manager shutdown complete');
      }

      // Shutdown orchestrator (persists agent states)
      if (this.orchestrator) {
        await this.orchestrator.shutdown();
        this.logger?.info('Orchestrator shutdown complete');
      }

      // Cleanup configuration manager
      if (this.configManager) {
        this.configManager.cleanup();
      }
      
      // Close logger
      if (this.logger) {
        await this.logger.close();
      }
      
      console.log('✅ OnBuzz Community shutdown complete');
      
    } catch (error) {
      console.error('❌ Error during shutdown:', error.message);
    } finally {
      process.exit(0);
    }
  }

  /**
   * Get application status
   * @returns {Object} Application status
   */
  getStatus() {
    return {
      version: SYSTEM_VERSION,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      interfaces: Array.from(this.interfaces.keys()),
      isShuttingDown: this.isShuttingDown
    };
  }
}

/**
 * Main application entry point
 */
async function main() {
  const app = new LoxiaApplication();
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const options = {
    projectDir: process.cwd(),
    watchConfig: args.includes('--watch-config'),
    configPaths: []
  };

  // Parse --port and --host from argv so they work when running index.js directly
  // (bin/cli.js sets these as env vars, but npm start / node src/index.js bypasses cli.js)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && args[i + 1]) {
      process.env.LOXIA_PORT = args[i + 1];
    }
    if (args[i] === '--host' && args[i + 1]) {
      process.env.LOXIA_HOST = args[i + 1];
    }
  }

  // Look for custom config file
  const configIndex = args.indexOf('--config');
  if (configIndex !== -1 && args[configIndex + 1]) {
    options.configPaths.push(args[configIndex + 1]);
  }
  
  await app.initialize(options);
  
  // Keep the application running
  return app;
}

// Start the application if this file is run directly
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] === __filename) {
  console.log('🚀 Starting OnBuzz Community...');
  main().catch(error => {
    console.error('❌ Failed to start OnBuzz Community:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  });
}

export { LoxiaApplication, main };