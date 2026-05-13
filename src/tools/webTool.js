/**
 * WebTool - Web browsing and automation with Puppeteer
 *
 * Purpose:
 * - Search the web using known search engines
 * - Fetch web content in various formats
 * - Interactive browser automation with command chaining
 * - Tab management with agent isolation
 * - Screenshot capture and AI-powered analysis
 * - Mouse and keyboard event simulation
 *
 * ============================================================================
 * TODO: FEATURES TO ADD
 * ============================================================================
 *
 * TODO 1: TIME-BASED WAIT ACTION
 * -----------------------------------------------------------------------------
 * Add a time-based wait capability alongside the existing 'wait-for-selector'.
 *
 * Implementation details:
 * - Add new action type: 'wait' or 'delay' (distinct from 'wait-for-selector')
 * - Accept 'waitTime' parameter in milliseconds (e.g., 1000 = 1 second)
 * - Use: await new Promise(resolve => setTimeout(resolve, waitTime))
 * - Max limit suggestion: 30000ms (30 seconds) to prevent abuse
 * - Use case: Wait for JavaScript-rendered content, animations, or rate limiting
 *
 * Example invocation:
 * ```json
 * {
 *   "toolId": "web",
 *   "operation": "interactive",
 *   "tabName": "my-tab",
 *   "commands": [
 *     { "action": "navigate", "url": "https://example.com" },
 *     { "action": "wait", "waitTime": 2000 },
 *     { "action": "screenshot" }
 *   ]
 * }
 * ```
 *
 * TODO 2: IMPROVED TYPE ACTION WITH ELEMENT WAITING AND CLEARING
 * -----------------------------------------------------------------------------
 * Enhance the 'type' action to automatically wait for the element and optionally
 * clear existing content before typing.
 *
 * Implementation details:
 * - Before typing, wait for the selector to be visible (with configurable timeout)
 * - Add 'clearFirst' option (boolean, default: true) to clear input before typing
 * - Add 'delay' option for human-like typing speed (ms between keystrokes)
 * - Use page.click(selector) to focus, then page.keyboard.type() for realistic input
 * - Consider using page.$eval to clear: element.value = ''
 *
 * Example invocation:
 * ```json
 * {
 *   "action": "type",
 *   "selector": "#search-input",
 *   "text": "search query",
 *   "clearFirst": true,
 *   "delay": 50,
 *   "waitForSelector": true,
 *   "timeout": 5000
 * }
 * ```
 *
 * TODO 3: FLAT ACTION STRUCTURE (NO WRAPPER REQUIRED)
 * -----------------------------------------------------------------------------
 * Allow executing single actions without requiring the 'open-tab' or 'interactive'
 * wrapper structure. This makes simple operations more concise.
 *
 * Implementation details:
 * - Detect when params contain a single 'action' at the top level
 * - Auto-create or reuse a default tab for the agent
 * - Execute the action directly without requiring explicit tab management
 * - Useful for quick one-off operations like screenshots or navigation
 *
 * Example invocation (simplified):
 * ```json
 * {
 *   "toolId": "web",
 *   "action": "navigate",
 *   "url": "https://example.com"
 * }
 * ```
 * Instead of:
 * ```json
 * {
 *   "toolId": "web",
 *   "operation": "interactive",
 *   "tabName": "default",
 *   "commands": [{ "action": "navigate", "url": "https://example.com" }]
 * }
 * ```
 *
 * TODO 4: HUMAN-LIKE BROWSING DELAYS
 * -----------------------------------------------------------------------------
 * Add configurable delays between actions to make browsing appear more human-like.
 * This helps avoid bot detection and rate limiting on websites.
 *
 * Implementation details:
 * - Add 'humanMode' or 'naturalDelay' option to interactive operations
 * - When enabled, add random delays (e.g., 500-2000ms) between commands
 * - Add random mouse movements before clicks
 * - Vary typing speed with random delays between keystrokes
 * - Consider adding scroll jitter and viewport variations
 *
 * Example:
 * ```json
 * {
 *   "toolId": "web",
 *   "operation": "interactive",
 *   "humanMode": true,
 *   "commands": [...]
 * }
 * ```
 * ============================================================================
 */

import { BaseTool } from './baseTool.js';
import TagParser from '../utilities/tagParser.js';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';

import {
  TOOL_STATUS,
  SYSTEM_DEFAULTS
} from '../utilities/constants.js';

// Stealth browser and human behavior utilities
import {
  createStealthBrowser,
  createStealthPage,
  getRandomViewport
} from '../utilities/browserStealth.js';

import {
  createHumanCursor,
  humanType,
  humanWait,
  humanScroll,
  humanSubmit
} from '../utilities/humanBehavior.js';

import { BROWSER_CONFIG, KNOWN_SITES, LOGIN_FIELD_PATTERNS } from '../utilities/stealthConstants.js';

// Credential vault for secure authentication
import { getCredentialVault } from '../services/credentialVault.js';

class WebTool extends BaseTool {
  constructor(config = {}, logger = null) {
    super(config, logger);

    // Tool metadata
    this.requiresProject = false;
    this.isAsync = true;
    this.builtinDelay = 3000; // 3 second delay after browser operations

    // Browser instance (singleton per system)
    this.browser = null;
    this.browserInitializing = false;

    // Tab tracking: Map<agentId, Map<tabName, tabInfo>>
    this.agentTabs = new Map();

    // Known search engines
    this.searchEngines = [
      {
        name: 'google',
        url: 'https://www.google.com/search?q=',
        searchSelector: 'input[name="q"]',
        submitSelector: 'input[type="submit"], button[type="submit"]',
        // Google's DOM varies by region/bot-detection — use broad selectors
        resultsSelector: '#search .g a[href], #rso a[href], .g a[href], div[data-hveid] a[href]',
        waitSelector: '#search, #rso, #main'
      },
      {
        name: 'bing',
        url: 'https://www.bing.com/search?q=',
        searchSelector: 'input[name="q"]',
        submitSelector: 'input[type="submit"]',
        resultsSelector: '.b_algo a, .b_algo h2 a, li.b_algo a',
        waitSelector: '#b_results, #b_content'
      },
      {
        name: 'duckduckgo',
        url: 'https://duckduckgo.com/?q=',
        searchSelector: 'input[name="q"]',
        submitSelector: 'button[type="submit"]',
        resultsSelector: '.result__a, a[data-testid="result-title-a"], article a[href]',
        waitSelector: '#links, [data-testid="mainline"], .results'
      }
    ];

    // Configuration
    this.TAB_IDLE_TIMEOUT = config.tabIdleTimeout || 60 * 60 * 1000; // 1 hour
    this.CLEANUP_INTERVAL = config.cleanupInterval || 5 * 60 * 1000; // 5 minutes
    this.DEFAULT_TIMEOUT = config.defaultTimeout || 60000; // 60 seconds
    this.TEMP_DIR = config.tempDir || path.join(os.tmpdir(), 'webtool-screenshots');

    // Start cleanup timer
    this.cleanupTimer = null;
    this.startCleanupTimer();

    // Ensure temp directory exists
    this.ensureTempDir();
  }

  /**
   * Get tool description for LLM consumption
   * @returns {string} Tool description
   */
  getDescription() {
    return `
Web Tool: Browse, search, and automate web interactions using Puppeteer.

## AUTHENTICATED BROWSING WORKFLOW (IMPORTANT - READ FIRST)

When you need to browse a site that requires login, follow this workflow:

### Option A: Keep tab open (RECOMMENDED for immediate follow-up browsing)
\`\`\`json
Step 1: Authenticate with keepTabOpen
{"toolId": "web", "operation": "authenticate", "site": "mysite", "loginUrl": "https://example.com/login", "tabName": "session", "keepTabOpen": true}

Step 2: Continue browsing in same tab (MUST use stealthLevel: "maximum")
{"toolId": "web", "operation": "interactive", "stealthLevel": "maximum", "actions": [
  {"type": "switch-tab", "name": "session"},
  {"type": "navigate", "url": "https://example.com/dashboard"},
  {"type": "extract-text", "selector": ".content"}
]}
\`\`\`

### Option B: Open new tab after authentication (cookies auto-restored)
\`\`\`json
Step 1: Authenticate (tab closes after login, cookies saved)
{"toolId": "web", "operation": "authenticate", "site": "mysite", "loginUrl": "https://example.com/login"}

Step 2: Open new tab - cookies are automatically restored (MUST use stealthLevel: "maximum")
{"toolId": "web", "operation": "interactive", "stealthLevel": "maximum", "actions": [
  {"type": "open-tab", "name": "browsing", "url": "https://example.com/dashboard", "nestedActions": [
    {"type": "extract-text", "selector": ".content"}
  ]}
]}
\`\`\`

**CRITICAL RULES:**
1. ALWAYS use stealthLevel: "maximum" after authentication (changing levels restarts browser)
2. NEVER type passwords with interactive - always use authenticate operation
3. The agent is PAUSED while waiting for user credentials - this is normal

## AUTHENTICATION DETAILS

A secure modal appears for user to enter credentials. You NEVER see or type credentials.

### Pre-configured sites (no selectors needed):
linkedin, github, google, twitter
\`\`\`json
{"toolId": "web", "operation": "authenticate", "site": "linkedin"}
\`\`\`

### Custom sites (provide selectors):
First FETCH the login page to identify form selectors, then authenticate:
\`\`\`json
{"toolId": "web", "operation": "authenticate", "site": "customsite", "loginUrl": "https://example.com/login", "usernameSelector": "input[name='email']", "passwordSelector": "input[type='password']", "submitSelector": "button[type='submit']"}
\`\`\`

## STEALTH LEVELS
- "standard" (default): Headless browser, invisible. Good for public pages.
- "maximum": Visible Chrome window. REQUIRED for authenticated browsing and bot detection bypass.

## OPERATIONS

1. SEARCH - Search the web
\`\`\`json
{"toolId": "web", "operation": "search", "query": "search terms", "engine": "duckduckgo", "maxResults": 10}
\`\`\`

2. FETCH - Get page content (public pages only)
\`\`\`json
{"toolId": "web", "operation": "fetch", "url": "https://example.com", "formats": ["title", "text", "links"]}
\`\`\`

3. INTERACTIVE - Browser automation
\`\`\`json
{"toolId": "web", "operation": "interactive", "stealthLevel": "maximum", "actions": [
  {"type": "open-tab", "name": "main", "url": "https://example.com", "nestedActions": [
    {"type": "wait-for", "selector": ".content"},
    {"type": "click", "selector": "button"},
    {"type": "extract-text", "selector": "#content"},
    {"type": "screenshot", "format": "file", "path": "screenshot.png"}
  ]}
]}
\`\`\`

## INTERACTIVE ACTIONS
- Tab: open-tab, close-tab, switch-tab, list-tabs
- Navigation: navigate, wait-for, wait (time-based delay)
- Input: click, type, press, hover, scroll, select, submit
- Extract: extract-text, extract-links, get-source, screenshot, get-field-values, evaluate

## FORM FILLING WORKFLOW (RECOMMENDED)

When filling and submitting web forms, follow this pattern:

### Step 1: Discover the form — fetch page text, then get-source to find selectors
\`\`\`json
{"toolId": "web", "operation": "interactive", "stealthLevel": "maximum", "actions": [
  {"type": "open-tab", "name": "form", "url": "https://example.com/signup", "nestedActions": [
    {"type": "extract-text", "selector": "body"},
    {"type": "get-source"}
  ]}
]}
\`\`\`

### Step 2: Fill the form — type into inputs, click checkboxes, select dropdowns
\`\`\`json
{"toolId": "web", "operation": "interactive", "stealthLevel": "maximum", "actions": [
  {"type": "open-tab", "name": "form", "nestedActions": [
    {"type": "type", "selector": "#name", "text": "John Doe"},
    {"type": "type", "selector": "#email", "text": "john@example.com"},
    {"type": "select", "selector": "#country", "value": "US"},
    {"type": "click", "selector": "input[name='agree']"},
    {"type": "type", "selector": "#phone", "text": "+1234567890"}
  ]}
]}
\`\`\`
NOTE: For checkboxes, use attribute selectors like input[name="agree"] or input[value="Option text"] instead of dynamic IDs.
NOTE: click on checkbox/radio returns { checked: true/false } so you can verify the toggle state.

### Step 3: Verify form state before submitting
\`\`\`json
{"toolId": "web", "operation": "interactive", "stealthLevel": "maximum", "actions": [
  {"type": "open-tab", "name": "form", "nestedActions": [
    {"type": "get-field-values", "selectors": ["#name", "#email", "#country", "input[name='agree']"]}
  ]}
]}
\`\`\`
Returns: { fields: { "#name": { value: "John Doe" }, "input[name='agree']": { checked: true } } }

### Step 4: Submit and check result
\`\`\`json
{"toolId": "web", "operation": "interactive", "stealthLevel": "maximum", "actions": [
  {"type": "open-tab", "name": "form", "nestedActions": [
    {"type": "submit", "selector": "button[type='submit']"}
  ]}
]}
\`\`\`
Submit returns: { submitConfirmed: true/false, successMessage: "...", networkResponse: [...], formErrors: [...] }
If submitConfirmed is false, check formErrors for validation messages.
If submit button is disabled, it returns an error — use get-field-values to find unfilled required fields.

## KEY ACTIONS REFERENCE

**evaluate** — Run arbitrary JavaScript in the page. Use for custom logic the other actions can't cover.
\`\`\`json
{"type": "evaluate", "script": "return document.querySelector('#myField').value"}
{"type": "evaluate", "script": "return document.querySelectorAll('.item').length"}
\`\`\`

**select** — Select a dropdown option by value or visible text. Works with native <select> and custom dropdowns.
\`\`\`json
{"type": "select", "selector": "#country", "value": "United States"}
\`\`\`

**get-field-values** — Read current values of multiple form fields at once (inputs, checkboxes, selects).
\`\`\`json
{"type": "get-field-values", "selectors": ["#name", "#email", "input[type='checkbox']", "select#country"]}
\`\`\`

## BOT DETECTION
If blocked (CAPTCHA, access denied), use stealthLevel: "maximum" (visible browser).
    `;
  }

  /**
   * Parse parameters from tool command content
   * @param {string} content - Raw tool command content
   * @returns {Object} Parsed parameters
   */
  parseParameters(content) {
    try {
      // Try JSON first
      if (content.trim().startsWith('{')) {
        return JSON.parse(content);
      }

      // Parse XML-style tags
      const params = {};

      // Extract operation
      const operationMatches = TagParser.extractContent(content, 'operation');
      if (operationMatches.length > 0) {
        params.operation = operationMatches[0].trim();
      }

      // Extract based on operation
      switch (params.operation) {
        case 'search':
          params.query = TagParser.extractContent(content, 'query')[0]?.trim();
          params.engine = TagParser.extractContent(content, 'engine')[0]?.trim() || 'duckduckgo';
          const maxResults = TagParser.extractContent(content, 'max-results')[0]?.trim();
          params.maxResults = maxResults ? parseInt(maxResults, 10) : 10;
          // stealthLevel for search (default standard, use maximum if getting blocked)
          params.stealthLevel = TagParser.extractContent(content, 'stealthLevel')[0]?.trim() || 'standard';
          break;

        case 'fetch':
          params.url = TagParser.extractContent(content, 'url')[0]?.trim();
          const formatStr = TagParser.extractContent(content, 'format')[0]?.trim();
          params.formats = formatStr ? formatStr.split(',').map(f => f.trim()) : ['title', 'text'];
          // stealthLevel for fetch
          params.stealthLevel = TagParser.extractContent(content, 'stealthLevel')[0]?.trim() || 'standard';
          break;

        case 'interactive':
          // Extract stealthLevel (standard = headless, maximum = visible window)
          const stealthLevelStr = TagParser.extractContent(content, 'stealthLevel')[0]?.trim();
          params.stealthLevel = stealthLevelStr || 'standard';

          // Legacy headless parameter - maps to stealthLevel for backwards compatibility
          const headlessStr = TagParser.extractContent(content, 'headless')[0]?.trim();
          if (headlessStr === 'false' && !stealthLevelStr) {
            params.stealthLevel = 'maximum'; // headless:false = maximum stealth
          }
          params.headless = params.stealthLevel === 'standard';

          // Extract humanMode (default true for anti-detection)
          const humanModeStr = TagParser.extractContent(content, 'humanMode')[0]?.trim();
          params.humanMode = humanModeStr !== 'false'; // Default true

          // Extract actions block
          const actionsContent = TagParser.extractContent(content, 'actions')[0];
          if (actionsContent) {
            params.actions = this.parseActions(actionsContent);
          }
          break;

        case 'authenticate':
          // Site ID for credential lookup
          params.siteId = TagParser.extractContent(content, 'site')[0]?.trim() ||
                          TagParser.extractContent(content, 'siteId')[0]?.trim();
          // Optional custom login URL (required for custom sites)
          params.loginUrl = TagParser.extractContent(content, 'loginUrl')[0]?.trim();
          // Optional tab name (to keep open after auth for continued browsing)
          params.tabName = TagParser.extractContent(content, 'tabName')[0]?.trim();
          // stealthLevel - default to 'maximum' for login pages (visible browser)
          params.stealthLevel = TagParser.extractContent(content, 'stealthLevel')[0]?.trim() || 'maximum';
          // Custom selectors - agent can provide these after analyzing the login page
          params.usernameSelector = TagParser.extractContent(content, 'usernameSelector')[0]?.trim();
          params.passwordSelector = TagParser.extractContent(content, 'passwordSelector')[0]?.trim();
          params.submitSelector = TagParser.extractContent(content, 'submitSelector')[0]?.trim();
          // Keep tab open for continued browsing (requires tabName)
          const keepTabOpenStr = TagParser.extractContent(content, 'keepTabOpen')[0]?.trim()?.toLowerCase();
          params.keepTabOpen = keepTabOpenStr === 'true' || keepTabOpenStr === '1';
          break;
      }

      params.rawContent = content.trim();
      return params;

    } catch (error) {
      throw new Error(`Failed to parse web tool parameters: ${error.message}`);
    }
  }

  /**
   * Parse actions from XML content
   * @param {string} content - Actions XML content
   * @returns {Array} Parsed actions
   * @private
   */
  parseActions(content) {
    const actions = [];

    // Parse open-tab actions
    const openTabRegex = /<open-tab[^>]*name="([^"]+)"[^>]*>([\s\S]*?)<\/open-tab>/g;
    let match;

    while ((match = openTabRegex.exec(content)) !== null) {
      const [, name, nestedContent] = match;
      const url = TagParser.extractContent(nestedContent, 'navigate')[0]?.trim();

      actions.push({
        type: 'open-tab',
        name,
        url,
        nestedActions: this.parseNestedActions(nestedContent)
      });
    }

    // Parse other actions (close-tab, switch-tab, list-tabs, etc.)
    const simpleActions = [
      'close-tab', 'switch-tab', 'list-tabs', 'navigate',
      'click', 'type', 'press', 'wait-for', 'screenshot',
      'analyze-screenshot', 'extract-text', 'extract-links',
      'get-source', 'get-console', 'scroll', 'hover', 'mouse-move',
      'wait', 'delay', 'submit', 'evaluate', 'get-field-values', 'select'
    ];

    for (const actionType of simpleActions) {
      const regex = new RegExp(`<${actionType}([^>]*)>([^<]*)<\/${actionType}>`, 'g');
      let actionMatch;

      while ((actionMatch = regex.exec(content)) !== null) {
        const [, attrs, value] = actionMatch;
        const action = { type: actionType };

        // Parse attributes
        const attrRegex = /(\w+(?:-\w+)*)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
          action[attrMatch[1]] = attrMatch[2];
        }

        // Add value if present
        if (value && value.trim()) {
          action.value = value.trim();
        }

        actions.push(action);
      }
    }

    return actions;
  }

  /**
   * Parse nested actions within a tab
   * @param {string} content - Nested actions content
   * @returns {Array} Parsed nested actions
   * @private
   */
  parseNestedActions(content) {
    const actions = [];

    const actionTypes = [
      'navigate', 'click', 'type', 'press', 'wait-for', 'screenshot',
      'analyze-screenshot', 'extract-text', 'extract-links',
      'get-source', 'get-console', 'scroll', 'hover', 'mouse-move',
      'wait', 'delay', 'submit', 'evaluate', 'get-field-values', 'select'
    ];

    for (const actionType of actionTypes) {
      const regex = new RegExp(`<${actionType}([^>]*)>([^<]*)<\/${actionType}>|<${actionType}([^>]*)\/>`, 'g');
      let match;

      while ((match = regex.exec(content)) !== null) {
        const [, attrs1, value, attrs2] = match;
        const attrs = attrs1 || attrs2 || '';
        const action = { type: actionType };

        // Parse attributes
        const attrRegex = /(\w+(?:-\w+)*)="([^"]*)"/g;
        let attrMatch;
        while ((attrMatch = attrRegex.exec(attrs)) !== null) {
          action[attrMatch[1]] = attrMatch[2];
        }

        // Add value if present
        if (value && value.trim()) {
          action.value = value.trim();
        }

        actions.push(action);
      }
    }

    return actions;
  }

  /**
   * Get required parameters based on operation
   * @returns {Array<string>} Array of required parameter names
   */
  getRequiredParameters() {
    return ['operation'];
  }

  /**
   * Custom parameter validation
   * @param {Object} params - Parameters to validate
   * @returns {Object} Validation result
   */
  customValidateParameters(params) {
    const errors = [];

    if (!['search', 'fetch', 'interactive', 'authenticate'].includes(params.operation)) {
      errors.push('operation must be one of: search, fetch, interactive, authenticate');
      return { valid: false, errors };
    }

    switch (params.operation) {
      case 'search':
        if (!params.query) {
          errors.push('query is required for search operation');
        }
        break;

      case 'fetch':
        if (!params.url) {
          errors.push('url is required for fetch operation');
        }
        break;

      case 'interactive':
        if (!params.actions || !Array.isArray(params.actions) || params.actions.length === 0) {
          errors.push('actions array is required for interactive operation');
        }
        break;

      case 'authenticate':
        if (!params.siteId && !params.site) {
          errors.push('site or siteId is required for authenticate operation');
        }
        break;
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
    // Unwrap tag parser format {value, attributes} for all params
    const unwrappedParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (value && typeof value === 'object' && 'value' in value) {
        unwrappedParams[key] = value.value;
      } else {
        unwrappedParams[key] = value;
      }
    }
    params = unwrappedParams;

    const { operation } = params;
    const { agentId } = context;

    // Per-agent config overrides for the web tool (agent.toolConfig.web).
    // Supported knobs:
    //   - defaultStealthLevel — fallback when caller doesn't pass one.
    //   - allowedDomains      — if set, URLs must match.
    //   - blockedDomains      — URLs on these hosts refused.
    const webAgentConfig = this.getEffectiveConfig(context, {});
    const agentDefaultStealth = typeof webAgentConfig.defaultStealthLevel === 'string'
      ? webAgentConfig.defaultStealthLevel
      : null;
    const agentAllowedDomains = Array.isArray(webAgentConfig.allowedDomains) && webAgentConfig.allowedDomains.length > 0
      ? webAgentConfig.allowedDomains.map(d => String(d).toLowerCase())
      : null;
    const agentBlockedDomains = Array.isArray(webAgentConfig.blockedDomains) && webAgentConfig.blockedDomains.length > 0
      ? webAgentConfig.blockedDomains.map(d => String(d).toLowerCase())
      : null;

    // Host-match helper: true when `host` equals `pattern` or is a
    // subdomain of `pattern`. Case-insensitive.
    const _hostMatches = (host, pattern) => {
      const h = String(host || '').toLowerCase();
      const p = String(pattern || '').toLowerCase();
      return h === p || h.endsWith('.' + p);
    };
    const _checkUrl = (url) => {
      if (!url) return null;
      let host;
      try { host = new URL(url).host; } catch { return null; } // non-URL input → skip
      if (agentBlockedDomains && agentBlockedDomains.some(p => _hostMatches(host, p))) {
        return `URL host ${host} is blocked by agent policy`;
      }
      if (agentAllowedDomains && !agentAllowedDomains.some(p => _hostMatches(host, p))) {
        return `URL host ${host} is not in the agent's allowed domains`;
      }
      return null;
    };

    // Gate URL-bearing operations upfront. `interactive` has per-action
    // navigate URLs — those get checked too.
    {
      const urlsToCheck = [];
      if (operation === 'fetch' || operation === 'search') {
        if (params.url) urlsToCheck.push(params.url);
        // `search` typically uses search-engine URLs (ddg, google) that
        // callers don't pass directly, so we don't attempt to check them.
      }
      if (operation === 'interactive' && Array.isArray(params.actions)) {
        for (const a of params.actions) {
          if (a && a.type === 'navigate' && a.url) urlsToCheck.push(a.url);
        }
      }
      for (const u of urlsToCheck) {
        const err = _checkUrl(u);
        if (err) {
          return { success: false, operation, error: err };
        }
      }
    }

    try {
      let result;

      // Fix 1: Compute effective stealth level BEFORE ensuring browser
      // This preserves current browser stealth level instead of defaulting to 'standard'
      // which prevents browser restart when agent forgets to specify stealthLevel after authenticate
      //
      // Precedence: caller's stealthLevel > current browser setting > per-agent
      // default from toolConfig > hard 'standard'.
      const currentBrowserStealth = this.browser?._stealthConfig?.stealthLevel;
      const effectiveStealthLevel = params.stealthLevel
        || currentBrowserStealth
        || agentDefaultStealth
        || 'standard';

      // Ensure browser is initialized with the correct stealth level
      // Note: Each operation also calls ensureBrowser internally, but this pre-check
      // ensures we don't unnecessarily restart the browser
      await this.ensureBrowser({ stealthLevel: effectiveStealthLevel });

      switch (operation) {
        case 'search':
          result = await this.search(params.query, {
            engine: params.engine || 'duckduckgo',
            maxResults: params.maxResults || 10,
            stealthLevel: effectiveStealthLevel,
            agentId
          });
          break;

        case 'fetch':
          result = await this.fetch(params.url, {
            formats: params.formats || ['title', 'text'],
            stealthLevel: effectiveStealthLevel,
            agentId
          });
          break;

        case 'interactive':
          result = await this.interactive(params.actions, {
            stealthLevel: effectiveStealthLevel,
            humanMode: params.humanMode !== false, // Default true for anti-detection
            agentId,
            context
          });
          break;

        case 'authenticate':
          // Accept both 'site' and 'siteId' for flexibility
          const siteId = params.siteId || params.site;
          if (!siteId) {
            throw new Error('site or siteId is required for authenticate operation');
          }
          result = await this.authenticate(siteId, {
            loginUrl: params.loginUrl,
            tabName: params.tabName,
            stealthLevel: params.stealthLevel || 'maximum', // Default maximum for login
            keepTabOpen: params.keepTabOpen || false, // Keep tab open for continued browsing
            agentId,
            context,
            // Custom selectors - agent can provide these after analyzing the login page
            customSelectors: (params.usernameSelector || params.passwordSelector || params.submitSelector) ? {
              username: params.usernameSelector,
              password: params.passwordSelector,
              submit: params.submitSelector
            } : null
          });
          break;

        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

      // Flatten result for easier access (result.title instead of result.result.title)
      // IMPORTANT: Respect the operation's own success flag — don't override it to true
      const operationSuccess = result.success !== undefined ? result.success : true;

      // Surface the FIRST actionable error from nested results so the agent
      // always sees a top-level error/suggestion on failure — not just success:false.
      let surfacedError = result.error;
      let surfacedSuggestion = result.suggestion;
      let surfacedWarning = result.warning;
      if (!surfacedError && !operationSuccess && result.results) {
        for (const tabResult of (Array.isArray(result.results) ? result.results : [])) {
          // Check tab-level error first
          if (tabResult.error && !surfacedError) {
            surfacedError = tabResult.error;
            if (tabResult.suggestion) surfacedSuggestion = tabResult.suggestion;
          }
          // Then check nested action results
          if (tabResult.results && Array.isArray(tabResult.results)) {
            for (const actionResult of tabResult.results) {
              if (actionResult.success === false && actionResult.error && !surfacedError) {
                surfacedError = actionResult.error;
                if (actionResult.suggestion) surfacedSuggestion = actionResult.suggestion;
              }
            }
          }
          if (!surfacedWarning && tabResult.warning) surfacedWarning = tabResult.warning;
        }
      }

      return {
        success: operationSuccess,
        operation,
        toolUsed: 'web',
        // Spread operation-specific data at top level
        data: result,
        // Always surface error/suggestion at top level so agent sees why it failed
        ...(surfacedError && { error: surfacedError }),
        ...(surfacedSuggestion && { suggestion: surfacedSuggestion }),
        ...(surfacedWarning && { warning: surfacedWarning }),
        // Also keep common properties at top level for convenience
        ...(result.title !== undefined && { title: result.title }),
        ...(result.text !== undefined && { text: result.text }),
        ...(result.url !== undefined && { url: result.url }),
        ...(result.results !== undefined && { results: result.results }),
        ...(result.resultsCount !== undefined && { resultsCount: result.resultsCount }),
        ...(result.httpStatus !== undefined && { httpStatus: result.httpStatus }),
        ...(result.stealthNotice !== undefined && { stealthNotice: result.stealthNotice }),
        // Surface diagnostics (page-level observations separate from tool success)
        // Check both top-level and nested results for diagnostics
        ...((() => {
          const diag = result.diagnostics ? { ...result.diagnostics } : {};
          if (result.results) {
            for (const tabResult of (Array.isArray(result.results) ? result.results : [])) {
              if (tabResult.diagnostics) Object.assign(diag, tabResult.diagnostics);
            }
          }
          return Object.keys(diag).length > 0 ? { diagnostics: diag } : {};
        })()),
        ...(result.notice && { notice: result.notice }),
        // Legacy: also surface flat arrays for backwards compatibility
        ...(result.jsErrors?.length > 0 && { jsErrors: result.jsErrors }),
        ...(result.networkFailures?.length > 0 && { networkFailures: result.networkFailures }),
        ...(result.httpErrors?.length > 0 && { httpErrors: result.httpErrors })
      };

    } catch (error) {
      this.logger?.error('Web tool execution failed', {
        operation,
        error: error.message,
        agentId
      });

      // Fix 3: Provide better error context for common browser issues
      let enhancedError = error.message;
      let suggestion = null;

      // Detect browser connection issues
      if (error.message.includes('Connection closed') ||
          error.message.includes('Target closed') ||
          error.message.includes('Protocol error') ||
          error.message.includes('Session closed')) {
        enhancedError = `Browser connection lost: ${error.message}`;
        suggestion = 'The browser or tab was closed unexpectedly. Try the operation again.';
      }

      // Detect stealth level mismatch errors (from Fix 2)
      if (error.message.includes('Cannot change stealth level')) {
        suggestion = 'Use the same stealthLevel as your authenticated session, or close tabs first.';
      }

      // Detect tab not found errors
      if (error.message.includes('not found for agent')) {
        enhancedError = `Tab lost: ${error.message}`;
        suggestion = 'The tab may have been closed or the browser was restarted. Re-authenticate and try again.';
      }

      // Detect navigation timeout
      if (error.message.includes('Navigation timeout') || error.message.includes('Timeout')) {
        suggestion = 'The page took too long to load. Check your internet connection or try again.';
      }

      // Detect bot detection / CAPTCHA failures — may be stealth-related
      if (error.message.includes('CAPTCHA') || error.message.includes('blocked') ||
          error.message.includes('403') || error.message.includes('Access Denied')) {
        const currentLevel = this.browser?._stealthConfig?.stealthLevel || 'unknown';
        if (currentLevel === 'standard') {
          suggestion = (suggestion ? suggestion + ' ' : '') +
            `Currently running at stealth level 'standard' (headless). This site may require stealthLevel: 'maximum' (visible browser) to bypass bot detection. Close open tabs first if needed.`;
        }
      }

      // Include current stealth context so agent can make informed decisions
      const currentStealthLevel = this.browser?._stealthConfig?.stealthLevel || null;

      return {
        success: false,
        operation,
        error: enhancedError,
        ...(suggestion && { suggestion }),
        ...(currentStealthLevel && { currentStealthLevel }),
        toolUsed: 'web'
      };
    }
  }

  /**
   * Ensure browser is initialized
   * @private
   */
  /**
   * Ensure browser is running with the specified stealth level
   * @param {Object} options - Browser options
   * @param {string} options.stealthLevel - 'standard' (headless) or 'maximum' (visible window)
   */
  async ensureBrowser(options = {}) {
    const { stealthLevel = 'standard' } = options;
    const requestedLevel = stealthLevel.toLowerCase();

    // Check if browser exists and matches requested stealth level
    if (this.browser && this.browser.isConnected()) {
      const currentLevel = this.browser._stealthConfig?.stealthLevel || 'standard';

      // If stealth level matches, reuse browser
      if (currentLevel === requestedLevel) {
        return;
      }

      // Stealth level changed - check for active tabs before restarting
      // Fix 2: Warn/block stealth level change when there are active tabs
      let totalActiveTabs = 0;
      const agentsWithTabs = [];
      for (const [agentId, tabsMap] of this.agentTabs.entries()) {
        if (tabsMap.size > 0) {
          totalActiveTabs += tabsMap.size;
          agentsWithTabs.push({ agentId, tabCount: tabsMap.size, tabs: Array.from(tabsMap.keys()) });
        }
      }

      if (totalActiveTabs > 0) {
        // Throw an error with clear context about what would happen
        const tabDetails = agentsWithTabs.map(a => `${a.agentId}: [${a.tabs.join(', ')}]`).join('; ');
        throw new Error(
          `Cannot change stealth level from '${currentLevel}' to '${requestedLevel}': ` +
          `${totalActiveTabs} active tab(s) would be destroyed. ` +
          `Active tabs: ${tabDetails}. ` +
          `Either close tabs first with close-tab action, or use stealthLevel: "${currentLevel}" to preserve session.`
        );
      }

      this.logger?.info('[WebTool] Stealth level changed, restarting browser (no active tabs)', {
        from: currentLevel,
        to: requestedLevel
      });

      await this.closeBrowser();
    }

    if (this.browserInitializing) {
      // Wait for browser to finish initializing
      while (this.browserInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      // After waiting, check if the initialized browser matches our stealth level
      if (this.browser && this.browser._stealthConfig?.stealthLevel === requestedLevel) {
        return;
      }
      // Otherwise, close and reinitialize
      if (this.browser) {
        await this.closeBrowser();
      }
    }

    this.browserInitializing = true;

    try {
      this.logger?.info('[WebTool] Initializing stealth browser', {
        stealthLevel: requestedLevel,
        headless: requestedLevel === 'standard' ? 'new' : false
      });

      // Use stealth browser with specified level
      this.browser = await createStealthBrowser({
        stealthLevel: requestedLevel,
        logger: this.logger
      });

      this.logger?.info('[WebTool] Stealth browser initialized successfully', {
        stealthLevel: requestedLevel
      });

    } catch (error) {
      this.logger?.error('[WebTool] Failed to initialize browser', { error: error.message });
      throw new Error(`Browser initialization failed: ${error.message}`);
    } finally {
      this.browserInitializing = false;
    }
  }

  /**
   * Create a stealth page with human-like cursor
   * @param {Object} options - Page options
   * @param {boolean} options.humanMode - Enable human-like behavior
   * @returns {Promise<Object>} Object with page and optional cursor
   */
  async createPage(options = {}) {
    const { humanMode = false } = options;

    // Note: ensureBrowser() is NOT called here because the caller should have already
    // called it with the appropriate stealth level. This prevents accidentally
    // resetting the browser to 'standard' stealth when 'maximum' is needed.
    if (!this.browser || !this.browser.isConnected()) {
      throw new Error(
        'Browser not initialized or connection lost. This can happen if another operation ' +
        'changed the stealth level and restarted the browser. Retry the operation.'
      );
    }

    const page = await createStealthPage(this.browser, {
      logger: this.logger
    });

    let cursor = null;
    if (humanMode) {
      cursor = createHumanCursor(page);
      this.logger?.info('[WebTool] Human-like cursor enabled for page');
    }

    return { page, cursor };
  }

  /**
   * Search the web using a known search engine
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @returns {Promise<Object>} Search results
   */
  async search(query, options = {}) {
    const { engine = 'duckduckgo', maxResults = 10, agentId, humanMode = true, stealthLevel = 'standard' } = options;

    // Validate query
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      throw new Error('Search query is required and must be a non-empty string');
    }

    const searchEngine = this.searchEngines.find(e => e.name === engine);
    if (!searchEngine) {
      throw new Error(`Unknown search engine: ${engine}. Available: ${this.searchEngines.map(e => e.name).join(', ')}`);
    }

    this.logger?.info('[WebTool] Performing web search', { query, engine, agentId, humanMode, stealthLevel });

    // Reuse existing browser if running (preserve interactive/auth sessions)
    let stealthDowngradeNotice = null;
    if (this.browser && this.browser.isConnected()) {
      const currentLevel = this.browser._stealthConfig?.stealthLevel || 'standard';
      if (currentLevel !== stealthLevel) {
        stealthDowngradeNotice = `Note: Running at stealth level '${currentLevel}' instead of requested '${stealthLevel}' to preserve active browser sessions. If this operation fails due to bot detection, close open tabs first and retry with stealthLevel: '${stealthLevel}'.`;
        this.logger?.info('[WebTool] search: reusing existing browser', { requested: stealthLevel, actual: currentLevel });
      }
    } else {
      await this.ensureBrowser({ stealthLevel });
    }

    // Create stealth page with optional human-like cursor
    const { page, cursor } = await this.createPage({ humanMode });

    try {
      // Navigate to search engine
      const searchUrl = `${searchEngine.url}${encodeURIComponent(query)}`;
      const searchNavResponse = await page.goto(searchUrl, {
        waitUntil: BROWSER_CONFIG.WAIT_UNTIL,
        timeout: this.DEFAULT_TIMEOUT
      });
      const searchHttpStatus = searchNavResponse ? searchNavResponse.status() : null;
      // NOTE: deliberately NOT using WebTool._resultForHttpStatus here.
      // The helper's 401/402/403 → success:true behavior is meant for
      // page navigation where auth/paywall content is genuinely useful
      // to the agent. A search engine returning 4xx means it's blocking
      // us — that should always be a hard failure with a stealth-level
      // suggestion, not a "useful page" surface. See
      // docs/WEBTOOL_4XX_SEMANTICS.md ("page-oriented" caveat).
      if (searchHttpStatus && searchHttpStatus >= 400) {
        return {
          success: false,
          query,
          engine,
          httpStatus: searchHttpStatus,
          error: `Search engine returned HTTP ${searchHttpStatus}. The search engine may be blocking automated requests.`,
          suggestion: 'Try a different search engine or increase stealth level.'
        };
      }

      // Human-like wait after navigation
      if (humanMode) {
        await humanWait('navigation');
      }

      // Wait for results — try each selector with a shorter timeout, proceed even if none match
      const waitSelectors = searchEngine.waitSelector.split(',').map(s => s.trim());
      let waitResolved = false;
      for (const ws of waitSelectors) {
        try {
          await page.waitForSelector(ws, { timeout: 10000 });
          waitResolved = true;
          break;
        } catch {
          // Try next selector
        }
      }
      if (!waitResolved) {
        // Last resort: wait a bit and try to extract whatever is on the page
        this.logger?.warn('[WebTool] No wait selector matched, attempting extraction anyway', { engine });
        await new Promise(r => setTimeout(r, 3000));
      }

      // Extract results
      const results = await page.evaluate((selector, max) => {
        const links = Array.from(document.querySelectorAll(selector));
        return links.slice(0, max).map(link => ({
          url: link.href,
          title: link.textContent.trim(),
          description: link.closest('.g, .b_algo, .result')?.textContent.trim() || ''
        })).filter(result => result.url && result.url.startsWith('http'));
      }, searchEngine.resultsSelector, maxResults);

      this.logger?.info('[WebTool] Search completed', { resultsCount: results.length, agentId });

      const searchResult = {
        success: true,
        query,
        engine,
        resultsCount: results.length,
        results
      };

      if (stealthDowngradeNotice) {
        searchResult.stealthNotice = stealthDowngradeNotice;
      }

      // Warn when 0 results — may indicate selector mismatch or CAPTCHA
      if (results.length === 0) {
        searchResult.warning = 'Search returned 0 results. This may indicate: (1) no matching results exist, (2) the search engine blocked the request (CAPTCHA), or (3) the page layout changed and results could not be extracted.';
        // Grab page title for context
        try { searchResult.pageTitle = await page.title(); } catch {}
      }

      return searchResult;

    } finally {
      try { await page.close(); } catch {}
    }
  }

  /**
   * Fetch web content in various formats
   * @param {string} url - URL to fetch
   * @param {Object} options - Fetch options
   * @returns {Promise<Object>} Fetched content
   */
  async fetch(url, options = {}) {
    const { formats = ['title', 'text'], agentId, stealthLevel = 'standard' } = options;

    // Validate URL before doing anything expensive
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
      return { success: false, error: 'URL is required for fetch operation' };
    }
    try {
      new URL(url);
    } catch {
      return { success: false, error: `Invalid URL format: "${url}". Must include protocol (e.g. https://example.com)` };
    }

    // Reuse existing browser if running (preserve interactive/auth sessions)
    let stealthDowngradeNotice = null;
    if (this.browser && this.browser.isConnected()) {
      const currentLevel = this.browser._stealthConfig?.stealthLevel || 'standard';
      if (currentLevel !== stealthLevel) {
        stealthDowngradeNotice = `Note: Running at stealth level '${currentLevel}' instead of requested '${stealthLevel}' to preserve active browser sessions. If this operation fails due to bot detection, close open tabs first and retry with stealthLevel: '${stealthLevel}'.`;
        this.logger?.info('[WebTool] fetch: reusing existing browser', { requested: stealthLevel, actual: currentLevel });
      }
    } else {
      await this.ensureBrowser({ stealthLevel });
    }

    this.logger?.info('Fetching web content', { url, formats, agentId, stealthLevel });

    // Create temporary page
    const page = await this.browser.newPage();

    try {
      // Listen for console messages if requested
      const consoleMessages = [];
      if (formats.includes('console')) {
        page.on('console', msg => {
          consoleMessages.push({
            type: msg.type(),
            text: msg.text()
          });
        });
      }

      // Navigate to URL and capture HTTP response
      const fetchResponse = await page.goto(url, { waitUntil: 'networkidle2', timeout: this.DEFAULT_TIMEOUT });
      const fetchStatus = fetchResponse ? fetchResponse.status() : null;

      const fetchHttpError = WebTool._resultForHttpStatus(fetchStatus, { context: 'Page' });
      if (fetchHttpError) {
        const errorResult = { ...fetchHttpError, url };
        // Title is genuinely useful context for the agent — 401/403/404
        // pages frequently include "Sign in", "Subscribe", or "Not found"
        // in the title and that's exactly what the agent needs to read.
        try { errorResult.title = await page.title(); } catch { /* page may be torn down */ }
        // Don't close page here — finally block handles it
        return errorResult;
      }

      const result = { url, httpStatus: fetchStatus };

      // Extract requested formats
      for (const format of formats) {
        switch (format) {
          case 'title':
            result.title = await page.title();
            break;

          case 'text':
            result.text = await page.evaluate(() => document.body.innerText);
            break;

          case 'links':
            result.links = await page.evaluate(() => {
              return Array.from(document.querySelectorAll('a[href]')).map(a => ({
                href: a.href,
                text: a.textContent.trim()
              }));
            });
            break;

          case 'html':
            result.html = await page.content();
            break;

          case 'console':
            result.consoleMessages = consoleMessages;
            break;
        }
      }

      this.logger?.info('Fetch completed', { url, formats, agentId });

      const fetchResult = {
        success: true,
        ...result
      };
      if (stealthDowngradeNotice) {
        fetchResult.stealthNotice = stealthDowngradeNotice;
      }
      return fetchResult;

    } finally {
      try { await page.close(); } catch {}
    }
  }

  /**
   * Interactive browser automation with command chaining
   * @param {Array} actions - Array of actions to execute
   * @param {Object} options - Options
   * @returns {Promise<Object>} Results of all actions
   */
  async interactive(actions, options = {}) {
    const { stealthLevel = 'standard', agentId, context, humanMode = true } = options;

    // Derive headless from stealthLevel (standard = headless, maximum = visible)
    const headless = stealthLevel === 'standard';

    // Ensure browser with specified stealth level
    await this.ensureBrowser({ stealthLevel });

    this.logger?.info('[WebTool] Starting interactive session', {
      actionsCount: actions.length,
      stealthLevel,
      humanMode,
      agentId
    });

    const results = [];

    // Initialize agent tabs if not exists
    if (!this.agentTabs.has(agentId)) {
      this.agentTabs.set(agentId, new Map());
    }

    const agentTabsMap = this.agentTabs.get(agentId);

    for (const action of actions) {
      // Accept both "type" and "action" as the action discriminator for resilience
      const actionType = action.type || action.action;
      try {
        let actionResult;

        switch (actionType) {
          case 'open-tab':
            actionResult = await this.openTab(
              agentId, action.name, action.url, headless,
              action.nestedActions || action.actions, context, { humanMode }
            );
            break;

          case 'close-tab':
            actionResult = await this.closeTab(agentId, action.name);
            break;

          case 'switch-tab':
            actionResult = await this.switchTab(agentId, action.name);
            break;

          case 'list-tabs':
            actionResult = await this.listTabs(agentId);
            break;

          default:
            // For actions that need a tab context, we need to specify which tab
            // For now, we'll skip these at the top level
            actionResult = {
              success: false,
              error: `Action ${actionType} must be executed within a tab context (use open-tab with nestedActions)`
            };
        }

        results.push({
          action: actionType,
          ...actionResult
        });

      } catch (error) {
        this.logger?.error('Action failed', {
          action: actionType,
          error: error.message,
          agentId
        });

        results.push({
          action: actionType,
          success: false,
          error: error.message
        });
      }
    }

    return {
      success: results.every(r => r.success !== false),
      actionsExecuted: results.length,
      results
    };
  }

  /**
   * Authenticate to a website using stored credentials
   * The agent never sees the actual credentials - they are retrieved from the vault
   *
   * @param {string} siteId - Site identifier (e.g., 'linkedin', 'github')
   * @param {Object} options - Authentication options
   * @param {string} options.loginUrl - Custom login URL (optional)
   * @param {string} options.tabName - Tab name to reuse (optional)
   * @param {string} options.agentId - Agent identifier
   * @param {Object} options.context - Execution context
   * @returns {Promise<Object>} Authentication result (success/failure, no credentials exposed)
   */
  async authenticate(siteId, options = {}) {
    const { loginUrl, tabName, agentId, context = {}, stealthLevel = 'maximum', customSelectors, keepTabOpen = false } = options;

    // Validate siteId
    if (!siteId || typeof siteId !== 'string') {
      return {
        success: false,
        error: 'siteId is required and must be a string (e.g., "linkedin", "github")',
        requiresCredentials: false
      };
    }

    const normalizedSiteId = siteId.toLowerCase().trim();

    this.logger?.info('[WebTool] Authentication requested', {
      siteId: normalizedSiteId,
      agentId,
      stealthLevel
    });

    // Get credential vault
    const vault = getCredentialVault(this.logger);
    await vault.initialize();

    // Check if we have stored credentials
    let credentials = vault.getCredentials(normalizedSiteId);

    // If no credentials stored, we need to request them from the user
    if (!credentials) {
      // Check if we have a webSocketManager to request credentials
      const wsManager = global.loxiaWebServer;

      this.logger?.info('[WebTool] No stored credentials, checking for WebSocket manager', {
        hasWsManager: !!wsManager,
        sessionId: context?.sessionId,
        siteId: normalizedSiteId
      });

      if (!wsManager) {
        this.logger?.warn('[WebTool] No WebSocket manager available - cannot request credentials from UI');
        return {
          success: false,
          error: `No credentials stored for ${normalizedSiteId}. Please add credentials in Settings > Saved Logins.`,
          requiresCredentials: true,
          siteId: normalizedSiteId
        };
      }

      // Create a credential request
      const { requestInfo, promise } = vault.createCredentialRequest(normalizedSiteId, {
        loginUrl,
        agentId
      });

      this.logger?.info('[WebTool] Broadcasting credential request to UI', {
        requestId: requestInfo.requestId,
        siteId: requestInfo.siteId,
        sessionId: context?.sessionId
      });

      // Block scheduling while waiting for user to enter credentials.
      // We set awaitingUserInput (checked by agentActivityService) instead of
      // changing status to PAUSED, so the agent stays visible to other agents.
      const agentPool = context?.agentPool;
      let agent = null;

      if (agentPool && agentId) {
        try {
          agent = await agentPool.getAgent(agentId);
          if (agent) {
            agent.awaitingUserInput = {
              type: 'credentials',
              siteId: normalizedSiteId,
              requestId: requestInfo.requestId,
              startedAt: new Date().toISOString()
            };
            await agentPool.persistAgentState(agentId);
            this.logger?.info('[WebTool] Agent awaiting credentials (scheduling blocked)', {
              agentId,
              siteId: normalizedSiteId
            });

            // Notify UI that agent is paused awaiting user input
            if (wsManager?.broadcastToSession) {
              wsManager.broadcastToSession(context.sessionId, {
                type: 'agent_awaiting_input',
                data: {
                  agentId,
                  inputType: 'credentials',
                  siteId: normalizedSiteId,
                  message: `Waiting for ${normalizedSiteId} credentials...`,
                  timestamp: new Date().toISOString()
                }
              });
            }
          }
        } catch (pauseError) {
          this.logger?.warn('[WebTool] Failed to pause agent (non-fatal):', pauseError.message);
        }
      }

      // Broadcast credential request to UI
      wsManager.broadcastCredentialRequest(requestInfo, context.sessionId);

      // Wait for credentials to be submitted (or timeout/cancel)
      try {
        const result = await promise;
        credentials = {
          ...vault.getCredentials(normalizedSiteId),
          ...result.credentials
        };
      } catch (error) {
        // RESUME the agent even on error
        if (agent && agentPool) {
          try {
            delete agent.awaitingUserInput;
            await agentPool.persistAgentState(agentId);
            this.logger?.info('[WebTool] Agent resumed after credential error', { agentId });

            // Notify UI that agent is no longer waiting
            if (wsManager?.broadcastToSession) {
              wsManager.broadcastToSession(context.sessionId, {
                type: 'agent_input_complete',
                data: {
                  agentId,
                  inputType: 'credentials',
                  success: false,
                  reason: error.message.includes('cancelled') ? 'cancelled' : 'timeout',
                  timestamp: new Date().toISOString()
                }
              });
            }
          } catch (resumeError) {
            this.logger?.warn('[WebTool] Failed to resume agent (non-fatal):', resumeError.message);
          }
        }

        return {
          success: false,
          error: error.message,
          cancelled: error.message.includes('cancelled'),
          timedOut: error.message.includes('timed out'),
          siteId: normalizedSiteId
        };
      }

      // RESUME the agent after credentials received
      if (agent && agentPool) {
        try {
          delete agent.awaitingUserInput;
          await agentPool.persistAgentState(agentId);
          this.logger?.info('[WebTool] Agent resumed after credentials received', { agentId });

          // Notify UI that agent is no longer waiting
          if (wsManager?.broadcastToSession) {
            wsManager.broadcastToSession(context.sessionId, {
              type: 'agent_input_complete',
              data: {
                agentId,
                inputType: 'credentials',
                success: true,
                timestamp: new Date().toISOString()
              }
            });
          }
        } catch (resumeError) {
          this.logger?.warn('[WebTool] Failed to resume agent (non-fatal):', resumeError.message);
        }
      }
    }

    // Get site configuration
    const knownSite = KNOWN_SITES[normalizedSiteId] || {};
    const actualLoginUrl = loginUrl || credentials.loginUrl || knownSite.loginUrl;

    if (!actualLoginUrl) {
      return {
        success: false,
        error: `No login URL configured for ${normalizedSiteId}. Provide loginUrl parameter.`,
        siteId: normalizedSiteId
      };
    }

    // Resolve selectors - priority: customSelectors > credentials.selectors > knownSite.selectors
    const selectors = customSelectors && (customSelectors.username || customSelectors.password)
      ? {
          username: customSelectors.username,
          password: customSelectors.password,
          submit: customSelectors.submit || 'button[type="submit"], input[type="submit"]',
          loginSuccess: knownSite.selectors?.loginSuccess,
          loginError: knownSite.selectors?.loginError
        }
      : (credentials.selectors || knownSite.selectors);

    if (!selectors || !selectors.username || !selectors.password) {
      return {
        success: false,
        error: `No login form selectors for ${normalizedSiteId}. Provide usernameSelector and passwordSelector parameters, or use a supported site (linkedin, github, google, twitter).`,
        siteId: normalizedSiteId
      };
    }

    this.logger?.info('[WebTool] Using selectors for authentication', {
      siteId: normalizedSiteId,
      usernameSelector: selectors.username,
      passwordSelector: selectors.password,
      submitSelector: selectors.submit,
      isCustom: !!customSelectors
    });

    // Check for existing session cookies
    const existingSession = vault.getSession(normalizedSiteId);

    // Reuse existing browser if one is running (preserve interactive sessions).
    // Only use the requested stealthLevel if no browser exists yet.
    let stealthDowngradeNotice = null;
    if (this.browser && this.browser.isConnected()) {
      const currentLevel = this.browser._stealthConfig?.stealthLevel || 'standard';
      if (currentLevel !== stealthLevel) {
        stealthDowngradeNotice = `Note: Authenticating at stealth level '${currentLevel}' instead of '${stealthLevel}' to preserve active browser sessions. If login fails due to bot detection, close open tabs first and retry with stealthLevel: '${stealthLevel}'.`;
        this.logger?.info('[WebTool] authenticate: reusing existing browser', { requested: stealthLevel, actual: currentLevel });
      }
    } else {
      await this.ensureBrowser({ stealthLevel });
    }
    const { page, cursor } = await this.createPage({ humanMode: true });

    try {
      // If we have existing session cookies, try them first
      if (existingSession && existingSession.cookies) {
        this.logger?.info('[WebTool] Attempting session restore', { siteId: normalizedSiteId });

        await page.setCookie(...existingSession.cookies);
        await page.goto(actualLoginUrl, {
          waitUntil: BROWSER_CONFIG.WAIT_UNTIL,
          timeout: this.DEFAULT_TIMEOUT
        });
        await humanWait('navigation');

        // Check if we're already logged in
        if (selectors.loginSuccess) {
          try {
            await page.waitForSelector(selectors.loginSuccess, { timeout: 5000 });
            this.logger?.info('[WebTool] Session restore successful', { siteId: normalizedSiteId });

            await page.close();
            return {
              success: true,
              message: `Already logged into ${credentials.name || normalizedSiteId} (session restored)`,
              siteId: normalizedSiteId,
              method: 'session_restore',
              ...(stealthDowngradeNotice && { stealthNotice: stealthDowngradeNotice })
            };
          } catch {
            // Session invalid, need to login
            this.logger?.info('[WebTool] Session expired, performing fresh login', { siteId: normalizedSiteId });
          }
        }
      } else {
        // Navigate to login page
        await page.goto(actualLoginUrl, {
          waitUntil: BROWSER_CONFIG.WAIT_UNTIL,
          timeout: this.DEFAULT_TIMEOUT
        });
        await humanWait('navigation');
      }

      // Wait for login form
      await page.waitForSelector(selectors.username, { timeout: this.DEFAULT_TIMEOUT });

      // Fill in credentials with human-like typing
      await humanType(page, selectors.username, credentials.username, {
        clearFirst: true,
        simulateTypos: false
      });
      await humanWait('action');

      // Handle multi-step login (e.g., Google)
      if (knownSite.multiStep && selectors.submitEmail) {
        await humanSubmit(page, selectors.submitEmail, { cursor, waitForNavigation: true });
        await humanWait('navigation');
        await page.waitForSelector(selectors.password, { timeout: this.DEFAULT_TIMEOUT });
      }

      // Enter password
      await humanType(page, selectors.password, credentials.password, {
        clearFirst: true,
        simulateTypos: false
      });
      await humanWait('action');

      // Submit the form
      const submitSelector = selectors.submitPassword || selectors.submit;
      await humanSubmit(page, submitSelector, { cursor, waitForNavigation: true });
      await humanWait('afterSubmit');

      // Check for success or error
      let loginSuccess = false;
      let loginError = null;

      // Wait for either success or error indicator
      try {
        if (selectors.loginSuccess) {
          await page.waitForSelector(selectors.loginSuccess, { timeout: 15000 });
          loginSuccess = true;
        } else {
          // No explicit success selector — check if URL changed (common indicator of successful login)
          await humanWait('navigation');
          const postLoginUrl = page.url();
          const urlChanged = postLoginUrl !== actualLoginUrl;

          // Also check if error indicator appeared
          let errorVisible = false;
          if (selectors.loginError) {
            try {
              const errorEl = await page.$(selectors.loginError);
              if (errorEl) {
                errorVisible = true;
                loginError = await page.evaluate(el => el.textContent?.trim(), errorEl);
              }
            } catch {}
          }

          if (errorVisible) {
            loginSuccess = false;
          } else if (urlChanged) {
            loginSuccess = true;
          } else {
            // URL didn't change and no error selector found — ambiguous
            loginSuccess = false;
            loginError = 'Login result is ambiguous: no success indicator found and URL did not change after submit. The login may have failed silently. Provide a loginSuccess selector for reliable detection.';
          }
        }
      } catch (waitErr) {
        // Success selector wait timed out — login likely failed
        loginSuccess = false;
        loginError = `Login success indicator "${selectors.loginSuccess}" not found within 15s.`;

        // Also check for explicit error message
        if (selectors.loginError) {
          try {
            const errorElement = await page.$(selectors.loginError);
            if (errorElement) {
              const extractedError = await page.evaluate(el => el.textContent?.trim(), errorElement);
              if (extractedError) {
                loginError = `Login failed: ${extractedError}`;
              }
            }
          } catch (errExtract) {
            this.logger?.warn('[WebTool] Error extraction failed', { error: errExtract.message });
          }
        }
      }

      if (loginSuccess) {
        // Save session cookies for future use
        const cookies = await page.cookies();
        await vault.saveSession(normalizedSiteId, cookies);

        this.logger?.info('[WebTool] Login successful', { siteId: normalizedSiteId });

        // Optionally keep the tab open for continued browsing
        if (keepTabOpen && tabName && agentId) {
          // Initialize agent tabs if needed
          if (!this.agentTabs.has(agentId)) {
            this.agentTabs.set(agentId, new Map());
          }
          const agentTabsMap = this.agentTabs.get(agentId);

          // Store the authenticated page as a named tab
          agentTabsMap.set(tabName, {
            page,
            url: actualLoginUrl,
            lastActivity: Date.now(),
            headless: stealthLevel === 'standard',
            consoleMessages: [],
            name: tabName,
            humanMode: true,
            authenticated: true,
            siteId: normalizedSiteId
          });

          this.logger?.info('[WebTool] Tab kept open after authentication', {
            tabName,
            siteId: normalizedSiteId
          });

          return {
            success: true,
            message: `Successfully logged into ${credentials.name || normalizedSiteId}. Tab '${tabName}' is ready for continued browsing.`,
            siteId: normalizedSiteId,
            method: 'credentials',
            tabName,
            tabKeptOpen: true,
            ...(stealthDowngradeNotice && { stealthNotice: stealthDowngradeNotice })
          };
        }

        await page.close();
        return {
          success: true,
          message: `Successfully logged into ${credentials.name || normalizedSiteId}`,
          siteId: normalizedSiteId,
          method: 'credentials',
          ...(stealthDowngradeNotice && { stealthNotice: stealthDowngradeNotice })
        };
      } else {
        await page.close();
        return {
          success: false,
          error: loginError || `Login failed for ${normalizedSiteId}`,
          siteId: normalizedSiteId
        };
      }

    } catch (error) {
      await page.close();
      this.logger?.error('[WebTool] Authentication failed', {
        siteId: normalizedSiteId,
        error: error.message
      });

      return {
        success: false,
        error: `Authentication failed: ${error.message}`,
        siteId: normalizedSiteId
      };
    }
  }

  /**
   * Open a new tab with nested actions
   * @param {string} agentId - Agent identifier
   * @param {string} tabName - Unique tab name
   * @param {string} url - Initial URL
   * @param {boolean} headless - Headless mode
   * @param {Array} nestedActions - Actions to execute in this tab
   * @param {Object} context - Execution context
   * @param {Object} options - Additional options
   * @param {boolean} options.humanMode - Enable human-like behavior
   * @returns {Promise<Object>} Result
   */

  /**
   * Deduplicate an array of error strings, returning "error x N" for repeats.
   * Keeps output compact for the agent.
   * @param {string[]} errors - Array of error message strings
   * @returns {string[]} Deduplicated array with counts
   * @private
   */
  static _dedupeErrors(errors) {
    if (!errors || errors.length === 0) return [];
    const counts = new Map();
    for (const e of errors) {
      counts.set(e, (counts.get(e) || 0) + 1);
    }
    return Array.from(counts.entries()).map(([msg, count]) =>
      count > 1 ? `${msg} (x${count})` : msg
    );
  }

  /**
   * Build the canonical result-envelope fragment for an HTTP error
   * status from page navigation. Path C semantics — see
   * docs/WEBTOOL_4XX_SEMANTICS.md for the reasoning.
   *
   *   401 / 402 / 403  → success: true  (auth / paywall — body may
   *                                       contain useful content for
   *                                       the agent to read)
   *   404 / 410        → success: false (resource doesn't exist)
   *   429              → success: false + retry suggestion
   *   5xx              → success: false (server problem)
   *   other 4xx        → success: false (client error)
   *
   * Always includes `httpStatus` so callers / consumers can detect
   * the underlying code regardless of the `success` flag.
   *
   * Returns `null` for status codes below 400, so callers can do:
   *
   *     const httpError = WebTool._resultForHttpStatus(status);
   *     if (httpError) return { ...httpError, ...callerFields };
   *
   * NB: this is intentionally page-oriented. The `search` operation
   * does NOT use this helper because a 401/403 from a search engine
   * means the engine is blocking us, not serving useful auth content —
   * those callsites stay on plain "any 4xx = failure" semantics.
   *
   * @param {number} status — HTTP status code.
   * @param {object} [opts]
   * @param {string} [opts.context='Page'] — Capitalised noun used in the
   *   message, e.g. 'Tab', 'Page'.
   * @returns {object|null}
   * @private
   */
  static _resultForHttpStatus(status, { context = 'Page' } = {}) {
    if (!status || status < 400) return null;

    const isAuthOrPaywall = status === 401 || status === 402 || status === 403;
    const isNotFound      = status === 404 || status === 410;
    const isRateLimit     = status === 429;
    const isServerError   = status >= 500 && status < 600;

    const description = isServerError
      ? 'server error'
      : isNotFound
        ? 'page not found'
        : status === 401
          ? 'authentication required'
          : status === 402
            ? 'payment required'
            : status === 403
              ? 'access forbidden'
              : isRateLimit
                ? 'rate limited'
                : 'client error';

    if (isAuthOrPaywall) {
      return {
        success:    true,
        httpStatus: status,
        diagnostic: `${context} returned HTTP ${status} (${description})`,
        warning:    `HTTP ${status} — ${description}. The response body may still contain useful content (login form, paywall notice, etc.).`,
      };
    }

    const errorMessage = `${context} returned HTTP ${status} — ${description}.`;
    return {
      success:    false,
      httpStatus: status,
      error:      errorMessage,
      ...(isRateLimit
        ? { suggestion: 'Wait a few seconds and retry, or reduce request frequency.' }
        : {}),
    };
  }

  async openTab(agentId, tabName, url, headless, nestedActions = [], context = {}, options = {}) {
    const { humanMode = true } = options; // Default to human mode

    // Initialize agent tabs if not exists
    if (!this.agentTabs.has(agentId)) {
      this.agentTabs.set(agentId, new Map());
    }

    const agentTabsMap = this.agentTabs.get(agentId);

    // If tab already exists, reuse it — execute nested actions on the existing page
    if (agentTabsMap.has(tabName)) {
      const existingTab = agentTabsMap.get(tabName);
      existingTab.lastActivity = Date.now();
      const results = [];

      if (url) {
        const reuseNavResponse = await existingTab.page.goto(url, {
          waitUntil: BROWSER_CONFIG.WAIT_UNTIL,
          timeout: BROWSER_CONFIG.DEFAULT_TIMEOUT_MS
        });
        const reuseNavStatus = reuseNavResponse ? reuseNavResponse.status() : null;
        if (humanMode) await humanWait('navigation');
        const reuseHttpError = WebTool._resultForHttpStatus(reuseNavStatus, { context: 'Tab' });
        if (reuseHttpError) {
          results.push({
            action: 'navigate',
            ...reuseHttpError,
            url: existingTab.page.url(),
          });
        }
      }

      for (const nestedAction of (nestedActions || [])) {
        // Snapshot error counts before action
        const prePageErrors = (existingTab.pageErrors || []).length;
        const preNetworkFailures = (existingTab.networkFailures || []).length;
        const preHttpErrors = (existingTab.httpErrors || []).length;

        const actionResult = await this.executeTabAction(existingTab.page, nestedAction, existingTab, context);

        const actionEntry = { action: nestedAction.type || nestedAction.action, ...actionResult };

        // Attach errors that occurred during this action
        const newPageErrors = (existingTab.pageErrors || []).slice(prePageErrors);
        const newNetworkFails = (existingTab.networkFailures || []).slice(preNetworkFailures);
        const newHttpErrs = (existingTab.httpErrors || []).slice(preHttpErrors);
        const dJs = WebTool._dedupeErrors(newPageErrors.map(e => e.message));
        const dNet = WebTool._dedupeErrors(newNetworkFails.map(f => `${f.method} ${f.url} → ${f.errorText}`));
        const dHttp = WebTool._dedupeErrors(newHttpErrs.map(e => `${e.method} ${e.url} → ${e.status}`));
        if (dJs.length > 0) actionEntry.jsErrors = dJs;
        if (dNet.length > 0) actionEntry.networkFailures = dNet;
        if (dHttp.length > 0) actionEntry.httpErrors = dHttp;

        results.push(actionEntry);
        existingTab.lastActivity = Date.now();
        if (humanMode) await humanWait('action');
      }

      const failedActions = results.filter(r => r.success === false);
      const diagnosticActions = results.filter(r => r.diagnostic);
      const reusedJsErrors = WebTool._dedupeErrors((existingTab.pageErrors || []).map(e => e.message));
      const reusedNetFails = WebTool._dedupeErrors((existingTab.networkFailures || []).map(f => `${f.method} ${f.url} → ${f.errorText}`));

      const diagnostics = {};
      if (reusedJsErrors.length > 0) diagnostics.jsErrors = reusedJsErrors;
      if (reusedNetFails.length > 0) diagnostics.networkFailures = reusedNetFails;
      if (diagnosticActions.length > 0) diagnostics.pageIssues = diagnosticActions.map(a => a.diagnostic);

      return {
        success: failedActions.length === 0,
        tabName,
        url: existingTab.page.url(),
        actionsExecuted: results.length,
        results,
        reused: true,
        ...(failedActions.length > 0 && { warning: `${failedActions.length} of ${results.length} action(s) failed` }),
        ...(diagnosticActions.length > 0 && !failedActions.length && {
          notice: `All actions executed successfully. ${diagnosticActions.length} page-level issue(s) detected — see diagnostics.`
        }),
        ...(Object.keys(diagnostics).length > 0 && { diagnostics }),
        ...((existingTab.httpErrors || []).length > 0 && { httpErrors: WebTool._dedupeErrors(existingTab.httpErrors.map(e => `${e.method} ${e.url} → ${e.status}`)) })
      };
    }

    this.logger?.info('[WebTool] Opening stealth tab', { agentId, tabName, url, headless, humanMode });

    // Create stealth page with optional human cursor
    const { page, cursor } = await this.createPage({ humanMode });

    // RESTORE SESSION COOKIES if available for this domain
    // This enables authenticated browsing after using the authenticate operation
    if (url) {
      try {
        const vault = getCredentialVault(this.logger);
        await vault.initialize();

        // Extract domain from URL to find matching sessions
        const urlObj = new URL(url);
        const domain = urlObj.hostname.replace(/^www\./, '');

        // Check all stored sessions for matching domain
        const allSessions = vault.getAllSessions ? vault.getAllSessions() : {};
        for (const [siteId, session] of Object.entries(allSessions)) {
          if (session.cookies && session.cookies.length > 0) {
            // Check if any cookie domain matches our target URL
            const hasMatchingCookies = session.cookies.some(cookie => {
              const cookieDomain = (cookie.domain || '').replace(/^\./, '');
              return domain.includes(cookieDomain) || cookieDomain.includes(domain);
            });

            if (hasMatchingCookies) {
              this.logger?.info('[WebTool] Restoring session cookies for domain', {
                siteId,
                domain,
                cookieCount: session.cookies.length
              });

              // Filter cookies that match this domain
              const relevantCookies = session.cookies.filter(cookie => {
                const cookieDomain = (cookie.domain || '').replace(/^\./, '');
                return domain.includes(cookieDomain) || cookieDomain.includes(domain);
              });

              if (relevantCookies.length > 0) {
                await page.setCookie(...relevantCookies);
                this.logger?.debug('[WebTool] Session cookies restored', {
                  domain,
                  restoredCount: relevantCookies.length
                });
              }
              break; // Only restore from first matching session
            }
          }
        }
      } catch (cookieError) {
        this.logger?.warn('[WebTool] Failed to restore session cookies (non-fatal)', {
          error: cookieError.message
        });
      }
    }

    // Track console messages
    const consoleMessages = [];
    page.on('console', msg => {
      consoleMessages.push({
        type: msg.type(),
        text: msg.text(),
        timestamp: Date.now()
      });
    });

    // Track JS errors (uncaught exceptions in the page)
    const pageErrors = [];
    page.on('pageerror', err => {
      pageErrors.push({
        message: err.message || String(err),
        timestamp: Date.now()
      });
    });

    // Track failed network requests (DNS, CORS, timeouts, connection refused, etc.)
    const networkFailures = [];
    page.on('requestfailed', req => {
      const failure = req.failure();
      networkFailures.push({
        url: req.url(),
        method: req.method(),
        resourceType: req.resourceType(),
        errorText: failure ? failure.errorText : 'unknown',
        timestamp: Date.now()
      });
    });

    // Track failed HTTP responses on XHR/fetch (API errors that don't throw but return 4xx/5xx)
    const httpErrors = [];
    page.on('response', res => {
      const status = res.status();
      const resourceType = res.request().resourceType();
      // Only track XHR/fetch failures, not static assets like images/css (too noisy)
      if (status >= 400 && (resourceType === 'xhr' || resourceType === 'fetch')) {
        httpErrors.push({
          url: res.url(),
          status,
          method: res.request().method(),
          timestamp: Date.now()
        });
      }
    });

    // Store tab info with cursor for human-like actions
    const tabInfo = {
      page,
      url,
      lastActivity: Date.now(),
      headless,
      consoleMessages,
      pageErrors,
      networkFailures,
      httpErrors,
      name: tabName,
      humanMode,
      cursor // Store cursor for reuse in actions
    };

    agentTabsMap.set(tabName, tabInfo);

    const results = [];

    try {
      // Navigate to initial URL if provided
      if (url) {
        const openTabResponse = await page.goto(url, {
          waitUntil: BROWSER_CONFIG.WAIT_UNTIL,
          timeout: this.DEFAULT_TIMEOUT
        });
        tabInfo.url = page.url();
        tabInfo.lastActivity = Date.now();
        const openTabStatus = openTabResponse ? openTabResponse.status() : null;
        tabInfo.httpStatus = openTabStatus;

        // Human-like wait after navigation
        if (humanMode) {
          await humanWait('navigation');
        }

        // Reflect the HTTP status into the chain so failures propagate
        // up through the chain-aggregation logic. Path C rules:
        // 401/402/403 stay success:true (tab is genuinely usable for
        // login/paywall flows); 404/5xx/etc. become success:false so
        // an agent that hit the wrong URL doesn't keep operating on it.
        const openTabHttpError = WebTool._resultForHttpStatus(openTabStatus, { context: 'Tab' });
        if (openTabHttpError) {
          results.push({
            action: 'navigate',
            ...openTabHttpError,
            url: tabInfo.url,
          });
        }
      }

      // Execute nested actions — drain page/network errors after each action
      for (const action of nestedActions) {
        // Snapshot error counts before action
        const prePageErrors = pageErrors.length;
        const preNetworkFailures = networkFailures.length;
        const preHttpErrors = httpErrors.length;
        const preConsoleErrors = consoleMessages.filter(m => m.type === 'error').length;

        const actionResult = await this.executeTabAction(page, action, tabInfo, context);

        // Collect errors that occurred during this action
        const newPageErrors = pageErrors.slice(prePageErrors);
        const newNetworkFailures = networkFailures.slice(preNetworkFailures);
        const newHttpErrors = httpErrors.slice(preHttpErrors);
        const newConsoleErrors = consoleMessages.filter(m => m.type === 'error').slice(preConsoleErrors);

        const actionEntry = {
          action: action.type || action.action,
          ...actionResult
        };

        // Attach detected issues to the action result (deduplicated)
        const dedupedJs = WebTool._dedupeErrors(newPageErrors.map(e => e.message));
        const dedupedNet = WebTool._dedupeErrors(newNetworkFailures.map(f => `${f.method} ${f.url} → ${f.errorText}`));
        const dedupedHttp = WebTool._dedupeErrors(newHttpErrors.map(e => `${e.method} ${e.url} → ${e.status}`));
        const dedupedConsole = WebTool._dedupeErrors(newConsoleErrors.map(e => e.text));
        if (dedupedJs.length > 0) actionEntry.jsErrors = dedupedJs;
        if (dedupedNet.length > 0) actionEntry.networkFailures = dedupedNet;
        if (dedupedHttp.length > 0) actionEntry.httpErrors = dedupedHttp;
        if (dedupedConsole.length > 0) actionEntry.consoleErrors = dedupedConsole;

        results.push(actionEntry);
        tabInfo.lastActivity = Date.now();

        // Human-like delay between actions
        if (humanMode) {
          await humanWait('action');
        }
      }

      const failedActions = results.filter(r => r.success === false);
      const diagnosticActions = results.filter(r => r.diagnostic);
      // Summarize all page issues for the agent (deduplicated)
      const allJsErrors = WebTool._dedupeErrors(pageErrors.map(e => e.message));
      const allNetworkFails = WebTool._dedupeErrors(networkFailures.map(f => `${f.method} ${f.url} → ${f.errorText}`));
      const allHttpErrs = WebTool._dedupeErrors(httpErrors.map(e => `${e.method} ${e.url} → ${e.status}`));

      // Collect diagnostics: page-level observations that aren't action failures
      const diagnostics = {};
      if (allJsErrors.length > 0) diagnostics.jsErrors = allJsErrors;
      if (allNetworkFails.length > 0) diagnostics.networkFailures = allNetworkFails;
      if (allHttpErrs.length > 0) diagnostics.httpErrors = allHttpErrs;
      if (diagnosticActions.length > 0) diagnostics.pageIssues = diagnosticActions.map(a => a.diagnostic);

      return {
        success: failedActions.length === 0,
        tabName,
        url: tabInfo.url,
        actionsExecuted: results.length,
        results,
        ...(failedActions.length > 0 && { warning: `${failedActions.length} of ${results.length} action(s) failed` }),
        ...(diagnosticActions.length > 0 && !failedActions.length && {
          notice: `All actions executed successfully. ${diagnosticActions.length} page-level issue(s) detected — see diagnostics.`
        }),
        // Surface diagnostics at top level for agent awareness
        ...(Object.keys(diagnostics).length > 0 && { diagnostics })
      };

    } catch (error) {
      this.logger?.error('Failed to open tab', {
        agentId,
        tabName,
        error: error.message
      });

      // Check if the page is still usable before deciding to clean up
      let pageStillAlive = false;
      try {
        await page.evaluate(() => document.readyState);
        pageStillAlive = true;
      } catch { /* page is dead */ }

      if (pageStillAlive) {
        // Keep the tab alive so subsequent operations can reuse it
        // (the error was likely in a nested action, not in navigation itself)
        this.logger?.warn('[WebTool] Tab kept alive despite error — page is still usable', { tabName });
        return {
          success: false,
          tabName,
          url: tabInfo.url || page.url(),
          actionsExecuted: results.length,
          results,
          error: error.message,
          warning: 'Tab is still open and reusable despite the error above.'
        };
      } else {
        // Page is genuinely dead — clean up
        try { await page.close(); } catch { /* ignore close errors */ }
        agentTabsMap.delete(tabName);
        throw error;
      }
    }
  }

  /**
   * Execute an action in a tab context
   * @param {Page} page - Puppeteer page
   * @param {Object} action - Action to execute
   * @param {Object} tabInfo - Tab information (includes humanMode and cursor)
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Action result
   * @private
   */
  async executeTabAction(page, action, tabInfo, context) {
    const { humanMode = false, cursor = null } = tabInfo;
    // Accept both "type" and "action" as the action discriminator
    if (!action.type && action.action) action.type = action.action;

    switch (action.type) {
      case 'navigate': {
        const navUrl = action.value || action.url;
        // Validate URL format
        if (!navUrl || typeof navUrl !== 'string') {
          return { success: false, error: 'URL is required for navigate action' };
        }
        try {
          new URL(navUrl);
        } catch {
          return { success: false, error: `Invalid URL format: "${navUrl}". Must include protocol (https://)` };
        }
        const navResponse = await page.goto(navUrl, {
          waitUntil: BROWSER_CONFIG.WAIT_UNTIL,
          timeout: this.DEFAULT_TIMEOUT
        });
        tabInfo.url = page.url();
        // Check HTTP status
        const navStatus = navResponse ? navResponse.status() : null;
        if (humanMode) {
          await humanWait('navigation');
        }
        const navHttpError = WebTool._resultForHttpStatus(navStatus, { context: 'Page' });
        if (navHttpError) {
          return { ...navHttpError, url: tabInfo.url };
        }
        return { success: true, url: tabInfo.url, httpStatus: navStatus };
      }

      case 'click': {
        if (!action.selector) {
          return { success: false, error: 'selector is required for click action' };
        }
        // Pre-check selector exists
        const clickTarget = await page.$(action.selector);
        if (!clickTarget) {
          const pageUrl = page.url();
          return {
            success: false,
            error: `Element not found: "${action.selector}" on ${pageUrl}`,
            selector: action.selector,
            suggestion: 'The element may not exist on this page, may have a different selector, or may not have loaded yet. Try wait-for first, or use extract-text/extract-links to inspect available elements.'
          };
        }
        // Scroll element into view before interacting (prevents offscreen failures)
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, action.selector);
        await new Promise(r => setTimeout(r, 300)); // Brief settle after scroll
        if (humanMode && cursor) {
          try {
            await cursor.click(action.selector);
          } catch (cursorErr) {
            // Fallback to standard Puppeteer click if ghost-cursor fails
            // (e.g., element obscured by overlay, zero-size, or offscreen)
            this.logger?.warn('[WebTool] ghost-cursor click failed, falling back to standard click', {
              selector: action.selector,
              error: cursorErr.message
            });
            try {
              await page.click(action.selector, { button: action.button || 'left' });
            } catch (puppeteerClickErr) {
              // Final fallback: use JavaScript .click() for hidden/styled elements
              // (e.g., custom checkboxes, radio buttons with display:none inputs)
              this.logger?.warn('[WebTool] Puppeteer click also failed, using JS click fallback', {
                selector: action.selector,
                error: puppeteerClickErr.message
              });
              await page.evaluate((sel) => {
                const el = document.querySelector(sel);
                if (el) {
                  // For checkboxes/radios, try clicking the associated label first
                  if (el.type === 'checkbox' || el.type === 'radio') {
                    const label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
                    if (label) {
                      label.click();
                    } else {
                      el.click();
                    }
                  } else {
                    el.click();
                  }
                }
              }, action.selector);
            }
          }
        } else {
          try {
            await page.click(action.selector, {
              button: action.button || 'left'
            });
          } catch (clickErr) {
            // JS fallback for non-humanMode too
            this.logger?.warn('[WebTool] Standard click failed, using JS click fallback', {
              selector: action.selector,
              error: clickErr.message
            });
            await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              if (el) {
                if (el.type === 'checkbox' || el.type === 'radio') {
                  const label = el.id ? document.querySelector(`label[for="${el.id}"]`) : null;
                  if (label) { label.click(); } else { el.click(); }
                } else {
                  el.click();
                }
              }
            }, action.selector);
          }
        }
        // Verify checkbox/radio state after click for agent awareness
        const clickedElState = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          if (el.type === 'checkbox' || el.type === 'radio') {
            return { isToggle: true, checked: el.checked, type: el.type };
          }
          return { isToggle: false };
        }, action.selector);
        return {
          success: true,
          selector: action.selector,
          ...(clickedElState?.isToggle && { checked: clickedElState.checked, elementType: clickedElState.type })
        };
      }

      case 'type': {
        if (!action.selector) {
          return { success: false, error: 'selector is required for type action' };
        }
        const typeText = action.text || action.value || '';
        // Pre-check selector exists
        const typeTarget = await page.$(action.selector);
        if (!typeTarget) {
          return {
            success: false,
            error: `Element not found: "${action.selector}" on ${page.url()}`,
            selector: action.selector,
            suggestion: 'The input element may not exist or may have a different selector. Use extract-text to inspect the page.'
          };
        }
        // Scroll element into view before interacting (prevents offscreen failures)
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, action.selector);
        await new Promise(r => setTimeout(r, 300)); // Brief settle after scroll
        if (humanMode) {
          try {
            await humanType(page, action.selector, typeText, {
              clearFirst: action.clearFirst !== false,
              simulateTypos: action.simulateTypos || false
            });
          } catch (humanTypeErr) {
            // Fallback to standard Puppeteer typing if humanType fails
            this.logger?.warn('[WebTool] humanType failed, falling back to standard type', {
              selector: action.selector,
              error: humanTypeErr.message
            });
            if (action.clearFirst !== false) {
              await page.click(action.selector, { clickCount: 3 });
              await page.keyboard.press('Backspace');
            }
            await page.type(action.selector, typeText);
          }
        } else {
          if (action.clearFirst !== false) {
            await page.click(action.selector, { clickCount: 3 });
            await page.keyboard.press('Backspace');
          }
          await page.type(action.selector, typeText);
        }
        // Verify the value was set — fallback to direct value injection if needed
        let verificationNote = null;
        try {
          const currentVal = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el ? (el.value || el.textContent) : null;
          }, action.selector);
          if (currentVal !== null && !currentVal.includes(typeText.slice(0, 5)) && typeText.length > 0) {
            this.logger?.warn('[WebTool] Type verification failed, using direct value injection', { selector: action.selector });
            await page.evaluate((sel, val) => {
              const el = document.querySelector(sel);
              if (el) {
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }, action.selector, typeText);
            verificationNote = 'Keyboard typing did not produce expected value; used direct value injection as fallback.';
          }
        } catch (verifyErr) {
          verificationNote = `Type verification check failed: ${verifyErr.message}`;
        }
        return {
          success: true,
          selector: action.selector,
          text: action.text,
          ...(verificationNote && { warning: verificationNote })
        };
      }

      case 'press':
        await page.keyboard.press(action.key || action.value);
        return { success: true, key: action.key };

      case 'wait-for': {
        if (!action.selector) return { success: false, error: 'selector is required for wait-for action' };
        const waitTimeout = action.timeout ? parseInt(action.timeout, 10) : this.DEFAULT_TIMEOUT;
        try {
          await page.waitForSelector(action.selector, { timeout: waitTimeout });
          return { success: true, selector: action.selector };
        } catch (waitErr) {
          return {
            success: false,
            selector: action.selector,
            error: `Element "${action.selector}" did not appear within ${Math.round(waitTimeout / 1000)}s on ${page.url()}`,
            suggestion: 'The element may not exist on this page, may use a different selector, or may require user interaction first.'
          };
        }
      }

      case 'screenshot':
        return await this.takeScreenshot(page, action, context);

      case 'analyze-screenshot':
        return await this.analyzeScreenshot(page, action.value, context);

      case 'extract-text': {
        if (!action.selector) {
          return { success: false, error: 'selector is required for extract-text action' };
        }
        const extractedText = await page.evaluate((sel) => {
          const element = document.querySelector(sel);
          return element ? element.innerText : null;
        }, action.selector);
        if (extractedText === null) {
          return {
            success: false,
            selector: action.selector,
            error: `Element not found: "${action.selector}" on ${page.url()}`,
            text: null
          };
        }
        return { success: true, selector: action.selector, text: extractedText };
      }

      case 'extract-links':
        const links = await page.evaluate((sel) => {
          const elements = document.querySelectorAll(sel);
          return Array.from(elements).map(a => ({
            href: a.href,
            text: a.textContent.trim()
          }));
        }, action.selector);
        return { success: true, selector: action.selector, links };

      case 'get-source':
        const html = await page.content();
        return { success: true, html };

      case 'get-console':
        return {
          success: true,
          consoleMessages: [...tabInfo.consoleMessages]
        };

      case 'scroll':
        if (humanMode) {
          // Human-like smooth scroll
          await humanScroll(page, {
            direction: action.direction || 'down',
            distance: action.distance || 300
          });
        } else {
          await page.evaluate((sel) => {
            if (sel) {
              document.querySelector(sel)?.scrollIntoView();
            } else {
              window.scrollTo(0, document.body.scrollHeight);
            }
          }, action.selector);
        }
        return { success: true };

      case 'hover': {
        if (!action.selector) return { success: false, error: 'selector is required for hover action' };
        const hoverTarget = await page.$(action.selector);
        if (!hoverTarget) {
          return { success: false, error: `Element not found: "${action.selector}" on ${page.url()}`, selector: action.selector };
        }
        // Scroll into view first
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, action.selector);
        await new Promise(r => setTimeout(r, 300));
        if (humanMode && cursor) {
          try {
            await cursor.hover(action.selector);
          } catch (cursorErr) {
            this.logger?.warn('[WebTool] ghost-cursor hover failed, falling back to standard hover', {
              selector: action.selector, error: cursorErr.message
            });
            await page.hover(action.selector);
          }
        } else {
          await page.hover(action.selector);
        }
        return { success: true, selector: action.selector };
      }

      case 'mouse-move': {
        if (!action.selector) return { success: false, error: 'selector is required for mouse-move action' };
        const moveTarget = await page.$(action.selector);
        if (!moveTarget) {
          return { success: false, error: `Element not found: "${action.selector}" on ${page.url()}`, selector: action.selector };
        }
        // Scroll into view first
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, action.selector);
        await new Promise(r => setTimeout(r, 300));
        if (humanMode && cursor) {
          try {
            await cursor.moveTo(action.selector);
          } catch (cursorErr) {
            this.logger?.warn('[WebTool] ghost-cursor moveTo failed, falling back to standard hover', {
              selector: action.selector, error: cursorErr.message
            });
            await page.hover(action.selector);
          }
        } else {
          await page.hover(action.selector);
        }
        return { success: true, selector: action.selector };
      }

      case 'wait':
      case 'delay':
        // Time-based wait (max 30 seconds to prevent abuse)
        const waitTime = Math.min(action.waitTime || action.value || 1000, 30000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return { success: true, waited: waitTime };

      case 'submit': {
        if (!action.selector) return { success: false, error: 'selector is required for submit action' };
        const submitTarget = await page.$(action.selector);
        if (!submitTarget) {
          return { success: false, error: `Element not found: "${action.selector}" on ${page.url()}`, selector: action.selector };
        }

        // Check if submit button is disabled
        const submitDisabled = await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          return el?.disabled || el?.getAttribute('aria-disabled') === 'true';
        }, action.selector);
        if (submitDisabled) {
          return {
            success: false,
            selector: action.selector,
            error: `Submit button "${action.selector}" is disabled — required fields may be empty or invalid.`,
            suggestion: 'Use get-field-values to inspect form state, or check for unfilled required fields and unchecked agreement checkboxes.'
          };
        }

        // Scroll submit button into view
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, action.selector);
        await new Promise(r => setTimeout(r, 300));

        // Capture pre-submit state for change detection
        const preSubmitBodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
        const preSubmitUrl = page.url();

        // Set up network POST listener to capture form submission response
        const submitNetworkResults = [];
        const submitResponseHandler = async (response) => {
          const req = response.request();
          if (req.method() === 'POST') {
            let respBody = null;
            try { respBody = await response.text(); } catch {}
            submitNetworkResults.push({
              url: response.url(),
              status: response.status(),
              body: respBody?.substring(0, 1000)
            });
          }
        };
        page.on('response', submitResponseHandler);

        // Determine if selector points to a form or a button
        let isFormElement = false;
        try {
          isFormElement = await page.evaluate((sel) => {
            const el = document.querySelector(sel);
            return el?.tagName?.toLowerCase() === 'form';
          }, action.selector);
        } catch (evalErr) {
          this.logger?.warn('[WebTool] Form detection failed', { error: evalErr.message });
        }

        let navigationWarning = null;
        if (isFormElement) {
          await Promise.all([
            page.waitForNavigation({ timeout: 15000, waitUntil: BROWSER_CONFIG.WAIT_UNTIL }).catch((e) => {
              navigationWarning = `Navigation after submit did not complete: ${e.message}`;
            }),
            page.evaluate((sel) => document.querySelector(sel).submit(), action.selector)
          ]);
        } else if (humanMode && cursor) {
          try {
            await humanSubmit(page, action.selector, {
              cursor,
              waitForNavigation: action.waitForNavigation !== false
            });
          } catch (submitCursorErr) {
            // Fallback to standard click for submit
            this.logger?.warn('[WebTool] humanSubmit failed, falling back to standard click', {
              selector: action.selector, error: submitCursorErr.message
            });
            await page.click(action.selector);
          }
        } else {
          await Promise.all([
            action.waitForNavigation !== false
              ? page.waitForNavigation({ timeout: 15000, waitUntil: BROWSER_CONFIG.WAIT_UNTIL }).catch((e) => {
                  navigationWarning = `Navigation after submit did not complete: ${e.message}`;
                })
              : Promise.resolve(),
            page.click(action.selector)
          ]);
        }

        // Wait for AJAX responses to arrive (most forms submit via AJAX)
        await new Promise(r => setTimeout(r, 3000));

        // Remove listener
        page.off('response', submitResponseHandler);

        // Detect success indicators on the page
        const submitDetection = await page.evaluate(() => {
          const body = document.body.innerText;
          const successKeywords = ['thank', 'success', 'submitted', 'received', 'confirmation', 'we will contact'];
          const errorKeywords = ['error', 'failed', 'invalid', 'required', 'please fill', 'try again'];
          const foundSuccess = successKeywords.filter(kw => body.toLowerCase().includes(kw));
          const foundErrors = errorKeywords.filter(kw => body.toLowerCase().includes(kw));

          // Look for success/error DOM elements
          const successEls = document.querySelectorAll('[class*="success"], [class*="thank"], [class*="confirmation"], [data-success]');
          const errorEls = document.querySelectorAll('[class*="error"], [class*="invalid"], [class*="alert-danger"], .field-error');
          const successMessages = Array.from(successEls).map(el => el.innerText?.trim()).filter(t => t && t.length < 200);
          const errorMessages = Array.from(errorEls).map(el => el.innerText?.trim()).filter(t => t && t.length < 200 && t.length > 0);

          return { foundSuccess, foundErrors, successMessages, errorMessages };
        });

        const postSubmitUrl = page.url();
        const urlChanged = postSubmitUrl !== preSubmitUrl;

        // Determine if submission was confirmed
        const submitConfirmed = submitDetection.successMessages.length > 0 ||
                                submitDetection.foundSuccess.length > 0 ||
                                urlChanged ||
                                submitNetworkResults.some(r => r.status >= 200 && r.status < 300);

        return {
          success: true,
          selector: action.selector,
          url: postSubmitUrl,
          ...(urlChanged && { urlChanged: true, previousUrl: preSubmitUrl }),
          ...(navigationWarning && { warning: navigationWarning }),
          // Submission detection results
          submitConfirmed,
          ...(submitDetection.successMessages.length > 0 && { successMessage: submitDetection.successMessages[0] }),
          ...(submitDetection.errorMessages.length > 0 && { formErrors: submitDetection.errorMessages }),
          ...(submitNetworkResults.length > 0 && {
            networkResponse: submitNetworkResults.map(r => ({
              url: r.url.substring(0, 150),
              status: r.status,
              ...(r.body && r.body.length < 500 && { body: r.body })
            }))
          })
        };
      }

      case 'evaluate': {
        // Execute arbitrary JavaScript in the page context
        const script = action.script || action.value;
        if (!script) {
          return { success: false, error: 'script is required for evaluate action. Provide JS code to execute in the page context.' };
        }
        try {
          const evalResult = await page.evaluate((code) => {
            try {
              // Wrap in Function to allow return statements, or eval directly
              const fn = new Function(code);
              const result = fn();
              // Serialize result (handle DOM elements, circular refs)
              if (result instanceof HTMLElement) {
                return { __type: 'HTMLElement', tagName: result.tagName, id: result.id, className: result.className?.toString(), text: result.innerText?.substring(0, 500) };
              }
              return JSON.parse(JSON.stringify(result ?? null));
            } catch (e) {
              return { __error: e.message };
            }
          }, script);

          if (evalResult && evalResult.__error) {
            return { success: false, error: `Script execution error: ${evalResult.__error}` };
          }
          return { success: true, result: evalResult };
        } catch (evalErr) {
          return { success: false, error: `Evaluate failed: ${evalErr.message}` };
        }
      }

      case 'get-field-values': {
        // Read current values of form fields — essential for verifying form state
        const selectors = action.selectors || (action.selector ? [action.selector] : null);
        if (!selectors || !Array.isArray(selectors) || selectors.length === 0) {
          return { success: false, error: 'selectors array is required for get-field-values action.' };
        }
        const fieldValues = await page.evaluate((sels) => {
          const results = {};
          for (const sel of sels) {
            const el = document.querySelector(sel);
            if (!el) {
              results[sel] = { found: false };
              continue;
            }
            const entry = { found: true, tagName: el.tagName.toLowerCase() };
            if (el.type === 'checkbox' || el.type === 'radio') {
              entry.checked = el.checked;
              entry.value = el.value;
            } else if (el.tagName === 'SELECT') {
              entry.value = el.value;
              entry.selectedText = el.options[el.selectedIndex]?.text;
              entry.options = Array.from(el.options).map(o => ({ value: o.value, text: o.text, selected: o.selected }));
            } else {
              entry.value = el.value || el.innerText?.substring(0, 500) || '';
            }
            entry.disabled = el.disabled || false;
            entry.required = el.required || el.hasAttribute('required') || false;
            results[sel] = entry;
          }
          return results;
        }, selectors);
        return { success: true, fields: fieldValues };
      }

      case 'select': {
        // Select an option in a <select> dropdown or custom dropdown
        if (!action.selector) {
          return { success: false, error: 'selector is required for select action' };
        }
        const selectValue = action.value || action.text;
        if (selectValue === undefined || selectValue === null) {
          return { success: false, error: 'value or text is required for select action' };
        }
        const selectEl = await page.$(action.selector);
        if (!selectEl) {
          return {
            success: false,
            error: `Element not found: "${action.selector}" on ${page.url()}`,
            selector: action.selector,
            suggestion: 'Use get-source or extract-text to find the correct select element selector.'
          };
        }
        // Scroll into view
        await page.evaluate((sel) => {
          const el = document.querySelector(sel);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, action.selector);
        await new Promise(r => setTimeout(r, 300));

        const isNativeSelect = await page.evaluate((sel) => {
          return document.querySelector(sel)?.tagName?.toLowerCase() === 'select';
        }, action.selector);

        if (isNativeSelect) {
          // Native <select> — use Puppeteer's select method
          try {
            // Try matching by value first, then by visible text
            let selected = await page.select(action.selector, selectValue);
            if (!selected || selected.length === 0) {
              // Try matching by text content
              selected = await page.evaluate((sel, text) => {
                const selectEl = document.querySelector(sel);
                if (!selectEl) return [];
                const option = Array.from(selectEl.options).find(o =>
                  o.text.toLowerCase().includes(text.toLowerCase()) ||
                  o.value.toLowerCase().includes(text.toLowerCase())
                );
                if (option) {
                  selectEl.value = option.value;
                  selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                  selectEl.dispatchEvent(new Event('input', { bubbles: true }));
                  return [option.value];
                }
                return [];
              }, action.selector, selectValue);
            }
            const currentValue = await page.evaluate((sel) => {
              const el = document.querySelector(sel);
              return { value: el?.value, text: el?.options?.[el?.selectedIndex]?.text };
            }, action.selector);
            return {
              success: true,
              selector: action.selector,
              selectedValue: currentValue.value,
              selectedText: currentValue.text
            };
          } catch (selectErr) {
            return { success: false, error: `Select failed: ${selectErr.message}`, selector: action.selector };
          }
        } else {
          // Custom dropdown — click to open, then click matching option
          if (humanMode && cursor) {
            try { await cursor.click(action.selector); } catch { await page.click(action.selector); }
          } else {
            await page.click(action.selector);
          }
          await new Promise(r => setTimeout(r, 500)); // Wait for dropdown to open

          // Find and click the matching option
          const optionClicked = await page.evaluate((text) => {
            // Common dropdown option selectors
            const optionSelectors = [
              '[role="option"]', '[role="listbox"] li', '.dropdown-item', '.select-option',
              '[class*="option"]', '[class*="dropdown"] li', '[class*="menu"] li',
              'ul[class*="select"] li', 'div[class*="select"] div[class*="option"]'
            ];
            for (const optSel of optionSelectors) {
              const options = document.querySelectorAll(optSel);
              for (const opt of options) {
                if (opt.innerText?.toLowerCase().includes(text.toLowerCase())) {
                  opt.click();
                  return { found: true, text: opt.innerText.trim() };
                }
              }
            }
            return { found: false };
          }, selectValue);

          if (optionClicked.found) {
            return { success: true, selector: action.selector, selectedText: optionClicked.text };
          } else {
            return {
              success: false,
              selector: action.selector,
              error: `Could not find option matching "${selectValue}" in dropdown`,
              suggestion: 'Use extract-text on the dropdown or get-source to inspect available options.'
            };
          }
        }
      }

      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  /**
   * Take screenshot of page
   * @param {Page} page - Puppeteer page
   * @param {Object} options - Screenshot options
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Screenshot result
   * @private
   */
  async takeScreenshot(page, options, context) {
    const format = options.format || 'file';
    const screenshotPath = options.path;

    if (format === 'base64') {
      const screenshot = await page.screenshot({ encoding: 'base64' });
      return {
        success: true,
        format: 'base64',
        screenshot
      };
    }

    // File format
    let filePath;

    if (screenshotPath) {
      // Save to project directory if path is provided
      const projectDir = context.directoryAccess?.workingDirectory || context.projectDir || process.cwd();
      filePath = path.isAbsolute(screenshotPath)
        ? screenshotPath
        : path.join(projectDir, screenshotPath);
    } else {
      // Save to temp directory
      const filename = `screenshot-${Date.now()}.png`;
      filePath = path.join(this.TEMP_DIR, filename);
    }

    await page.screenshot({ path: filePath });

    return {
      success: true,
      format: 'file',
      path: filePath
    };
  }

  /**
   * Select the best available vision model for screenshot analysis.
   * Uses catalog tags + recommended_for — no hardcoded model names.
   * @private
   */
  _selectVisionModel(context) {
    const modelsService = context.aiService?.modelsService;
    if (!modelsService) return null;

    const allModels = modelsService.getModels?.() || [];
    const visionModels = allModels.filter(m => m.supportsVision === true);
    if (visionModels.length === 0) return null;

    // 1. Model recommended for vision (from catalog)
    const recommended = visionModels.find(m => m.recommended_for?.includes('vision'));
    if (recommended) return recommended.name;

    // 2. Budget-tier vision model (best cost/quality)
    const budget = visionModels.find(m => m.tier === 'budget');
    if (budget) return budget.name;

    // 3. First available
    return visionModels[0].name;
  }

  /**
   * Analyze screenshot using AI vision model
   * @param {Page} page - Puppeteer page
   * @param {string} question - Question for AI
   * @param {Object} context - Execution context
   * @returns {Promise<Object>} Analysis result
   * @private
   */
  async analyzeScreenshot(page, question, context) {
    // Take screenshot as base64
    const screenshot = await page.screenshot({ encoding: 'base64' });

    // Get AI service from context
    const aiService = context.aiService;
    if (!aiService) {
      throw new Error('AI service not available for screenshot analysis');
    }

    this.logger?.info('Analyzing screenshot with AI', {
      question: question.substring(0, 100),
      agentId: context.agentId
    });

    try {
      // Select best available vision model dynamically
      const model = this._selectVisionModel(context) || 'o4-mini';

      // Create message with image
      const response = await aiService.sendMessage(
        model,
        question,
        {
          agentId: context.agentId,
          images: [`data:image/png;base64,${screenshot}`],
          apiKey: context.apiKey,
          customApiKeys: context.customApiKeys,
        }
      );

      return {
        success: true,
        question,
        analysis: response.content,
        model: response.model || model
      };

    } catch (error) {
      this.logger?.error('Screenshot analysis failed', {
        error: error.message,
        agentId: context.agentId
      });

      throw new Error(`Screenshot analysis failed: ${error.message}`);
    }
  }

  /**
   * Close a tab
   * @param {string} agentId - Agent identifier
   * @param {string} tabName - Tab name to close
   * @returns {Promise<Object>} Result
   */
  async closeTab(agentId, tabName) {
    const agentTabsMap = this.agentTabs.get(agentId);
    if (!agentTabsMap || !agentTabsMap.has(tabName)) {
      throw new Error(`Tab '${tabName}' not found for agent ${agentId}`);
    }

    const tabInfo = agentTabsMap.get(tabName);

    this.logger?.info('Closing tab', { agentId, tabName });

    await tabInfo.page.close();
    agentTabsMap.delete(tabName);

    return {
      success: true,
      tabName,
      message: `Tab '${tabName}' closed`
    };
  }

  /**
   * Switch to an existing tab
   * @param {string} agentId - Agent identifier
   * @param {string} tabName - Tab name to switch to
   * @returns {Promise<Object>} Result
   */
  async switchTab(agentId, tabName) {
    const agentTabsMap = this.agentTabs.get(agentId);
    if (!agentTabsMap || !agentTabsMap.has(tabName)) {
      throw new Error(`Tab '${tabName}' not found for agent ${agentId}`);
    }

    const tabInfo = agentTabsMap.get(tabName);
    tabInfo.lastActivity = Date.now();

    return {
      success: true,
      tabName,
      url: tabInfo.url,
      message: `Switched to tab '${tabName}'`
    };
  }

  /**
   * List all active tabs for an agent
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object>} List of tabs
   */
  async listTabs(agentId) {
    const agentTabsMap = this.agentTabs.get(agentId);

    if (!agentTabsMap || agentTabsMap.size === 0) {
      return {
        success: true,
        tabCount: 0,
        tabs: [],
        message: 'No active tabs'
      };
    }

    const tabs = [];
    for (const [name, info] of agentTabsMap.entries()) {
      tabs.push({
        name,
        url: info.url,
        idleTime: Date.now() - info.lastActivity,
        headless: info.headless
      });
    }

    return {
      success: true,
      tabCount: tabs.length,
      tabs
    };
  }

  /**
   * Start cleanup timer for idle tabs
   * @private
   */
  startCleanupTimer() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }

    this.cleanupTimer = setInterval(() => {
      this.cleanupIdleTabs();
    }, this.CLEANUP_INTERVAL);
    // Don't let this background-maintenance timer hold the event loop
    // open. When all real work is done (CLI exits, test suite finishes),
    // the process should be free to exit on its own. Tests that create
    // a WebTool without explicit cleanup() previously left jest workers
    // hanging until --forceExit. unref() is the industry-standard fix
    // for periodic-maintenance timers.
    if (typeof this.cleanupTimer.unref === 'function') {
      this.cleanupTimer.unref();
    }
  }

  /**
   * Cleanup idle tabs (1-hour timeout)
   * @private
   */
  async cleanupIdleTabs() {
    const now = Date.now();
    const tabsToClose = [];

    for (const [agentId, agentTabsMap] of this.agentTabs.entries()) {
      for (const [tabName, tabInfo] of agentTabsMap.entries()) {
        const idleTime = now - tabInfo.lastActivity;

        if (idleTime > this.TAB_IDLE_TIMEOUT) {
          tabsToClose.push({ agentId, tabName, tabInfo });
        }
      }
    }

    if (tabsToClose.length > 0) {
      this.logger?.info('Cleaning up idle tabs', {
        count: tabsToClose.length
      });

      for (const { agentId, tabName, tabInfo } of tabsToClose) {
        try {
          await tabInfo.page.close();
          this.agentTabs.get(agentId).delete(tabName);
          this.logger?.debug('Closed idle tab', { agentId, tabName });
        } catch (error) {
          this.logger?.error('Failed to close idle tab', {
            agentId,
            tabName,
            error: error.message
          });
        }
      }
    }
  }

  /**
   * Cleanup all tabs for an agent (called when agent is deleted)
   * @param {string} agentId - Agent identifier
   * @returns {Promise<Object>} Cleanup result
   */
  async cleanupAgent(agentId) {
    const agentTabsMap = this.agentTabs.get(agentId);

    if (!agentTabsMap) {
      return {
        success: true,
        agentId,
        closedTabs: 0,
        message: 'No tabs to clean up'
      };
    }

    this.logger?.info('Cleaning up agent tabs', {
      agentId,
      tabCount: agentTabsMap.size
    });

    let closedCount = 0;

    for (const [tabName, tabInfo] of agentTabsMap.entries()) {
      try {
        await tabInfo.page.close();
        closedCount++;
      } catch (error) {
        this.logger?.error('Failed to close tab during cleanup', {
          agentId,
          tabName,
          error: error.message
        });
      }
    }

    this.agentTabs.delete(agentId);

    return {
      success: true,
      agentId,
      closedTabs: closedCount,
      message: `Closed ${closedCount} tabs for agent ${agentId}`
    };
  }

  /**
   * Ensure temp directory exists
   * @private
   */
  async ensureTempDir() {
    try {
      await fs.mkdir(this.TEMP_DIR, { recursive: true });
    } catch (error) {
      this.logger?.warn('Failed to create temp directory', {
        path: this.TEMP_DIR,
        error: error.message
      });
    }
  }

  /**
   * Fix 4: Save all session cookies from authenticated tabs before browser close
   * This preserves login sessions even if browser needs to restart
   * @private
   * @returns {Promise<number>} Number of sessions saved
   */
  async saveAllSessionCookies() {
    let savedCount = 0;
    const vault = getCredentialVault();

    for (const [agentId, agentTabsMap] of this.agentTabs.entries()) {
      for (const [tabName, tabInfo] of agentTabsMap.entries()) {
        try {
          // Only save cookies from authenticated tabs or tabs with a meaningful URL
          if (tabInfo.authenticated || tabInfo.url) {
            const page = tabInfo.page;
            if (page && !page.isClosed()) {
              const cookies = await page.cookies();
              if (cookies && cookies.length > 0) {
                // Derive site ID from tab name or URL
                const siteId = tabInfo.siteId || tabName.replace(/-session$/, '') || this.extractDomainFromUrl(tabInfo.url);
                if (siteId) {
                  await vault.saveSession(siteId, cookies);
                  savedCount++;
                  this.logger?.info('[WebTool] Saved session cookies before browser close', {
                    agentId,
                    tabName,
                    siteId,
                    cookieCount: cookies.length
                  });
                }
              }
            }
          }
        } catch (error) {
          this.logger?.warn('[WebTool] Failed to save session cookies', {
            agentId,
            tabName,
            error: error.message
          });
        }
      }
    }

    return savedCount;
  }

  /**
   * Extract domain from URL for session identification
   * @private
   * @param {string} url - URL to extract domain from
   * @returns {string|null} Domain or null
   */
  extractDomainFromUrl(url) {
    try {
      if (!url) return null;
      const urlObj = new URL(url);
      // Return domain without www prefix
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  /**
   * Close the browser instance without full cleanup
   * Useful for changing stealth levels or freeing resources
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    if (this.browser) {
      try {
        // Fix 4: Save session cookies before closing tabs
        const savedSessions = await this.saveAllSessionCookies();
        if (savedSessions > 0) {
          this.logger?.info('[WebTool] Saved session cookies before browser close', { savedSessions });
        }

        // Close all agent tabs
        for (const [agentId] of this.agentTabs.entries()) {
          await this.cleanupAgent(agentId);
        }

        await this.browser.close();
        this.browser = null;
        this.logger?.info('[WebTool] Browser closed');
      } catch (error) {
        this.logger?.warn('[WebTool] Error closing browser', { error: error.message });
        this.browser = null;
      }
    }
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    // Stop cleanup timer
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // Fix 4: Save session cookies before cleanup
    if (this.browser) {
      try {
        await this.saveAllSessionCookies();
      } catch (error) {
        this.logger?.warn('[WebTool] Failed to save session cookies during cleanup', {
          error: error.message
        });
      }
    }

    // Close all tabs
    for (const [agentId] of this.agentTabs.entries()) {
      await this.cleanupAgent(agentId);
    }

    // Close browser
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
    }

    // Clean temp directory
    try {
      await fs.rm(this.TEMP_DIR, { recursive: true, force: true });
    } catch (error) {
      this.logger?.warn('Failed to clean temp directory', {
        path: this.TEMP_DIR,
        error: error.message
      });
    }
  }
}

export default WebTool;
