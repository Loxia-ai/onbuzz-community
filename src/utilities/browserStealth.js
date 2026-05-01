/**
 * Browser Stealth Utility
 *
 * Provides a stealthy Puppeteer browser instance with anti-detection measures.
 * Uses puppeteer-extra with stealth plugin for fingerprint evasion.
 */

import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import {
  BROWSER_CONFIG,
  USER_AGENTS,
  STEALTH_EVASIONS,
  STEALTH_LEVELS,
  DEFAULT_STEALTH_LEVEL
} from './stealthConstants.js';
import { getPlatform } from './platformUtils.js';

// Track if stealth plugin has been configured
let stealthPluginConfigured = false;

/**
 * Configure and apply stealth plugin with all evasions enabled
 * @param {Object} options - Configuration options
 * @param {string[]} options.excludeEvasions - Evasions to exclude
 * @returns {void}
 */
function configureStealthPlugin(options = {}) {
  // Only configure once (puppeteer-extra plugins are singletons)
  if (stealthPluginConfigured) return;

  const { excludeEvasions = STEALTH_EVASIONS.EXCLUDE } = options;

  const stealth = StealthPlugin();

  // Ensure ALL evasions are enabled for maximum stealth
  const allEvasions = new Set([
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    'defaultArgs',
    'iframe.contentWindow',
    'media.codecs',
    'navigator.hardwareConcurrency',
    'navigator.languages',
    'navigator.permissions',
    'navigator.plugins',
    'navigator.webdriver',
    'sourceurl',
    'user-agent-override',
    'webgl.vendor',
    'window.outerdimensions'
  ]);

  stealth.enabledEvasions = allEvasions;

  // Remove any excluded evasions
  if (excludeEvasions && excludeEvasions.length > 0) {
    excludeEvasions.forEach(evasion => {
      stealth.enabledEvasions.delete(evasion);
    });
  }

  puppeteer.use(stealth);
  stealthPluginConfigured = true;
}

/**
 * Get a random user agent string based on current platform
 * @param {string} [forcePlatform] - Force specific platform (windows, macos, linux)
 * @returns {string} Random user agent string
 */
export function getRandomUserAgent(forcePlatform = null) {
  const platform = forcePlatform || getPlatform();

  let agents;
  switch (platform) {
    case 'darwin':
    case 'macos':
      agents = USER_AGENTS.MACOS;
      break;
    case 'linux':
      agents = USER_AGENTS.LINUX;
      break;
    case 'win32':
    case 'windows':
    default:
      agents = USER_AGENTS.WINDOWS;
      break;
  }

  return agents[Math.floor(Math.random() * agents.length)];
}

/**
 * Get a random viewport configuration
 * @returns {Object} Viewport configuration { width, height }
 */
export function getRandomViewport() {
  const viewports = BROWSER_CONFIG.VIEWPORT_VARIANTS;
  return viewports[Math.floor(Math.random() * viewports.length)];
}

/**
 * Generate browser launch arguments for stealth mode
 * @param {Object} options - Configuration options
 * @param {string} options.userAgent - User agent to use (random if not specified)
 * @param {boolean} options.headless - Whether to run headless
 * @returns {string[]} Array of Chrome launch arguments
 */
export function getStealthLaunchArgs(options = {}) {
  const { userAgent = getRandomUserAgent(), headless = true } = options;

  const args = [
    // Sandbox settings (required for some environments)
    '--no-sandbox',
    '--disable-setuid-sandbox',

    // Performance optimizations
    '--disable-dev-shm-usage',

    // CRITICAL: Disable automation detection flags
    '--disable-blink-features=AutomationControlled',

    // Disable infobars ("Chrome is being controlled by automated software")
    '--disable-infobars',

    // Disable extensions (but not in a detectable way)
    '--disable-extensions',

    // Set user agent
    `--user-agent=${userAgent}`,

    // Disable automation extension
    '--disable-component-extensions-with-background-pages',

    // Window size (matches viewport for consistency)
    '--window-size=1920,1080',

    // Additional anti-detection
    '--disable-background-networking',
    '--disable-default-apps',
    '--disable-sync',
    '--disable-translate',
    '--metrics-recording-only',
    '--no-first-run',

    // REMOVED: --use-gl=swiftshader (MAJOR DETECTION VECTOR - SwiftShader is bot indicator)
    // REMOVED: --disable-accelerated-2d-canvas (suspicious flag)
    // REMOVED: --disable-software-rasterizer (contradicts and is detectable)

    // Enable hardware acceleration for realistic fingerprint
    '--enable-webgl',
    '--enable-accelerated-2d-canvas',

    // Disable features that leak automation
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-popup-blocking',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',

    // Privacy-related (appear more like real user)
    '--disable-client-side-phishing-detection',

    // Prevent WebRTC IP leak
    '--disable-webrtc-hw-encoding',
    '--disable-webrtc-hw-decoding',
    '--enforce-webrtc-ip-permission-check'
  ];

  // Only disable GPU in headless mode (detection vector otherwise)
  if (headless) {
    args.push('--disable-gpu');
  }

  return args;
}

/**
 * Create a stealthy browser instance
 * @param {Object} options - Browser options
 * @param {string} options.stealthLevel - Stealth level: 'standard' or 'maximum' (default: 'standard')
 * @param {boolean} options.headless - Override headless mode (uses stealthLevel if not specified)
 * @param {string} options.userAgent - Specific user agent (random if not specified)
 * @param {Object} options.viewport - Viewport dimensions (random if not specified)
 * @param {string[]} options.excludeEvasions - Stealth evasions to exclude
 * @param {Object} options.logger - Logger instance
 * @returns {Promise<Browser>} Puppeteer browser instance
 */
export async function createStealthBrowser(options = {}) {
  const {
    stealthLevel = DEFAULT_STEALTH_LEVEL,
    headless,
    userAgent = getRandomUserAgent(),
    viewport = getRandomViewport(),
    excludeEvasions = []
  } = options;

  // Ensure logger is valid (null doesn't trigger default in destructuring)
  const logger = options.logger || console;

  // Resolve stealth level configuration
  const levelConfig = STEALTH_LEVELS[stealthLevel.toUpperCase()] || STEALTH_LEVELS.STANDARD;

  // headless parameter overrides stealthLevel if explicitly provided
  const useHeadless = headless !== undefined ? headless : levelConfig.headless;
  const isHeadless = useHeadless === true || useHeadless === 'new';

  // Configure stealth plugin (only needs to be done once)
  configureStealthPlugin({ excludeEvasions });

  logger.info?.('[BrowserStealth] Creating stealth browser', {
    stealthLevel,
    headless: useHeadless,
    viewport,
    userAgentPrefix: userAgent.substring(0, 50) + '...'
  });

  const browser = await puppeteer.launch({
    headless: useHeadless === true ? 'new' : useHeadless,
    args: getStealthLaunchArgs({ userAgent, headless: isHeadless }),
    ignoreDefaultArgs: ['--enable-automation'],
    defaultViewport: {
      width: viewport.width,
      height: viewport.height
    }
  });

  // Store configuration on browser instance for reference
  browser._stealthConfig = {
    stealthLevel,
    headless: useHeadless,
    userAgent,
    viewport,
    createdAt: Date.now()
  };

  logger.info?.('[BrowserStealth] Stealth browser created successfully', {
    stealthLevel,
    headless: useHeadless
  });

  return browser;
}

/**
 * Create a new page with stealth enhancements
 * @param {Browser} browser - Puppeteer browser instance
 * @param {Object} options - Page options
 * @param {string} options.userAgent - Override user agent for this page
 * @param {Object} options.viewport - Override viewport for this page
 * @param {Object} options.logger - Logger instance
 * @returns {Promise<Page>} Puppeteer page instance
 */
export async function createStealthPage(browser, options = {}) {
  const {
    userAgent = browser._stealthConfig?.userAgent || getRandomUserAgent(),
    viewport = browser._stealthConfig?.viewport || getRandomViewport(),
    maxRetries = 3
  } = options;

  // Ensure logger is valid (null doesn't trigger default in destructuring)
  const logger = options.logger || console;

  let page;
  let lastError;

  // Retry page creation to handle race conditions with stealth plugin
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      page = await browser.newPage();

      // Give stealth plugin more time to apply evasions
      // puppeteer-extra-plugin-stealth has timing issues with newer puppeteer versions
      await new Promise(resolve => setTimeout(resolve, 300));

      // Wait for page to be ready (handles "Requesting main frame too early" issue)
      try {
        await page.waitForFunction(() => true, { timeout: 2000 });
      } catch (frameError) {
        // Ignore frame timing errors - page may still work
        logger.warn?.('[BrowserStealth] Frame wait warning (non-fatal):', frameError.message);
      }

      // Verify page is still open
      if (page.isClosed()) {
        throw new Error('Page closed during stealth setup');
      }

      break; // Success
    } catch (error) {
      lastError = error;
      const isRetryableError = error.message?.includes('Session closed') ||
                               error.message?.includes('Target closed') ||
                               error.message?.includes('Protocol error') ||
                               error.message?.includes('Requesting main frame too early') ||
                               error.message?.includes('Connection closed');

      if (isRetryableError && attempt < maxRetries) {
        logger.warn?.(`[BrowserStealth] Page creation failed (attempt ${attempt}/${maxRetries}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 500 * attempt)); // Longer backoff
        continue;
      }

      throw error;
    }
  }

  if (!page) {
    throw lastError || new Error('Failed to create page after retries');
  }

  // Configure page with error handling for race conditions
  try {
    // Check if page is still valid before configuring
    if (page.isClosed()) {
      throw new Error('Page was closed before configuration could complete');
    }

    // Set user agent
    await page.setUserAgent(userAgent);

    // Set viewport
    await page.setViewport({
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: 1,
      hasTouch: false,
      isLandscape: true,
      isMobile: false
    });

    // Set additional headers to appear more human
    // IMPORTANT: Only set headers that are safe for ALL request types (navigation + XHR/fetch)
    // Headers like 'Upgrade-Insecure-Requests' and 'Sec-Fetch-*' are navigation-only
    // and will break CORS preflight checks on API calls if included here!
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9'
      // REMOVED: 'Upgrade-Insecure-Requests' - breaks CORS on API calls
      // REMOVED: 'Sec-Fetch-*' headers - browser sets these automatically and correctly
      // REMOVED: 'Accept-Encoding' - browser handles this
      // REMOVED: 'Accept' - varies by request type, let browser handle it
    });
  } catch (configError) {
    // Close page if it's still open after config error
    try {
      if (!page.isClosed()) await page.close();
    } catch { /* ignore close error */ }

    // Re-throw with context
    const isTargetClosed = configError.message?.includes('Session closed') ||
                           configError.message?.includes('Target closed');
    if (isTargetClosed) {
      throw new Error('Page closed during stealth configuration. Browser may have crashed or been closed externally.');
    }
    throw configError;
  }

  // Override navigator properties that stealth might miss
  await page.evaluateOnNewDocument(() => {
    // Override webdriver - multiple approaches for maximum coverage
    Object.defineProperty(navigator, 'webdriver', {
      get: () => false,  // Return false instead of undefined (more realistic)
      configurable: true
    });

    // Also delete it if it exists
    try {
      delete navigator.webdriver;
    } catch (e) { /* ignore */ }

    // Add missing navigator.connection (NetworkInformation API) - sites check this!
    if (!navigator.connection) {
      Object.defineProperty(navigator, 'connection', {
        get: () => ({
          effectiveType: '4g',
          rtt: 50,
          downlink: 10,
          saveData: false,
          type: 'wifi',
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => true
        }),
        configurable: true
      });
    }

    // Add navigator.deviceMemory (sites check this for fingerprinting)
    if (!navigator.deviceMemory) {
      Object.defineProperty(navigator, 'deviceMemory', {
        get: () => 8,  // 8GB - common value
        configurable: true
      });
    }

    // Add navigator.getBattery (some sites check this exists)
    if (!navigator.getBattery) {
      navigator.getBattery = () => Promise.resolve({
        charging: true,
        chargingTime: 0,
        dischargingTime: Infinity,
        level: 1,
        addEventListener: () => {},
        removeEventListener: () => {}
      });
    }

    // Override Notification.permission (sites check this)
    try {
      Object.defineProperty(Notification, 'permission', {
        get: () => 'default',
        configurable: true
      });
    } catch (e) { /* ignore */ }

    // Override plugins with realistic plugin array
    const mockPlugins = [
      {
        name: 'Chrome PDF Plugin',
        filename: 'internal-pdf-viewer',
        description: 'Portable Document Format',
        length: 1,
        item: () => null,
        namedItem: () => null,
        [Symbol.iterator]: function* () { yield this; }
      },
      {
        name: 'Chrome PDF Viewer',
        filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai',
        description: '',
        length: 1,
        item: () => null,
        namedItem: () => null,
        [Symbol.iterator]: function* () { yield this; }
      },
      {
        name: 'Native Client',
        filename: 'internal-nacl-plugin',
        description: '',
        length: 2,
        item: () => null,
        namedItem: () => null,
        [Symbol.iterator]: function* () { yield this; }
      }
    ];

    Object.defineProperty(navigator, 'plugins', {
      get: () => {
        const plugins = mockPlugins;
        plugins.item = (i) => plugins[i] || null;
        plugins.namedItem = (name) => plugins.find(p => p.name === name) || null;
        plugins.refresh = () => {};
        return plugins;
      }
    });

    // Override mimeTypes
    Object.defineProperty(navigator, 'mimeTypes', {
      get: () => {
        const mimeTypes = [
          { type: 'application/pdf', suffixes: 'pdf', description: 'Portable Document Format' },
          { type: 'application/x-google-chrome-pdf', suffixes: 'pdf', description: 'Portable Document Format' }
        ];
        mimeTypes.item = (i) => mimeTypes[i] || null;
        mimeTypes.namedItem = (name) => mimeTypes.find(m => m.type === name) || null;
        return mimeTypes;
      }
    });

    // Override languages
    Object.defineProperty(navigator, 'languages', {
      get: () => ['en-US', 'en']
    });

    // Override permissions query
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) => (
      parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
    );

    // Enhanced WebGL vendor/renderer spoofing
    const spoofWebGL = (target) => {
      const getParameter = target.prototype.getParameter;
      target.prototype.getParameter = function(parameter) {
        // UNMASKED_VENDOR_WEBGL
        if (parameter === 37445) {
          return 'Intel Inc.';
        }
        // UNMASKED_RENDERER_WEBGL
        if (parameter === 37446) {
          return 'Intel Iris OpenGL Engine';
        }
        return getParameter.call(this, parameter);
      };
    };

    // Apply to both WebGL contexts
    if (typeof WebGLRenderingContext !== 'undefined') {
      spoofWebGL(WebGLRenderingContext);
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      spoofWebGL(WebGL2RenderingContext);
    }

    // Hide automation-related properties (CDP detection)
    const automationProps = [
      'cdc_adoQpoasnfa76pfcZLmcfl_Array',
      'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
      'cdc_adoQpoasnfa76pfcZLmcfl_Symbol',
      '__webdriver_evaluate',
      '__selenium_evaluate',
      '__webdriver_script_function',
      '__webdriver_script_func',
      '__webdriver_script_fn',
      '__fxdriver_evaluate',
      '__driver_unwrapped',
      '__webdriver_unwrapped',
      '__driver_evaluate',
      '__selenium_unwrapped',
      '__fxdriver_unwrapped'
    ];

    automationProps.forEach(prop => {
      try {
        delete window[prop];
      } catch (e) { /* ignore */ }
    });

    // Override chrome runtime with more complete implementation
    window.chrome = {
      runtime: {
        id: undefined,
        onConnect: { addListener: () => {} },
        onMessage: { addListener: () => {} },
        sendMessage: () => {},
        connect: () => ({ postMessage: () => {}, onMessage: { addListener: () => {} } })
      },
      loadTimes: function() {
        return {
          commitLoadTime: Date.now() / 1000,
          connectionInfo: 'http/1.1',
          finishDocumentLoadTime: Date.now() / 1000,
          finishLoadTime: Date.now() / 1000,
          firstPaintAfterLoadTime: 0,
          firstPaintTime: Date.now() / 1000,
          navigationType: 'Other',
          npnNegotiatedProtocol: 'unknown',
          requestTime: Date.now() / 1000,
          startLoadTime: Date.now() / 1000,
          wasAlternateProtocolAvailable: false,
          wasFetchedViaSpdy: false,
          wasNpnNegotiated: false
        };
      },
      csi: function() {
        return {
          onloadT: Date.now(),
          pageT: Date.now() - performance.timing.navigationStart,
          startE: performance.timing.navigationStart,
          tran: 15
        };
      },
      app: {
        isInstalled: false,
        InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' },
        RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' }
      }
    };

    // Prevent iframe detection
    try {
      Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
        get: function() {
          return this._contentWindow || null;
        }
      });
    } catch (e) { /* ignore */ }
  });

  // Store page configuration
  page._stealthConfig = {
    userAgent,
    viewport,
    createdAt: Date.now()
  };

  logger.info?.('[BrowserStealth] Stealth page created');

  return page;
}

/**
 * Check if a browser instance has stealth configuration
 * @param {Browser} browser - Puppeteer browser instance
 * @returns {boolean} True if stealth configured
 */
export function isStealthBrowser(browser) {
  return !!browser._stealthConfig;
}

/**
 * Get stealth configuration from browser or page
 * @param {Browser|Page} instance - Browser or page instance
 * @returns {Object|null} Stealth configuration or null
 */
export function getStealthConfig(instance) {
  return instance._stealthConfig || null;
}

// Re-export stealth levels for convenience
export { STEALTH_LEVELS, DEFAULT_STEALTH_LEVEL };

export default {
  createStealthBrowser,
  createStealthPage,
  getRandomUserAgent,
  getRandomViewport,
  getStealthLaunchArgs,
  isStealthBrowser,
  getStealthConfig,
  STEALTH_LEVELS,
  DEFAULT_STEALTH_LEVEL
};
