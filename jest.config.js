/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  transform: {},

  // Test discovery
  testMatch: [
    '<rootDir>/src/**/__tests__/**/*.test.js',
    '<rootDir>/src/**/*.test.js'
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/web-ui/',
    '/dist/'
  ],

  // Coverage
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.test.js',
    '!src/**/__tests__/**',
    '!src/**/__test-utils__/**',
    // Exclude UI components (React/Ink — need jsdom/React Testing Library)
    '!src/interfaces/terminal/components/**',
    '!src/interfaces/terminal/state/**',
    '!src/interfaces/terminal/utils/**',
    '!src/interfaces/terminal/config/**',
    '!src/interfaces/terminal/api/**',
    '!src/interfaces/terminal/index.js',
    // Exclude heavy external-dep files (Puppeteer, WhatsApp, Telegram, etc.)
    '!src/tools/webTool.js',
    '!src/tools/visionTool.js',
    '!src/tools/videoTool.js',
    '!src/tools/whatsappTool.js',
    '!src/tools/imageTool.js',
    '!src/tools/visualEditorTool.js',
    '!src/services/webServer.js',
    '!src/services/visualEditorServer.js',
    '!src/services/visualEditorBridge.js',
    '!src/services/telegramService.js',
    '!src/services/whatsappService.js',
    '!src/services/ollamaService.js',
    '!src/interfaces/webServer.js',
    '!src/interfaces/cli.js',
    // Exclude browser stealth (Puppeteer anti-detection — tested via webTool e2e)
    '!src/utilities/browserStealth.js',
    '!src/utilities/humanBehavior.js',
    '!src/utilities/stealthConstants.js',
    // Exclude main entry point (integration-level)
    '!src/index.js',
    // Exclude AI service (requires Anthropic SDK/API)
    '!src/services/aiService.js',
    // Exclude file explorer module (Express routes — need supertest integration)
    '!src/modules/fileExplorer/**'
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'text-summary', 'lcov', 'json-summary', 'clover'],

  // Reporters
  reporters: ['default'],

  // Projects (unit vs e2e separation)
  projects: [
    {
      displayName: 'unit',
      testEnvironment: 'node',
      transform: {},
      testMatch: [
        '<rootDir>/src/**/__tests__/**/*.test.js',
        '<rootDir>/src/**/*.test.js'
      ],
      // webTool.unit.test.js was historically ignored because WebTool's
      // setInterval cleanup timer kept jest workers from exiting. Fixed
      // by calling unref() on the timer in webTool.js — the file now
      // runs cleanly under the unit project.
      testPathIgnorePatterns: [
        '/node_modules/',
        '/web-ui/',
        '/dist/',
        '\\.e2e\\.test\\.js$'
      ]
    },
    {
      displayName: 'e2e',
      testEnvironment: 'node',
      transform: {},
      testMatch: [
        '<rootDir>/src/**/*.e2e.test.js'
      ],
      testPathIgnorePatterns: [
        '/node_modules/',
        '/web-ui/',
        '/dist/'
      ]
    }
  ],

  // Timeouts
  testTimeout: 30000,

  // Global setup/teardown
  globalSetup: '<rootDir>/src/__test-utils__/globalSetup.js',
  globalTeardown: '<rootDir>/src/__test-utils__/globalTeardown.js'
};
