/**
 * Stealth Browser Configuration Constants
 *
 * Centralized configuration for browser stealth, human-like behavior,
 * and credential management. No magic numbers - all values documented.
 */

/**
 * Browser launch configuration
 */
export const BROWSER_CONFIG = {
  // Headless mode - 'new' uses Chrome's native headless mode (harder to detect)
  HEADLESS_MODE: 'new',

  // Default viewport dimensions (common desktop resolution)
  DEFAULT_VIEWPORT: {
    WIDTH: 1920,
    HEIGHT: 1080
  },

  // Viewport variations for randomization
  VIEWPORT_VARIANTS: [
    { width: 1920, height: 1080 },  // Full HD (most common)
    { width: 1366, height: 768 },   // HD (laptops)
    { width: 1536, height: 864 },   // HD+ (scaled)
    { width: 1440, height: 900 },   // WXGA+ (MacBook)
    { width: 1680, height: 1050 },  // WSXGA+
  ],

  // Page load timeout in milliseconds
  DEFAULT_TIMEOUT_MS: 60000,

  // Navigation wait condition
  // 'domcontentloaded' - returns when HTML is parsed (fast, works on all pages)
  // 'networkidle2' - waits for ≤2 connections for 500ms (slow, hangs on websocket/polling pages)
  WAIT_UNTIL: 'domcontentloaded'
};

/**
 * Stealth levels for browser automation
 * Controls the tradeoff between detectability and user experience
 */
export const STEALTH_LEVELS = {
  // Standard: Headless with enhanced evasions (no visible window)
  // Use for: Simple fetches, searches, sites without aggressive bot detection
  // Detection resistance: ~8/10
  STANDARD: {
    id: 'standard',
    headless: 'new',
    description: 'Headless browser with stealth evasions. No visible window.'
  },

  // Maximum: Headful mode (visible Chrome window)
  // Use for: Sites with strong bot detection (LinkedIn, Google, etc.)
  // Detection resistance: 10/10
  MAXIMUM: {
    id: 'maximum',
    headless: false,
    description: 'Visible Chrome window. Use when standard mode gets blocked.'
  }
};

/**
 * Default stealth level
 */
export const DEFAULT_STEALTH_LEVEL = 'standard';

/**
 * User agent strings pool - realistic Chrome versions
 * IMPORTANT: Keep these updated to current Chrome versions (check https://www.whatismybrowser.com/guides/the-latest-version/chrome)
 * Outdated versions are a major bot detection signal!
 */
export const USER_AGENTS = {
  // Windows Chrome variants (Updated January 2026 - Chrome 131/132)
  WINDOWS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  ],

  // macOS Chrome variants
  MACOS: [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ],

  // Linux Chrome variants
  LINUX: [
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
  ]
};

/**
 * Human-like typing behavior configuration
 */
export const TYPING_CONFIG = {
  // Base delay between keystrokes (milliseconds)
  BASE_DELAY_MS: 50,

  // Maximum additional random delay per keystroke
  RANDOM_DELAY_MAX_MS: 100,

  // Probability of a longer pause (0-1) - simulates thinking
  PAUSE_PROBABILITY: 0.05,

  // Duration of thinking pauses (milliseconds)
  PAUSE_DURATION: {
    MIN_MS: 200,
    MAX_MS: 500
  },

  // Probability of making a typo (0-1) - optional feature
  TYPO_PROBABILITY: 0.02,

  // Delay after fixing a typo
  TYPO_CORRECTION_DELAY_MS: 150
};

/**
 * Human-like mouse movement configuration (ghost-cursor)
 */
export const MOUSE_CONFIG = {
  // Hesitation before clicking (milliseconds)
  HESITATE_BEFORE_CLICK: {
    MIN_MS: 50,
    MAX_MS: 200
  },

  // Delay between mousedown and mouseup
  CLICK_DURATION: {
    MIN_MS: 50,
    MAX_MS: 150
  },

  // Delay after moving mouse before action
  MOVE_DELAY: {
    MIN_MS: 0,
    MAX_MS: 100
  },

  // Enable random movement variations
  RANDOMIZE_MOVEMENT: true,

  // Overshoot configuration (move past target then correct)
  OVERSHOOT: {
    ENABLED: true,
    RADIUS: 10,        // pixels
    THRESHOLD: 500     // minimum distance to trigger overshoot
  }
};

/**
 * Action timing delays between browser operations
 */
export const ACTION_DELAYS = {
  // Delay after page navigation before next action
  AFTER_NAVIGATION_MS: {
    MIN: 500,
    MAX: 1500
  },

  // Delay between sequential actions (click, type, etc.)
  BETWEEN_ACTIONS_MS: {
    MIN: 100,
    MAX: 500
  },

  // Delay before submitting a form (simulate review)
  BEFORE_SUBMIT_MS: {
    MIN: 300,
    MAX: 800
  },

  // Delay after form submission (wait for response)
  AFTER_SUBMIT_MS: {
    MIN: 1000,
    MAX: 2000
  },

  // Scroll pause duration
  SCROLL_PAUSE_MS: {
    MIN: 200,
    MAX: 600
  }
};

/**
 * Stealth plugin configuration
 * Controls which evasion modules are enabled
 */
export const STEALTH_EVASIONS = {
  // Core evasions (always enabled)
  CORE: [
    'chrome.app',
    'chrome.csi',
    'chrome.loadTimes',
    'chrome.runtime',
    'navigator.webdriver',
    'navigator.plugins',
    'navigator.languages',
    'navigator.permissions',
    'navigator.hardwareConcurrency',
    'webgl.vendor',
    'window.outerdimensions'
  ],

  // Optional evasions (can be disabled for performance)
  OPTIONAL: [
    'defaultArgs',
    'iframe.contentWindow',
    'media.codecs',
    'sourceurl',
    'user-agent-override'
  ],

  // Evasions to exclude (if causing issues)
  EXCLUDE: []
};

/**
 * Credential vault configuration
 */
export const CREDENTIAL_CONFIG = {
  // Encryption algorithm
  ENCRYPTION_ALGORITHM: 'aes-256-gcm',

  // Key derivation iterations (higher = more secure but slower)
  KEY_DERIVATION_ITERATIONS: 100000,

  // Salt length in bytes
  SALT_LENGTH: 32,

  // IV length in bytes for AES-GCM
  IV_LENGTH: 16,

  // Auth tag length in bytes
  AUTH_TAG_LENGTH: 16,

  // Session cookie expiry (milliseconds) - 7 days
  SESSION_EXPIRY_MS: 7 * 24 * 60 * 60 * 1000,

  // Credential request timeout (milliseconds) - 5 minutes
  REQUEST_TIMEOUT_MS: 5 * 60 * 1000,

  // Storage file names
  STORAGE: {
    CREDENTIALS_FILE: 'credentials.enc',
    SESSIONS_FILE: 'sessions.enc',
    SETTINGS_DIR: 'settings'
  }
};

/**
 * Known login page patterns for common sites
 * Used for auto-detection and form filling
 */
export const KNOWN_SITES = {
  linkedin: {
    name: 'LinkedIn',
    loginUrl: 'https://www.linkedin.com/login',
    selectors: {
      username: '#username',
      password: '#password',
      submit: 'button[type="submit"]',
      loginSuccess: '.global-nav',
      loginError: '.form__label--error, #error-for-username, #error-for-password'
    },
    usernameType: 'email'
  },
  github: {
    name: 'GitHub',
    loginUrl: 'https://github.com/login',
    selectors: {
      username: '#login_field',
      password: '#password',
      submit: 'input[type="submit"]',
      loginSuccess: '.AppHeader-user',
      loginError: '.flash-error'
    },
    usernameType: 'username_or_email'
  },
  google: {
    name: 'Google',
    loginUrl: 'https://accounts.google.com/signin',
    selectors: {
      username: 'input[type="email"]',
      password: 'input[type="password"]',
      submitEmail: '#identifierNext',
      submitPassword: '#passwordNext',
      loginSuccess: '[data-ogsr-up]',
      loginError: '[aria-live="assertive"]'
    },
    usernameType: 'email',
    multiStep: true  // Google uses multi-step login
  },
  twitter: {
    name: 'Twitter/X',
    loginUrl: 'https://twitter.com/i/flow/login',
    selectors: {
      username: 'input[autocomplete="username"]',
      password: 'input[autocomplete="current-password"]',
      submit: '[data-testid="LoginForm_Login_Button"]',
      loginSuccess: '[data-testid="primaryColumn"]',
      loginError: '[data-testid="toast"]'
    },
    usernameType: 'username_or_email'
  }
};

/**
 * WebSocket event types for credential flow
 */
export const CREDENTIAL_EVENTS = {
  // Server -> Client: Request credentials
  REQUEST: 'credential_request',

  // Client -> Server: Submit credentials
  RESPONSE: 'credential_response',

  // Server -> Client: Login result
  RESULT: 'credential_result',

  // Client -> Server: Cancel request
  CANCEL: 'credential_cancel',

  // Server -> Client: Request timeout
  TIMEOUT: 'credential_timeout'
};

/**
 * Common login form field patterns for auto-detection
 */
export const LOGIN_FIELD_PATTERNS = {
  USERNAME: [
    'input[type="email"]',
    'input[name="email"]',
    'input[name="username"]',
    'input[name="login"]',
    'input[name="user"]',
    'input[id*="email"]',
    'input[id*="username"]',
    'input[id*="login"]',
    'input[autocomplete="email"]',
    'input[autocomplete="username"]'
  ],
  PASSWORD: [
    'input[type="password"]',
    'input[name="password"]',
    'input[name="pass"]',
    'input[id*="password"]',
    'input[autocomplete="current-password"]'
  ],
  SUBMIT: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button:contains("Log in")',
    'button:contains("Sign in")',
    'button:contains("Login")',
    '[data-testid*="login"]',
    '[data-testid*="signin"]'
  ]
};

export default {
  BROWSER_CONFIG,
  USER_AGENTS,
  TYPING_CONFIG,
  MOUSE_CONFIG,
  ACTION_DELAYS,
  STEALTH_EVASIONS,
  CREDENTIAL_CONFIG,
  KNOWN_SITES,
  CREDENTIAL_EVENTS,
  LOGIN_FIELD_PATTERNS
};
