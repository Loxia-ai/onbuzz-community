/**
 * @file tools/visualEditorTool.js
 * @description Tool for visual editor integration - allows agents to interact
 * with user's web application visually and receive element selections with
 * source code locations.
 *
 * Phase 1: Basic actions (get-context, set-app-url, get-status)
 * Phase 5: Full actions (highlight, scroll-to, get-source, reload, set-mode)
 */

import { BaseTool } from './baseTool.js';
import { getVisualEditorBridge, InstanceStatus } from '../services/visualEditorBridge.js';
import { getVisualEditorServer, getVisualEditorPort, getVisualEditorBaseUrl } from '../services/visualEditorServer.js';
import { getPortTracker } from '../services/portTracker.js';
import { getProjectDetector, PROJECT_TYPES } from '../services/projectDetector.js';

/**
 * Supported actions for the Visual Editor Tool
 */
const ACTIONS = {
  GET_CONTEXT: 'get-context',
  SET_APP_URL: 'set-app-url',
  GET_STATUS: 'get-status',
  CLEAR_CONTEXT: 'clear-context',
  // Server management actions
  START_SERVER: 'start-server',      // Start dev server for project
  SERVE_STATIC: 'serve-static',      // Serve static files directly
  DETECT_PROJECT: 'detect-project',  // Detect project type
  // UI control actions
  OPEN_EDITOR: 'open-editor',        // Open visual editor in UI with specified URL
  // Phase 5 actions
  HIGHLIGHT: 'highlight',
  SCROLL_TO: 'scroll-to',
  GET_SOURCE: 'get-source',
  RELOAD: 'reload',
  SET_MODE: 'set-mode'
};

/**
 * VisualEditorTool - Interact with user's web application visually
 */
export class VisualEditorTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Override tool ID
    this.id = 'visual-editor';

    // Tool properties
    this.isAsync = false;
    this.requiresProject = false;

    // Bridge instance (lazy loaded)
    this._bridge = null;
  }

  /**
   * Get bridge instance (lazy load)
   * @private
   */
  _getBridge() {
    if (!this._bridge) {
      this._bridge = getVisualEditorBridge();
    }
    return this._bridge;
  }

  /**
   * Get tool description for agent system prompt
   * @returns {string} Formatted tool description
   */
  getDescription() {
    return `Tool: Visual Editor - Interact with the user's web application visually.

**PURPOSE:** Allow users to visually select elements in their app preview.
You receive context about selected elements including source code location.

**COMPLETE WORKFLOW - When user wants to visually edit their app:**

1. **If app is NOT running yet:**
   - Use \`detect-project\` to identify project type
   - Use \`serve-static\` (for HTML) or start dev server via Terminal tool

2. **Open the Visual Editor UI:**
   - Use \`open-editor\` with the app URL to show the visual editor to the user
   - This opens the preview panel in the UI automatically

3. **User clicks elements in the preview**
   - You automatically receive element context in messages

**ACTIONS:**

**open-editor** - Open visual editor UI with app URL (RECOMMENDED after starting server)
\`\`\`json
{
  "toolId": "visual-editor",
  "action": "open-editor",
  "parameters": {
    "url": "http://localhost:3000"
  }
}
\`\`\`
This opens the visual editor panel in the user's UI and loads your app for visual selection.

**detect-project** - Detect project type and get server suggestions
\`\`\`json
{
  "toolId": "visual-editor",
  "action": "detect-project"
}
\`\`\`
Returns: projectType, framework, serverCommand, defaultPort

**serve-static** - Serve static HTML files directly (no external server needed)
\`\`\`json
{
  "toolId": "visual-editor",
  "action": "serve-static",
  "parameters": {
    "directory": "public"  // Optional: subdirectory to serve, defaults to project root
  }
}
\`\`\`
Returns: url (e.g., http://localhost:4000/)

**set-app-url** - Configure the app URL for visual editing
\`\`\`json
{
  "toolId": "visual-editor",
  "action": "set-app-url",
  "parameters": {
    "url": "http://localhost:3000"
  }
}
\`\`\`

**get-context** - Get current visual selection (if any)
\`\`\`json
{
  "toolId": "visual-editor",
  "action": "get-context"
}
\`\`\`

**get-status** - Get visual editor instance status
\`\`\`json
{
  "toolId": "visual-editor",
  "action": "get-status"
}
\`\`\`

**clear-context** - Clear the current visual selection
\`\`\`json
{
  "toolId": "visual-editor",
  "action": "clear-context"
}
\`\`\`

**AUTOMATIC CONTEXT INJECTION:**
When user selects an element, you receive visual context automatically:
\`\`\`
[VISUAL CONTEXT - User selected element]
Element: <button class="btn-primary">
Source: src/components/Form.tsx:42 (Component: SubmitButton)
Code:
  41│  return (
► 42│    <button className="btn-primary">Submit</button>
  43│  );
\`\`\`

**WORKFLOW EXAMPLE:**
1. User: "Let me visually edit the app"
2. Agent: detect-project → React (Vite)
3. Agent: Terminal → npm run dev (starts on port 5173)
4. Agent: open-editor → url: http://localhost:5173 (opens UI panel)
5. Agent: "Visual editor ready! Click any element to select it."
6. User clicks element → context injected automatically
7. Agent: Uses filesystem tool to edit the source file

**TIPS:**
- For static HTML: Use \`serve-static\` then \`open-editor\`
- For React/Vue/Next.js: Start dev server via Terminal, then \`open-editor\`
- Always use \`open-editor\` to show the preview UI to the user
- Always acknowledge visual context when user selects element
- Use source location (file:line) to make targeted code changes`;
  }

  /**
   * Get supported actions
   * @returns {Array<string>} Supported action names
   */
  getSupportedActions() {
    return Object.values(ACTIONS);
  }

  /**
   * Get required parameters
   * @returns {Array<string>} Required parameter names
   */
  getRequiredParameters() {
    return ['action'];
  }

  /**
   * Parse parameters from tool command content
   * @param {string|Object} content - Raw content or parsed object
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    // Handle JSON format
    if (typeof content === 'object' && content !== null) {
      return this._parseJSONParams(content);
    }

    // Handle string format
    if (typeof content === 'string') {
      const trimmed = content.trim();

      // Try to parse as JSON
      if (trimmed.startsWith('{')) {
        try {
          const parsed = JSON.parse(trimmed);
          return this._parseJSONParams(parsed);
        } catch (err) {
          // Fall through to XML parsing
        }
      }

      // Parse as XML
      return this._parseXMLParams(content);
    }

    throw new Error('Invalid parameter format');
  }

  /**
   * Parse JSON parameters
   * @private
   */
  _parseJSONParams(obj) {
    // Handle parameters wrapper
    if (obj.parameters) {
      return {
        action: obj.action || ACTIONS.GET_CONTEXT,
        ...obj.parameters
      };
    }

    return {
      action: obj.action || ACTIONS.GET_CONTEXT,
      url: obj.url,
      selector: obj.selector,
      mode: obj.mode,
      projectRoot: obj.projectRoot
    };
  }

  /**
   * Parse XML parameters
   * @private
   */
  _parseXMLParams(content) {
    const extractTag = (tag) => {
      const regex = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const match = regex.exec(content);
      return match ? match[1].trim() : null;
    };

    return {
      action: extractTag('action') || ACTIONS.GET_CONTEXT,
      url: extractTag('url'),
      selector: extractTag('selector'),
      mode: extractTag('mode'),
      projectRoot: extractTag('project-root') || extractTag('projectRoot')
    };
  }

  /**
   * Validate parameters
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    // Validate action
    if (!Object.values(ACTIONS).includes(params.action)) {
      return {
        valid: false,
        error: `Invalid action: ${params.action}. Valid actions: ${Object.values(ACTIONS).join(', ')}`
      };
    }

    // Validate action-specific parameters
    if (params.action === ACTIONS.SET_APP_URL && !params.url) {
      return {
        valid: false,
        error: 'URL is required for set-app-url action'
      };
    }

    // Phase 5 actions validation (placeholder)
    if ([ACTIONS.HIGHLIGHT, ACTIONS.SCROLL_TO, ACTIONS.GET_SOURCE].includes(params.action)) {
      if (!params.selector) {
        return {
          valid: false,
          error: `Selector is required for ${params.action} action`
        };
      }
    }

    return { valid: true };
  }

  /**
   * Execute tool with parsed parameters
   * @param {Object|string} params - Parsed parameters or raw content
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Execution result
   */
  async execute(params, context = {}) {
    // FIRST THING: an unconditional console.log so we can always see that
    // the tool was invoked — before any early-return (parse failure,
    // bridge disabled, validation fail) or thrown error could swallow it.
    // Earlier the log lived past a `bridge.isEnabled()` gate and was
    // silently skipped whenever that gate tripped, making it look like
    // the tool wasn't being called at all.
    console.log('[VisualEditorTool] execute() called', {
      paramsType: typeof params,
      paramsAction: params?.action,
      paramsUrl: params?.url,
      agentId: context?.agentId,
      hasGlobalWebServer: !!global.loxiaWebServer,
      hasOrchestratorWebServer: !!context?.orchestrator?.webServer,
      hasAgentPool: !!context?.agentPool,
    });

    try {
      const { agentId } = context;

      // Auto-parse if string
      if (typeof params === 'string') {
        params = this.parseParameters(params);
      } else if (typeof params === 'object' && params !== null && !params.action) {
        params = this.parseParameters(params);
      }

      // Get bridge
      const bridge = this._getBridge();

      // Check if bridge is enabled
      if (!bridge.isEnabled()) {
        console.warn('[VisualEditorTool] Early exit: bridge.isEnabled() === false');
        return {
          success: false,
          error: 'Visual editor is disabled. Enable it in configuration.'
        };
      }

      // Validate
      const validation = this.customValidateParameters(params);
      if (!validation.valid) {
        console.warn('[VisualEditorTool] Early exit: validation failed', { action: params?.action, error: validation.error });
        return {
          success: false,
          error: validation.error
        };
      }

      // Confirmation that we reached action dispatch
      console.log(`[VisualEditorTool] Action=${params.action} — about to dispatch`, {
        agentId,
        url: params.url,
      });

      // Route to action handler
      switch (params.action) {
        case ACTIONS.GET_CONTEXT:
          return this._handleGetContext(bridge, agentId);

        case ACTIONS.SET_APP_URL:
          return this._handleSetAppUrl(bridge, agentId, params, context);

        case ACTIONS.GET_STATUS:
          return this._handleGetStatus(bridge, agentId);

        case ACTIONS.CLEAR_CONTEXT:
          return this._handleClearContext(bridge, agentId);

        // Server management actions
        case ACTIONS.DETECT_PROJECT:
          return this._handleDetectProject(context);

        case ACTIONS.SERVE_STATIC:
          return this._handleServeStatic(bridge, agentId, params, context);

        case ACTIONS.START_SERVER:
          return this._handleStartServer(bridge, agentId, params, context);

        // UI control actions
        case ACTIONS.OPEN_EDITOR:
          return this._handleOpenEditor(bridge, agentId, params, context);

        // Phase 5 actions - full editor control
        case ACTIONS.HIGHLIGHT:
          return this._handleHighlight(bridge, agentId, params);

        case ACTIONS.SCROLL_TO:
          return this._handleScrollTo(bridge, agentId, params);

        case ACTIONS.GET_SOURCE:
          return this._handleGetSource(bridge, agentId, params);

        case ACTIONS.RELOAD:
          return this._handleReload(bridge, agentId);

        case ACTIONS.SET_MODE:
          return this._handleSetMode(bridge, agentId, params);

        default:
          return {
            success: false,
            error: `Unknown action: ${params.action}`
          };
      }

    } catch (error) {
      // Log full stack + action context so failures that happen BEFORE
      // the broadcast fires (e.g., bridge.getInstance throws) are
      // visible in the Node console. Previously the tool returned a
      // clean error string to the agent and the human operator saw
      // nothing — making "the editor never opens" undebuggable.
      console.error(`[VisualEditorTool] Action=${params?.action} FAILED: ${error.message}`, {
        agentId,
        action: params?.action,
        stack: error.stack,
      });
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Handle get-context action
   * @private
   */
  _handleGetContext(bridge, agentId) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required to get visual context'
      };
    }

    const context = bridge.getVisualContext(agentId);

    if (!context) {
      return {
        success: true,
        hasContext: false,
        message: 'No visual selection. User can select an element in Visual Mode.'
      };
    }

    // Format context for agent consumption
    return {
      success: true,
      hasContext: true,
      context: {
        selector: context.selector,
        tagName: context.tagName,
        text: context.text,
        attributes: context.attributes,
        sourceHint: context.sourceHint,
        receivedAt: context.receivedAt
      },
      formatted: this._formatContextForAgent(context)
    };
  }

  /**
   * Handle set-app-url action
   * @private
   */
  async _handleSetAppUrl(bridge, agentId, params, context) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required to set app URL'
      };
    }

    // Validate URL format
    try {
      new URL(params.url);
    } catch {
      return {
        success: false,
        error: `Invalid URL format: ${params.url}`
      };
    }

    // Get or create instance
    const instance = await bridge.getInstance(agentId, {
      appUrl: params.url,
      projectRoot: params.projectRoot
    });

    // Generate editor URL and broadcast to web-ui to auto-open the visual editor panel
    const baseUrl = getVisualEditorBaseUrl();
    const editorUrl = `${baseUrl}?agentId=${agentId}&appUrl=${encodeURIComponent(params.url)}`;
    this._broadcastOpenEditor(context, {
      agentId,
      appUrl: params.url,
      editorUrl
    });

    return {
      success: true,
      message: `App URL configured: ${params.url}. Visual editor panel opening.`,
      editorUrl,
      instance: {
        agentId: instance.agentId,
        appUrl: instance.appUrl,
        projectRoot: instance.projectRoot,
        status: instance.status
      }
    };
  }

  /**
   * Handle get-status action
   * @private
   */
  _handleGetStatus(bridge, agentId) {
    if (!agentId) {
      // Return global status
      const instances = bridge.listInstances();
      return {
        success: true,
        instanceCount: instances.length,
        maxInstances: bridge.maxInstances,
        instances: instances.map(inst => ({
          agentId: inst.agentId,
          status: inst.status,
          appUrl: inst.appUrl,
          hasContext: inst.hasContext,
          idleMs: inst.idleMs
        }))
      };
    }

    const status = bridge.getStatus(agentId);

    if (!status.exists) {
      return {
        success: true,
        exists: false,
        message: 'No visual editor instance for this agent. Use set-app-url to configure.'
      };
    }

    return {
      success: true,
      exists: true,
      status: status.status,
      appUrl: status.appUrl,
      projectRoot: status.projectRoot,
      editorUrl: status.editorUrl,
      hasVisualContext: status.hasVisualContext,
      subscriberCount: status.subscriberCount,
      idleMs: status.idleMs,
      error: status.error
    };
  }

  /**
   * Handle clear-context action
   * @private
   */
  _handleClearContext(bridge, agentId) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required to clear visual context'
      };
    }

    const cleared = bridge.clearVisualContext(agentId);

    return {
      success: true,
      cleared,
      message: cleared
        ? 'Visual context cleared'
        : 'No visual context to clear'
    };
  }

  // === Server Management Action Handlers ===

  /**
   * Handle detect-project action
   * @private
   */
  async _handleDetectProject(context) {
    // Support all three names historically used by different callers:
    //   - projectRoot       — legacy visual-editor context
    //   - workingDirectory  — terminal/filesystem context
    //   - projectDir        — messageProcessor's canonical name (src/core/messageProcessor.js)
    // Without the third fallback, every call routed through messageProcessor
    // (i.e., all agent-initiated ones) fails with "No project directory
    // available" — leaving the editor only usable when invoked manually
    // from a path where the context happens to carry the legacy keys.
    const projectRoot = context.projectRoot || context.workingDirectory || context.projectDir;

    if (!projectRoot) {
      return {
        success: false,
        error: 'No project directory available. Set projectRoot in context.'
      };
    }

    const detector = getProjectDetector();
    const detection = await detector.detect(projectRoot);

    if (detection.error) {
      return {
        success: false,
        error: detection.error
      };
    }

    const serverInfo = detector.getSuggestedServerCommand(detection);

    return {
      success: true,
      projectDir: projectRoot,
      projectType: detection.projectType,
      framework: detection.framework,
      isStatic: detection.isStatic,
      entryPoints: detection.entryPoints,
      serverCommand: serverInfo.command,
      defaultPort: serverInfo.port,
      availableScripts: detection.availableScripts,
      confidence: detection.confidence,
      message: detection.isStatic
        ? `Static HTML project detected. Use 'serve-static' action to preview.`
        : `${detection.framework || detection.projectType} project detected. Run "${serverInfo.command}" to start server.`
    };
  }

  /**
   * Handle serve-static action - serve static files via Visual Editor Server
   * @private
   */
  async _handleServeStatic(bridge, agentId, params, context) {
    // Support all three names historically used by different callers:
    //   - projectRoot       — legacy visual-editor context
    //   - workingDirectory  — terminal/filesystem context
    //   - projectDir        — messageProcessor's canonical name (src/core/messageProcessor.js)
    // Without the third fallback, every call routed through messageProcessor
    // (i.e., all agent-initiated ones) fails with "No project directory
    // available" — leaving the editor only usable when invoked manually
    // from a path where the context happens to carry the legacy keys.
    const projectRoot = context.projectRoot || context.workingDirectory || context.projectDir;

    if (!projectRoot) {
      return {
        success: false,
        error: 'No project directory available'
      };
    }

    // Get Visual Editor Server
    const server = getVisualEditorServer();

    // Start server if not running
    if (!server.isRunning) {
      await server.start();
    }

    // Determine directory to serve
    const directory = params.directory || '';
    const fullPath = directory ? `${projectRoot}/${directory}` : projectRoot;

    // Register static directory with the server
    server.registerStaticDir(agentId, fullPath);

    // Generate URL for static files using configurable port
    const baseUrl = getVisualEditorBaseUrl();
    const staticUrl = `${baseUrl}/static/${agentId}/`;

    // Also set as app URL for the visual editor
    if (agentId) {
      const instance = await bridge.getInstance(agentId, {
        appUrl: staticUrl,
        projectRoot
      });

      bridge.updateStatus(agentId, instance.status, {
        editorUrl: `${baseUrl}?agentId=${agentId}&appUrl=${encodeURIComponent(staticUrl)}`
      });
    }

    const editorUrl = `${baseUrl}?agentId=${agentId}&appUrl=${encodeURIComponent(staticUrl)}`;

    // Broadcast to web-ui to auto-open the visual editor panel
    this._broadcastOpenEditor(context, {
      agentId,
      appUrl: staticUrl,
      editorUrl
    });

    return {
      success: true,
      url: staticUrl,
      directory: fullPath,
      message: `Static files served at ${staticUrl}. Visual Mode ready.`,
      editorUrl
    };
  }

  /**
   * Handle start-server action - provides server command info
   * (Actual server start should be done via Terminal tool)
   * @private
   */
  async _handleStartServer(bridge, agentId, params, context) {
    // Support all three names historically used by different callers:
    //   - projectRoot       — legacy visual-editor context
    //   - workingDirectory  — terminal/filesystem context
    //   - projectDir        — messageProcessor's canonical name (src/core/messageProcessor.js)
    // Without the third fallback, every call routed through messageProcessor
    // (i.e., all agent-initiated ones) fails with "No project directory
    // available" — leaving the editor only usable when invoked manually
    // from a path where the context happens to carry the legacy keys.
    const projectRoot = context.projectRoot || context.workingDirectory || context.projectDir;

    if (!projectRoot) {
      return {
        success: false,
        error: 'No project directory available'
      };
    }

    // Detect project
    const detector = getProjectDetector();
    const detection = await detector.detect(projectRoot);

    // Get port tracker
    const portTracker = getPortTracker();
    const preferredPort = params.port || detection.defaultPort;

    // Find available port
    const availablePort = await portTracker.findAvailablePort(
      preferredPort,
      preferredPort + 100
    );

    if (!availablePort) {
      return {
        success: false,
        error: `No available ports in range ${preferredPort}-${preferredPort + 100}`
      };
    }

    // Get command with port
    const serverInfo = detector.getSuggestedServerCommand(detection, availablePort);

    return {
      success: true,
      projectType: detection.projectType,
      framework: detection.framework,
      command: serverInfo.command,
      port: availablePort,
      expectedUrl: `http://localhost:${availablePort}`,
      instructions: `
To start the server:
1. Use Terminal tool: ${serverInfo.command}
2. Wait for server to start
3. Use open-editor with url: http://localhost:${availablePort} (this will open the visual editor panel in the UI)

Or for static HTML, use 'serve-static' action instead (auto-opens the editor).
      `.trim()
    };
  }

  // === UI Control Action Handlers ===

  /**
   * Handle open-editor action - opens visual editor UI with specified app URL
   * Broadcasts a message to the web-ui to enable visual editor mode
   * @private
   */
  async _handleOpenEditor(bridge, agentId, params, context) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required to open visual editor'
      };
    }

    // Validate URL format
    const appUrl = params.url;
    if (!appUrl) {
      return {
        success: false,
        error: 'URL parameter is required. Provide the URL of your running app (e.g., http://localhost:3000)'
      };
    }

    try {
      new URL(appUrl);
    } catch {
      return {
        success: false,
        error: `Invalid URL format: ${appUrl}`
      };
    }

    // Verify the target app is reachable and scan for errors
    let pageWarnings = [];
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(appUrl, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow'
      });
      clearTimeout(timeoutId);

      if (!response.ok && response.status >= 500) {
        return {
          success: false,
          error: `Target app returned HTTP ${response.status} at ${appUrl}. Make sure the app is running and accessible.`
        };
      }

      // Scan response body for common error patterns
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('text/html') || contentType.includes('text/plain')) {
        const body = await response.text();
        const bodyLower = body.toLowerCase();
        const bodySnippet = body.slice(0, 4000); // Limit scan size

        // Common build/runtime error patterns
        const errorPatterns = [
          { pattern: /Module not found|Cannot find module/i, msg: 'Module not found error detected' },
          { pattern: /SyntaxError|Unexpected token/i, msg: 'JavaScript syntax error detected' },
          { pattern: /TypeError|ReferenceError|RangeError/i, msg: 'JavaScript runtime error detected' },
          { pattern: /ENOENT|EACCES|EADDRINUSE/i, msg: 'Node.js filesystem/port error detected' },
          { pattern: /Cannot GET|Cannot POST|Not Found/i, msg: 'Route not found (404-like page)' },
          { pattern: /Compilation failed|Build failed|Failed to compile/i, msg: 'Build/compilation error detected' },
          { pattern: /Error: |ERROR |error occurred/i, msg: 'Error message found in page content' },
          { pattern: /<pre class="error">/i, msg: 'Error overlay detected (dev server error page)' },
          { pattern: /vite-error-overlay|react-error-overlay|nextjs-portal/i, msg: 'Framework error overlay detected' },
        ];

        for (const { pattern, msg } of errorPatterns) {
          const match = bodySnippet.match(pattern);
          if (match) {
            // Extract surrounding context (up to 150 chars around the match)
            const idx = bodySnippet.indexOf(match[0]);
            const start = Math.max(0, idx - 50);
            const end = Math.min(bodySnippet.length, idx + match[0].length + 100);
            const context = bodySnippet.slice(start, end)
              .replace(/<[^>]+>/g, ' ')  // Strip HTML tags
              .replace(/\s+/g, ' ')      // Collapse whitespace
              .trim();
            pageWarnings.push(`${msg}: ...${context}...`);
          }
        }

        // Check if page is essentially empty (broken build output)
        const textContent = body.replace(/<[^>]+>/g, '').trim();
        if (textContent.length < 10 && !body.includes('<script')) {
          pageWarnings.push('Page appears empty (no content or scripts). The app may not have built correctly.');
        }
      }
    } catch (fetchErr) {
      const isAbort = fetchErr.name === 'AbortError';
      return {
        success: false,
        error: isAbort
          ? `Target app at ${appUrl} did not respond within 5 seconds. Make sure the dev server is running.`
          : `Cannot reach ${appUrl}: ${fetchErr.message}. Start the dev server first, then retry open-editor.`
      };
    }

    // Ensure visual editor server is running (no-op if already started at boot)
    const server = getVisualEditorServer();
    if (!server.isRunning) {
      await server.start();
    }

    // Get or create instance
    const instance = await bridge.getInstance(agentId, {
      appUrl,
      projectRoot: context.projectRoot || context.workingDirectory || context.projectDir
    });

    // Generate editor URL using configurable port
    const baseUrl = getVisualEditorBaseUrl();
    const editorUrl = `${baseUrl}?agentId=${agentId}&appUrl=${encodeURIComponent(appUrl)}`;

    // Update instance status
    bridge.updateStatus(agentId, instance.status, {
      editorUrl
    });

    // Broadcast to web-ui to open visual editor
    this._broadcastOpenEditor(context, {
      agentId,
      appUrl,
      editorUrl,
      sessionId: context.sessionId
    });

    const result = {
      success: true,
      message: `Visual Editor opening with ${appUrl}. The preview panel will appear in the UI.`,
      appUrl,
      editorUrl,
      instructions: 'Click elements in the preview to select them. You will receive context automatically.'
    };

    if (pageWarnings.length > 0) {
      result.warnings = pageWarnings;
      result.message += `\n\nWarnings detected on page:\n${pageWarnings.map(w => `  - ${w}`).join('\n')}`;
    }

    return result;
  }

  /**
   * Broadcast open-editor command to web-ui.
   *
   * Fan-out semantics: we deliberately pass `null` as sessionId so the
   * webServer's broadcastToSession falls through to its "broadcast to all
   * connections" path. Previously this used `context.sessionId ||
   * 'web-session'`, but `context.sessionId` is usually the agent's
   * scheduler session (`scheduler-session`) which doesn't match any UI
   * WebSocket connection, and the literal `'web-session'` fallback only
   * matches if a client happens to have that exact id. In both cases the
   * underlying broadcastToSession also falls back to "all clients", but
   * the path is log-noisy ("⚠ No connections for session") and semantically
   * misleading. The visual editor auto-open is inherently a UI-scoped
   * notification — we want every attached browser to hear it.
   * @private
   */
  _broadcastOpenEditor(context, data) {
    const message = {
      type: 'visual_editor_open',
      data: {
        agentId: data.agentId,
        appUrl: data.appUrl,
        editorUrl: data.editorUrl
      }
    };

    // Use plain console.log so the success path always prints even when
    // the tool was constructed without a logger (pre-logger-propagation
    // registries, test harnesses, future refactors).
    const log = (path) =>
      console.log(`[VisualEditorTool] Broadcast visual_editor_open via ${path}`, {
        agentId: data.agentId,
        appUrl: data.appUrl,
      });

    // Prefer the global webServer reference. Rationale:
    //   - It's set exactly once, at boot (`global.loxiaWebServer = webServer`
    //     in src/index.js after the server's own `initialize()` resolves).
    //   - It bypasses any context-wiring subtlety. The tool's context can
    //     be shaped differently depending on how the tool was invoked
    //     (scheduler vs. direct orchestrator vs. flow executor), and
    //     past outages have been "the context path USED to be populated,
    //     then someone refactored the orchestrator setter order and the
    //     inner path silently became undefined". The global dodges that.
    //   - Verified live: the `/api/visual-editor/debug-broadcast` endpoint
    //     uses the same webServer.broadcastToSession(null, ...) call and
    //     delivers successfully every time.
    // The context-based paths are kept as belt-and-braces fallbacks for
    // any unusual execution environment (tests, possible future
    // embedded use) where `global` wasn't initialized.
    if (global.loxiaWebServer?.broadcastToSession) {
      global.loxiaWebServer.broadcastToSession(null, message);
      log('global.loxiaWebServer');
      return;
    }

    if (context.agentPool?.messageProcessor?.orchestrator?.webServer?.broadcastToSession) {
      context.agentPool.messageProcessor.orchestrator.webServer.broadcastToSession(null, message);
      log('agentPool.messageProcessor.orchestrator.webServer');
      return;
    }

    if (context.orchestrator?.webServer?.broadcastToSession) {
      context.orchestrator.webServer.broadcastToSession(null, message);
      log('context.orchestrator.webServer');
      return;
    }

    console.warn('[VisualEditorTool] Could not broadcast open-editor command - no webServer access', {
      hasContext: !!context,
      hasAgentPool: !!context?.agentPool,
      hasOrchestrator: !!context?.orchestrator,
      hasGlobal: !!global.loxiaWebServer,
    });
  }

  // === Phase 5 Action Handlers ===

  /**
   * Handle highlight action - highlight element in preview
   * @private
   */
  _handleHighlight(bridge, agentId, params) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required for highlight action'
      };
    }

    // Check if connected
    if (!bridge.isConnected(agentId)) {
      return {
        success: false,
        error: 'Not connected to visual editor. Start the editor first.',
        hint: 'Use set-app-url to configure and connect to the visual editor'
      };
    }

    const duration = params.duration || 2000;
    const sent = bridge.highlightElement(agentId, params.selector, duration);

    return {
      success: sent,
      message: sent
        ? `Highlighting "${params.selector}" for ${duration}ms`
        : 'Failed to send highlight command',
      selector: params.selector,
      duration
    };
  }

  /**
   * Handle scroll-to action - scroll to element in preview
   * @private
   */
  _handleScrollTo(bridge, agentId, params) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required for scroll-to action'
      };
    }

    if (!bridge.isConnected(agentId)) {
      return {
        success: false,
        error: 'Not connected to visual editor. Start the editor first.'
      };
    }

    const sent = bridge.scrollToElement(agentId, params.selector);

    return {
      success: sent,
      message: sent
        ? `Scrolling to "${params.selector}"`
        : 'Failed to send scroll command',
      selector: params.selector
    };
  }

  /**
   * Handle get-source action - get source code for selector
   * @private
   */
  async _handleGetSource(bridge, agentId, params) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required for get-source action'
      };
    }

    // Get visual context for the selector
    const context = bridge.getVisualContext(agentId);

    // If we have context with source hint, return it
    if (context && context.sourceHint) {
      const { file, line, component, codeSnippet, confidence } = context.sourceHint;

      return {
        success: true,
        selector: params.selector,
        source: {
          file,
          line,
          component,
          codeSnippet,
          confidence
        },
        message: file
          ? `Source: ${file}:${line}${component ? ` (${component})` : ''}`
          : 'Source location available in context'
      };
    }

    // No source hint available
    return {
      success: true,
      selector: params.selector,
      source: null,
      message: 'No source information available for this selector. Try selecting the element in Visual Mode first.'
    };
  }

  /**
   * Handle reload action - reload the preview
   * @private
   */
  _handleReload(bridge, agentId) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required for reload action'
      };
    }

    if (!bridge.isConnected(agentId)) {
      return {
        success: false,
        error: 'Not connected to visual editor. Start the editor first.'
      };
    }

    const sent = bridge.reloadPreview(agentId);

    return {
      success: sent,
      message: sent
        ? 'Preview reload requested'
        : 'Failed to send reload command'
    };
  }

  /**
   * Handle set-mode action - switch editor mode
   * @private
   */
  _handleSetMode(bridge, agentId, params) {
    if (!agentId) {
      return {
        success: false,
        error: 'Agent ID is required for set-mode action'
      };
    }

    if (!bridge.isConnected(agentId)) {
      return {
        success: false,
        error: 'Not connected to visual editor. Start the editor first.'
      };
    }

    const mode = params.mode;
    if (!['edit', 'preview'].includes(mode)) {
      return {
        success: false,
        error: `Invalid mode: ${mode}. Must be 'edit' or 'preview'`
      };
    }

    const sent = bridge.setEditorMode(agentId, mode);

    return {
      success: sent,
      message: sent
        ? `Editor mode set to '${mode}'`
        : 'Failed to send mode command',
      mode
    };
  }

  /**
   * Format visual context for agent consumption
   * @private
   */
  _formatContextForAgent(context) {
    let formatted = `[VISUAL CONTEXT - User selected element]\n`;
    formatted += `Element: <${context.tagName}`;

    // Add key attributes
    if (context.attributes?.class) {
      formatted += ` class="${context.attributes.class}"`;
    }
    if (context.attributes?.id) {
      formatted += ` id="${context.attributes.id}"`;
    }
    formatted += '>\n';

    // Add CSS selector for precise targeting
    if (context.selector) {
      formatted += `Selector: ${context.selector}\n`;
    }

    // Add text content if available
    if (context.text) {
      const truncated = context.text.length > 50
        ? context.text.substring(0, 50) + '...'
        : context.text;
      formatted += `Text: "${truncated}"\n`;
    }

    // Add source hint if available
    if (context.sourceHint) {
      const { file, fullPath, line, component, confidence } = context.sourceHint;

      // Use file path if available, fallback to fullPath
      const filePath = file || fullPath;

      if (filePath) {
        formatted += `Source: ${filePath}`;
        if (line) {
          formatted += `:${line}`;
        }
        if (component) {
          formatted += ` (Component: ${component})`;
        }
        if (confidence === 'low') {
          formatted += ' [VERIFY - low confidence]';
        }
        formatted += '\n';
      } else if (component) {
        // Even without file path, component name is useful
        formatted += `Component: ${component}`;
        if (confidence === 'low') {
          formatted += ' [source file unknown]';
        }
        formatted += '\n';
      }

      // Add code snippet if available
      if (context.sourceHint.codeSnippet) {
        formatted += 'Code:\n';
        formatted += context.sourceHint.codeSnippet;
        formatted += '\n';
      }
    } else {
      // No React source info - indicate this is likely vanilla HTML/CSS
      formatted += `Note: No React source mapping available (plain HTML element)\n`;
    }

    return formatted;
  }

  /**
   * Inject visual context into user message
   * Called by messageProcessor when visual context exists
   * @param {string} userMessage - Original user message
   * @param {Object} context - Visual context
   * @returns {string} Enhanced message with visual context
   */
  static injectContextIntoMessage(userMessage, visualContext) {
    if (!visualContext) {
      return userMessage;
    }

    const tool = new VisualEditorTool();
    const formatted = tool._formatContextForAgent(visualContext);

    return `${formatted}\n[USER MESSAGE]\n${userMessage}`;
  }
}

export default VisualEditorTool;
