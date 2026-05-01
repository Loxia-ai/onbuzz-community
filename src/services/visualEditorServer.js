/**
 * Visual Editor Server
 *
 * Runs on port 4000 and provides:
 * - Health check endpoint
 * - Editor HTML page for iframe embedding
 * - Proxy to user's running app
 * - WebSocket for backend bridge communication
 * - Element picker overlay injection
 */

import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import { WebSocketServer } from 'ws';
import path from 'path';
import { fileURLToPath } from 'url';
import { Transform } from 'stream';
import https from 'https';
import http from 'http';
import zlib from 'zlib';

// Import service registry for port allocation and registration
import registry, { findFreePort } from './serviceRegistry.js';

// Lazy getter for bridge to avoid circular dependency
// (visualEditorBridge imports from this file)
let bridgeGetter = null;
function setBridgeGetter(getter) {
  bridgeGetter = getter;
}
function getBridge() {
  if (!bridgeGetter) {
    // Fallback: try dynamic import (async, only for initialization)
    return null;
  }
  return bridgeGetter();
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Service name for registry
const SERVICE_NAME = 'visualEditor';

// Config manager reference (set when initialized from main app)
let configManagerRef = null;

/**
 * Set the config manager reference for reading configuration
 * @param {ConfigManager} configManager - The config manager instance
 */
export function setConfigManager(configManager) {
  configManagerRef = configManager;
}

/**
 * Get configuration value with fallback chain:
 * 1. Config manager (from config file)
 * 2. Environment variable
 * 3. Default value
 */
function getConfigValue(configPath, envVar, defaultValue) {
  // Try config manager first
  if (configManagerRef) {
    const configValue = configManagerRef.get(configPath);
    if (configValue !== undefined) {
      return configValue;
    }
  }

  // Try environment variable
  const envValue = process.env[envVar];
  if (envValue !== undefined) {
    // Parse numbers
    if (typeof defaultValue === 'number') {
      const parsed = parseInt(envValue, 10);
      if (!isNaN(parsed)) return parsed;
    }
    return envValue;
  }

  // Return default
  return defaultValue;
}

// Hard-coded fallback defaults (used only when nothing else is configured)
const FALLBACK_PORT = 4000;
const FALLBACK_APP_URL = 'http://localhost:3000';

/**
 * Get the configured port (evaluated at runtime, not module load)
 * @returns {number}
 */
function getDefaultPort() {
  return getConfigValue('visualEditor.port', 'LOXIA_VISUAL_EDITOR_PORT', FALLBACK_PORT);
}

/**
 * Get the configured default app URL (evaluated at runtime)
 * @returns {string}
 */
function getDefaultAppUrl() {
  return getConfigValue('visualEditor.defaultAppUrl', 'LOXIA_DEFAULT_APP_URL', FALLBACK_APP_URL);
}

/**
 * Visual Editor Server class
 */
class VisualEditorServer {
  /**
   * @param {Object} config - Configuration options
   * @param {number} config.port - Server port (default: 4000)
   * @param {Object} config.logger - Logger instance
   */
  constructor(config = {}) {
    this.port = config.port || getDefaultPort();
    this.logger = config.logger || console;
    this.server = null;
    this.wss = null;
    this.app = null;
    this.isRunning = false;

    // Track active connections
    this.wsConnections = new Map(); // agentId -> WebSocket
    this.activeAppUrls = new Map(); // agentId -> appUrl
    this.staticDirs = new Map();    // agentId -> directory path for static serving
  }

  /**
   * Register a static directory to serve for an agent
   * @param {string} agentId - Agent identifier
   * @param {string} directory - Directory path to serve
   */
  registerStaticDir(agentId, directory) {
    this.staticDirs.set(agentId, directory);
    this.logger.info?.(`[VisualEditorServer] Registered static dir for ${agentId}: ${directory}`) ||
      console.log(`[VisualEditorServer] Registered static dir for ${agentId}: ${directory}`);
  }

  /**
   * Unregister a static directory
   * @param {string} agentId - Agent identifier
   */
  unregisterStaticDir(agentId) {
    this.staticDirs.delete(agentId);
  }

  /**
   * Start the Visual Editor Server
   * Uses findFreePort to handle port conflicts and registers with service registry
   * @returns {Promise<Object>} Start result
   */
  async start() {
    if (this.isRunning) {
      return { success: true, port: this.port, message: 'Already running' };
    }

    // Find a free port by checking on 0.0.0.0 (matching the actual bind address)
    const preferredPort = this.port;
    try {
      const actualPort = await findFreePort(preferredPort, 100, '0.0.0.0');

      if (actualPort !== preferredPort) {
        this.logger.info?.(`[VisualEditorServer] Port ${preferredPort} taken, using ${actualPort}`) ||
          console.log(`[VisualEditorServer] Port ${preferredPort} taken, using ${actualPort}`);
        this.port = actualPort;
      }
    } catch (err) {
      this.logger.error?.(`[VisualEditorServer] Could not find free port: ${err.message}`);
      throw err;
    }

    return this._tryListen(this.port, 10);
  }

  /**
   * Try to listen on a port, retrying on EADDRINUSE up to maxRetries times.
   * Handles the TOCTOU race between findFreePort and actual listen().
   */
  async _tryListen(port, maxRetries) {
    this.port = port;
    this.app = express();
    this._setupMiddleware();
    this._setupRoutes();

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(this.port, '0.0.0.0', () => {
        this.isRunning = true;
        this._setupWebSocketServer();

        // Register with service registry
        registry.register(SERVICE_NAME, {
          port: this.port,
          host: 'localhost',
          protocol: 'http',
          metadata: {
            wsPath: '/ws',
            startedAt: Date.now()
          }
        });

        this.logger.info?.(`[VisualEditorServer] Running on port ${this.port}`) ||
          console.log(`[VisualEditorServer] Running on port ${this.port}`);

        resolve({ success: true, port: this.port });
      });

      this.server.on('error', (err) => {
        if (err.code === 'EADDRINUSE' && maxRetries > 0) {
          const nextPort = this.port + 1;
          this.logger.info?.(`[VisualEditorServer] Port ${this.port} in use, trying ${nextPort}...`) ||
            console.log(`[VisualEditorServer] Port ${this.port} in use, trying ${nextPort}...`);
          // Clean up and retry on next port
          try { this.server.close(); } catch {}
          this.app = null;
          this.server = null;
          resolve(this._tryListen(nextPort, maxRetries - 1));
        } else {
          this.logger.error?.(`[VisualEditorServer] Server error: ${err.message}`);
          reject(err);
        }
      });
    });
  }

  /**
   * Stop the Visual Editor Server
   * @returns {Promise<void>}
   */
  async stop() {
    if (!this.isRunning) return;

    // Unregister from service registry
    registry.unregister(SERVICE_NAME);

    // Close all WebSocket connections
    for (const [agentId, ws] of this.wsConnections.entries()) {
      try {
        ws.close(1000, 'Server shutting down');
      } catch (err) {
        // Ignore
      }
    }
    this.wsConnections.clear();
    this.activeAppUrls.clear();

    // Close WebSocket server
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }

    // Close HTTP server — force-close keep-alive connections
    return new Promise((resolve) => {
      if (this.server) {
        if (typeof this.server.closeAllConnections === 'function') {
          this.server.closeAllConnections();
        }
        this.server.close(() => {
          this.isRunning = false;
          this.server = null;
          this.logger.info?.('[VisualEditorServer] Stopped') ||
            console.log('[VisualEditorServer] Stopped');
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get server status
   * @returns {Object} Status info
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      port: this.port,
      activeConnections: this.wsConnections.size,
      connectedAgents: Array.from(this.wsConnections.keys())
    };
  }

  /**
   * Register an app URL for an agent
   * @param {string} agentId - Agent identifier
   * @param {string} appUrl - User's app URL
   */
  registerAppUrl(agentId, appUrl) {
    this.activeAppUrls.set(agentId, appUrl);
  }

  /**
   * Unregister an agent's app URL
   * @param {string} agentId - Agent identifier
   */
  unregisterAppUrl(agentId) {
    this.activeAppUrls.delete(agentId);
  }

  /**
   * Send message to a specific agent's WebSocket
   * @param {string} agentId - Agent identifier
   * @param {Object} message - Message to send
   * @returns {boolean} Success
   */
  sendToAgent(agentId, message) {
    const ws = this.wsConnections.get(agentId);
    if (ws && ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(JSON.stringify(message));
        return true;
      } catch (err) {
        this.logger.error?.(`[VisualEditorServer] Failed to send to agent ${agentId}:`, err);
      }
    }
    return false;
  }

  /**
   * Set up Express middleware
   * @private
   */
  _setupMiddleware() {
    // Request logging for debugging
    this.app.use((req, res, next) => {
      this.logger.debug?.(`[VisualEditorServer] ${req.method} ${req.url}`);
      next();
    });

    // CORS for cross-origin requests
    this.app.use((req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.header('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
      }
      next();
    });

    // Parse JSON bodies
    this.app.use(express.json());
  }

  /**
   * Set up Express routes
   * @private
   */
  _setupRoutes() {
    // Health check endpoint
    this.app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: Date.now(),
        connections: this.wsConnections.size
      });
    });

    // Test proxy connectivity endpoint (for debugging)
    this.app.get('/test-proxy', async (req, res) => {
      const targetUrl = req.query.url || 'https://httpbin.org/html';
      this.logger.info?.(`[VisualEditorServer] Testing connectivity to: ${targetUrl}`);

      try {
        const parsed = new URL(targetUrl);
        const isHttps = parsed.protocol === 'https:';
        const httpModule = isHttps ? https : http;

        const result = await new Promise((resolve, reject) => {
          const reqOptions = {
            hostname: parsed.hostname,
            port: parsed.port || (isHttps ? 443 : 80),
            path: parsed.pathname + parsed.search,
            method: 'HEAD',  // Just check connectivity, don't download content
            timeout: 10000,
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0'
            },
            rejectUnauthorized: false  // Allow self-signed certs
          };

          const request = httpModule.request(reqOptions, (response) => {
            resolve({
              success: true,
              url: targetUrl,
              status: response.statusCode,
              statusText: response.statusMessage,
              contentType: response.headers['content-type']
            });
          });

          request.on('timeout', () => {
            request.destroy();
            reject(new Error('Connection timed out after 10s'));
          });

          request.on('error', reject);
          request.end();
        });

        res.json(result);
      } catch (err) {
        this.logger.error?.(`[VisualEditorServer] Test connectivity failed:`, err.message);
        res.json({
          success: false,
          url: targetUrl,
          error: err.message,
          code: err.code || 'UNKNOWN'
        });
      }
    });

    // Main editor page (served in iframe)
    this.app.get('/', (req, res) => {
      const { agentId, appUrl } = req.query;

      if (!agentId) {
        return res.status(400).send('Missing agentId parameter');
      }

      const targetUrl = appUrl || this.activeAppUrls.get(agentId) || getDefaultAppUrl();
      const html = this._generateEditorHtml(agentId, targetUrl);
      res.type('html').send(html);
    });

    // Serve overlay script
    this.app.get('/overlay.js', (req, res) => {
      const overlayScript = this._getOverlayScript();
      res.type('application/javascript').send(overlayScript);
    });

    // Serve static files for agents (for static HTML projects)
    this.app.use('/static/:agentId', (req, res, next) => {
      const { agentId } = req.params;
      const staticDir = this.staticDirs.get(agentId);

      if (!staticDir) {
        return res.status(404).json({
          error: 'No static directory registered for this agent',
          agentId
        });
      }

      // Create static middleware for this directory
      const staticMiddleware = express.static(staticDir, {
        index: ['index.html', 'index.htm'],
        extensions: ['html', 'htm']
      });

      // Inject overlay script into HTML files
      const originalSend = res.send.bind(res);
      res.send = (body) => {
        if (typeof body === 'string' && body.includes('</body>')) {
          // Inject overlay script before </body>
          const overlayScript = `<script src="/overlay.js"></script>`;
          body = body.replace('</body>', `${overlayScript}</body>`);
        }
        return originalSend(body);
      };

      staticMiddleware(req, res, next);
    });

    // Proxy to user's app with overlay injection
    // Wrap in error handler to catch any proxy initialization errors
    const proxyMiddleware = this._createProxyMiddleware();
    this.app.use('/app', (req, res, next) => {
      try {
        proxyMiddleware(req, res, next);
      } catch (err) {
        this.logger.error?.(`[VisualEditorServer] Proxy middleware error:`, err.message);
        res.status(502).type('html').send(this._generateErrorHtml(
          req.query.target || 'unknown',
          `Proxy error: ${err.message}`
        ));
      }
    });

    // 404 catch-all - log and return helpful message
    this.app.use((req, res) => {
      this.logger.warn?.(`[VisualEditorServer] 404: ${req.method} ${req.url}`);
      res.status(404).json({
        error: 'Not found',
        path: req.url,
        hint: 'Use /app?target=URL to proxy to a website'
      });
    });

    // Express error handler - catches uncaught errors
    this.app.use((err, req, res, next) => {
      this.logger.error?.(`[VisualEditorServer] Express error:`, err.message);
      if (!res.headersSent) {
        res.status(500).type('html').send(this._generateErrorHtml(
          req.query?.target || req.url,
          `Server error: ${err.message}`
        ));
      }
    });
  }

  /**
   * Create proxy middleware for user's app
   * Uses router option for dynamic target selection based on query param
   * @private
   */
  _createProxyMiddleware() {
    const self = this;

    // Store current target URL for use in callbacks
    let currentTargetUrl = getDefaultAppUrl();

    // http-proxy-middleware v3.x uses 'on' property for event handlers
    return createProxyMiddleware({
      // Use router for dynamic target based on query parameter
      router: (req) => {
        const targetUrl = req.query.target || getDefaultAppUrl();
        currentTargetUrl = targetUrl;  // Store for use in callbacks

        // Validate URL
        try {
          const parsed = new URL(targetUrl);
          self.logger.info?.(`[VisualEditorServer] Proxying to: ${parsed.origin}`);
          return parsed.origin;  // Return just the origin (protocol + host + port)
        } catch (err) {
          self.logger.error?.(`[VisualEditorServer] Invalid target URL: ${targetUrl}`);
          return getDefaultAppUrl();  // Fallback to default
        }
      },
      changeOrigin: true,
      selfHandleResponse: true, // We'll handle response to inject script
      secure: false,            // Don't validate SSL certificates (needed for dev servers)
      followRedirects: true,    // Follow redirects
      proxyTimeout: 30000,      // 30 second proxy timeout
      timeout: 30000,           // 30 second request timeout
      pathRewrite: (path, req) => {
        // Get the path from the target URL and append request path
        const targetUrl = req.query.target || getDefaultAppUrl();
        try {
          const parsed = new URL(targetUrl);
          // Start with the path from target URL
          let newPath = parsed.pathname;
          if (newPath === '/') newPath = '';

          // Parse current request path and remove /app and query params
          const reqUrl = new URL(path, 'http://localhost');
          reqUrl.searchParams.delete('target');
          const reqPath = reqUrl.pathname.replace(/^\/app\/?/, '/');

          // Combine paths (avoid double slashes)
          const finalPath = newPath + (reqPath === '/' ? '' : reqPath) + reqUrl.search;
          self.logger.debug?.(`[VisualEditorServer] Path rewrite: ${path} -> ${finalPath || '/'}`);
          return finalPath || '/';
        } catch (e) {
          return '/';
        }
      },
      // v3.x event handlers using 'on' property
      on: {
        proxyReq: (proxyReq, req, res) => {
          const targetUrl = req.query.target || getDefaultAppUrl();
          self.logger.info?.(`[VisualEditorServer] Proxy request to: ${targetUrl}`);

          // Set browser-like headers to avoid being blocked
          // Wrap in try-catch because headers might already be sent on redirects
          try {
            if (!proxyReq.headersSent) {
              proxyReq.setHeader('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
              proxyReq.setHeader('Accept', 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8');
              proxyReq.setHeader('Accept-Language', 'en-US,en;q=0.9');
              // IMPORTANT: Request uncompressed content - we need to read/modify HTML
              // If we request gzip, we'd need to decompress before injecting the overlay script
              proxyReq.setHeader('Accept-Encoding', 'identity');
              // Remove headers that might cause issues
              proxyReq.removeHeader('x-forwarded-for');
              proxyReq.removeHeader('x-forwarded-host');
              proxyReq.removeHeader('x-forwarded-proto');
            }
          } catch (e) {
            // Headers already sent (e.g., during redirect) - ignore
            self.logger.debug?.(`[VisualEditorServer] Could not set headers: ${e.message}`);
          }
        },
        proxyRes: (proxyRes, req, res) => {
          const targetUrl = req.query.target || currentTargetUrl;
          self._handleProxyResponse(proxyRes, req, res, targetUrl);
        },
        error: (err, req, res) => {
          try {
            const targetUrl = req?.query?.target || currentTargetUrl || 'unknown';

            // Log detailed error information
            self.logger.error?.('[VisualEditorServer] Proxy error:', {
              message: err?.message,
              code: err?.code,
              target: targetUrl,
              url: req?.url
            });

            // Provide more helpful error messages based on error type
            let errorMessage = err?.message || 'Unknown proxy error';
            if (err?.code === 'ECONNREFUSED') {
              errorMessage = `Connection refused - the server at ${targetUrl} is not running or not accepting connections`;
            } else if (err?.code === 'ENOTFOUND') {
              errorMessage = `DNS lookup failed - could not resolve hostname for ${targetUrl}`;
            } else if (err?.code === 'ETIMEDOUT' || err?.code === 'ESOCKETTIMEDOUT') {
              errorMessage = `Connection timed out - the server at ${targetUrl} took too long to respond (30s limit)`;
            } else if (err?.code === 'CERT_HAS_EXPIRED' || err?.code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE') {
              errorMessage = `SSL certificate error for ${targetUrl}. This may be a self-signed certificate issue.`;
            } else if (err?.code === 'ECONNRESET') {
              errorMessage = `Connection was reset by the server at ${targetUrl}`;
            } else if (err?.code === 'HPE_INVALID_CONSTANT') {
              errorMessage = `Invalid response from ${targetUrl} - the server may not be an HTTP server`;
            }

            // Return a user-friendly HTML error page
            if (res && !res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/html' });
              res.end(self._generateErrorHtml(targetUrl, errorMessage));
            }
          } catch (handlerErr) {
            self.logger.error?.('[VisualEditorServer] Error in error handler:', handlerErr);
            // Last resort - try to send a simple error
            try {
              if (res && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('Proxy error: ' + (err?.message || 'Unknown error'));
              }
            } catch (e) {
              // Nothing more we can do
            }
          }
        }
      }
    });
  }

  /**
   * Generate error HTML page for proxy failures
   * @private
   */
  _generateErrorHtml(targetUrl, errorDetails) {
    return `<!DOCTYPE html>
<html>
<head>
  <title>Connection Error - Visual Editor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #f3f4f6;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .error-container {
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      padding: 32px;
      max-width: 500px;
      text-align: center;
    }
    .error-icon {
      width: 64px;
      height: 64px;
      margin: 0 auto 16px;
      background: #fef2f2;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .error-icon svg {
      width: 32px;
      height: 32px;
      color: #ef4444;
    }
    h1 {
      color: #1f2937;
      font-size: 20px;
      margin-bottom: 8px;
    }
    .target-url {
      color: #3b82f6;
      font-family: monospace;
      background: #eff6ff;
      padding: 8px 12px;
      border-radius: 6px;
      margin: 16px 0;
      word-break: break-all;
    }
    .instructions {
      color: #6b7280;
      font-size: 14px;
      line-height: 1.6;
      margin-top: 16px;
    }
    .instructions ol {
      text-align: left;
      padding-left: 20px;
      margin-top: 12px;
    }
    .instructions li {
      margin-bottom: 8px;
    }
    .retry-btn {
      margin-top: 20px;
      padding: 10px 24px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 14px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .retry-btn:hover {
      background: #2563eb;
    }
    .error-details {
      margin-top: 16px;
      padding: 12px;
      background: #fef2f2;
      border-radius: 6px;
      color: #991b1b;
      font-size: 12px;
      font-family: monospace;
    }
  </style>
</head>
<body>
  <div class="error-container">
    <div class="error-icon">
      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>
    </div>
    <h1>Cannot Connect to Your App</h1>
    <div class="target-url">${targetUrl}</div>
    <div class="instructions">
      <p>Make sure your app is running at this address.</p>
      <ol>
        <li>Start your development server (e.g., <code>npm run dev</code>)</li>
        <li>Enter the correct URL in the address bar above</li>
        <li>Click "Go" or retry below</li>
      </ol>
    </div>
    <button class="retry-btn" onclick="location.reload()">Retry Connection</button>
    <div class="error-details">${errorDetails}</div>
  </div>
</body>
</html>`;
  }

  /**
   * Handle proxy response - inject overlay script into HTML
   * @private
   */
  _handleProxyResponse(proxyRes, req, res, targetUrl) {
    const contentType = proxyRes.headers['content-type'] || '';
    const contentEncoding = proxyRes.headers['content-encoding'] || '';

    // Copy headers (skip content-length and content-encoding as we'll modify content)
    Object.keys(proxyRes.headers).forEach(key => {
      const lowerKey = key.toLowerCase();
      if (lowerKey !== 'content-length' && lowerKey !== 'content-encoding') {
        res.setHeader(key, proxyRes.headers[key]);
      }
    });

    res.status(proxyRes.statusCode);

    // Only inject into HTML responses
    if (contentType.includes('text/html')) {
      const chunks = [];

      // Collect all data chunks
      proxyRes.on('data', (chunk) => {
        chunks.push(chunk);
      });

      proxyRes.on('end', () => {
        // Combine chunks into a single buffer
        const buffer = Buffer.concat(chunks);

        // Decompress if needed (some servers ignore Accept-Encoding: identity)
        this._decompressBuffer(buffer, contentEncoding)
          .then(decompressed => {
            const body = decompressed.toString('utf-8');
            // Inject overlay script before </body>
            const injectedHtml = this._injectOverlayScript(body, targetUrl);
            res.send(injectedHtml);
          })
          .catch(err => {
            this.logger.error?.(`[VisualEditorServer] Decompression error: ${err.message}`);
            // Try to send as-is (might be uncompressed despite header)
            try {
              const body = buffer.toString('utf-8');
              const injectedHtml = this._injectOverlayScript(body, targetUrl);
              res.send(injectedHtml);
            } catch (e) {
              res.status(500).send('Error processing response');
            }
          });
      });
    } else {
      // Pass through non-HTML responses
      proxyRes.pipe(res);
    }
  }

  /**
   * Decompress buffer based on content-encoding
   * @private
   */
  async _decompressBuffer(buffer, encoding) {
    if (!encoding || encoding === 'identity') {
      return buffer;
    }

    return new Promise((resolve, reject) => {
      if (encoding === 'gzip') {
        zlib.gunzip(buffer, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      } else if (encoding === 'deflate') {
        zlib.inflate(buffer, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      } else if (encoding === 'br') {
        zlib.brotliDecompress(buffer, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      } else {
        // Unknown encoding, try to use as-is
        resolve(buffer);
      }
    });
  }

  /**
   * Inject overlay script into HTML
   * @private
   */
  _injectOverlayScript(html, targetUrl) {
    // Use ABSOLUTE URL for overlay.js since we inject a <base> tag that would redirect relative paths
    const overlayUrl = `http://localhost:${this.port}/overlay.js`;
    const scriptTag = `
<!-- Loxia Visual Editor Overlay -->
<script src="${overlayUrl}"></script>
`;

    // Add a <base> tag to make relative URLs resolve to the original site
    // This prevents assets (scripts, styles, images) from being requested through our server
    //
    // IMPORTANT: The base href must include the *directory* of the target URL, not just
    // the origin. If the target is http://host/sub/page.html and we set <base href="http://host/">,
    // then a relative <link href="styles.css"> resolves to http://host/styles.css (wrong) instead
    // of http://host/sub/styles.css (correct). We compute the directory portion of the pathname
    // and use that as the base href.
    let baseTag = '';
    try {
      const parsed = new URL(targetUrl);
      // Derive directory: for /sub/page.html -> /sub/, for /sub/ -> /sub/, for / -> /
      let dir = parsed.pathname;
      if (!dir.endsWith('/')) {
        const lastSlash = dir.lastIndexOf('/');
        dir = lastSlash >= 0 ? dir.substring(0, lastSlash + 1) : '/';
      }
      baseTag = `<base href="${parsed.origin}${dir}">`;
    } catch (e) {
      // Invalid URL, skip base tag
    }

    let modifiedHtml = html;

    // Inject base tag right after the opening <head ...> tag (case-insensitive, allows attributes).
    // If there is no <head> at all, synthesize one after <html ...> so we still get a base.
    // If a <base> already exists in the document, rewrite its href — the original would point
    // at the original site path and we want it pointed at our resolved directory instead.
    if (baseTag) {
      const hasBase = /<base\b[^>]*>/i.test(html);
      if (hasBase) {
        // Replace the first <base ...> with our computed one
        modifiedHtml = modifiedHtml.replace(/<base\b[^>]*>/i, baseTag);
      } else {
        const headOpenRe = /<head\b[^>]*>/i;
        if (headOpenRe.test(modifiedHtml)) {
          modifiedHtml = modifiedHtml.replace(headOpenRe, (match) => `${match}${baseTag}`);
        } else {
          const htmlOpenRe = /<html\b[^>]*>/i;
          if (htmlOpenRe.test(modifiedHtml)) {
            modifiedHtml = modifiedHtml.replace(htmlOpenRe, (match) => `${match}<head>${baseTag}</head>`);
          } else {
            // No <html> either — prepend a head block
            modifiedHtml = `<head>${baseTag}</head>${modifiedHtml}`;
          }
        }
      }
    }

    // Inject overlay script before </body> or at end
    if (modifiedHtml.includes('</body>')) {
      return modifiedHtml.replace('</body>', `${scriptTag}</body>`);
    } else if (modifiedHtml.includes('</html>')) {
      return modifiedHtml.replace('</html>', `${scriptTag}</html>`);
    } else {
      return modifiedHtml + scriptTag;
    }
  }

  /**
   * Set up WebSocket server for backend bridge communication
   * @private
   */
  _setupWebSocketServer() {
    this.wss = new WebSocketServer({
      server: this.server,
      path: '/ws'
    });

    this.wss.on('connection', (ws, req) => {
      const url = new URL(req.url, `http://localhost:${this.port}`);
      const agentId = url.searchParams.get('agentId');

      if (!agentId) {
        ws.close(1008, 'Missing agentId');
        return;
      }

      this.logger.info?.(`[VisualEditorServer] WebSocket connected: ${agentId}`);

      // Store connection
      this.wsConnections.set(agentId, ws);

      // Send ready message
      ws.send(JSON.stringify({
        type: 'editor-ready',
        agentId,
        timestamp: Date.now()
      }));

      // Handle incoming messages
      ws.on('message', (data) => {
        this._handleWebSocketMessage(agentId, data, ws);
      });

      // Handle close
      ws.on('close', (code, reason) => {
        this.logger.info?.(`[VisualEditorServer] WebSocket closed: ${agentId} (${code})`);
        this.wsConnections.delete(agentId);
      });

      // Handle errors
      ws.on('error', (err) => {
        this.logger.error?.(`[VisualEditorServer] WebSocket error for ${agentId}:`, err);
      });
    });
  }

  /**
   * Handle incoming WebSocket messages
   * @private
   */
  _handleWebSocketMessage(agentId, data, ws) {
    try {
      const message = JSON.parse(data.toString());

      this.logger.debug?.(`[VisualEditorServer] Message from ${agentId}:`, message.type);

      switch (message.type) {
        case 'element-selected':
          // Forward element selection (already handled by postMessage to web-ui)
          // This is for backend bridge to receive selections
          this._emitElementSelected(agentId, message);
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
          break;

        case 'highlight':
        case 'scroll-to':
        case 'reload':
          // These commands come from backend, forward to any connected editor pages
          // (handled via the editor page's WebSocket connection)
          break;

        case 'subscribe':
          // Agent subscribing to editor events
          if (message.appUrl) {
            this.activeAppUrls.set(agentId, message.appUrl);
          }
          break;

        case 'unsubscribe':
          this.activeAppUrls.delete(agentId);
          break;

        default:
          this.logger.debug?.(`[VisualEditorServer] Unknown message type: ${message.type}`);
      }
    } catch (err) {
      this.logger.error?.('[VisualEditorServer] Invalid WebSocket message:', err);
    }
  }

  /**
   * Emit element selected event (for external listeners)
   * @private
   */
  _emitElementSelected(agentId, message) {
    const elementData = message.data || message;

    this.logger.info?.(`[VisualEditorServer] Element selected for ${agentId}:`, {
      selector: elementData.selector,
      component: elementData.sourceHint?.component
    });

    // Forward to visualEditorBridge so context is available for message injection
    const bridge = getBridge();
    if (bridge && bridge.hasInstance(agentId)) {
      const success = bridge.setVisualContext(agentId, {
        selector: elementData.selector,
        tagName: elementData.tagName,
        text: elementData.text,
        attributes: elementData.attributes,
        boundingRect: elementData.boundingRect,
        sourceHint: elementData.sourceHint,
        computedStyle: elementData.computedStyle
      });

      if (success) {
        this.logger.info?.(`[VisualEditorServer] Visual context synced to bridge for ${agentId}`);
      } else {
        this.logger.warn?.(`[VisualEditorServer] Failed to sync visual context for ${agentId}`);
      }
    } else {
      this.logger.debug?.(`[VisualEditorServer] No bridge instance for ${agentId}, context not synced`);
    }
  }

  /**
   * Generate editor HTML page
   * @private
   */
  _generateEditorHtml(agentId, appUrl) {
    const encodedAppUrl = encodeURIComponent(appUrl);

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Loxia Visual Editor</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; overflow: hidden; }
    body { font-family: system-ui, -apple-system, sans-serif; }

    #app-frame {
      width: 100%;
      height: 100%;
      border: none;
    }

    #loading-overlay {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #f3f4f6;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      transition: opacity 0.3s ease;
    }

    #loading-overlay.hidden {
      opacity: 0;
      pointer-events: none;
    }

    .spinner {
      width: 40px;
      height: 40px;
      border: 3px solid #e5e7eb;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 1s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-text {
      margin-top: 16px;
      color: #6b7280;
      font-size: 14px;
    }

    #error-message {
      display: none;
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background: white;
      padding: 24px;
      border-radius: 8px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
      text-align: center;
      max-width: 400px;
    }

    #error-message h3 {
      color: #ef4444;
      margin-bottom: 8px;
    }

    #error-message p {
      color: #6b7280;
      font-size: 14px;
    }
  </style>
</head>
<body>
  <div id="loading-overlay">
    <div class="spinner"></div>
    <p class="loading-text">Loading preview...</p>
  </div>

  <div id="error-message">
    <h3>Connection Error</h3>
    <p id="error-text">Could not load the preview.</p>
  </div>

  <iframe
    id="app-frame"
    src="/app?target=${encodedAppUrl}"
    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
  ></iframe>

  <script>
    const agentId = '${agentId}';
    const appUrl = '${appUrl}';

    // Hide loading overlay when iframe loads
    const iframe = document.getElementById('app-frame');
    const loadingOverlay = document.getElementById('loading-overlay');
    const errorMessage = document.getElementById('error-message');
    const errorText = document.getElementById('error-text');

    iframe.onload = () => {
      loadingOverlay.classList.add('hidden');

      // Check if the iframe loaded our error page (proxy failure)
      try {
        const iframeDoc = iframe.contentDocument || iframe.contentWindow.document;
        const title = iframeDoc.title || '';
        if (title.includes('Connection Error') || title.includes('Cannot Connect')) {
          // Proxy returned an error page - show error message
          errorText.textContent = 'Could not proxy to ' + appUrl + '. See the error details in the preview.';
          errorMessage.style.display = 'block';
        }
      } catch (e) {
        // Cross-origin - can't check, but that usually means it loaded successfully
        console.log('[Visual Editor] Cross-origin iframe loaded - assuming success');
      }
    };

    iframe.onerror = () => {
      loadingOverlay.classList.add('hidden');
      errorText.textContent = 'Could not connect to ' + appUrl + '. Make sure your app is running.';
      errorMessage.style.display = 'block';
    };

    // Forward messages from app iframe to parent (Loxia Web-UI)
    window.addEventListener('message', (e) => {
      // Only forward element-selected messages
      if (e.data && e.data.type === 'element-selected') {
        // Forward to parent window (Loxia Web-UI)
        window.parent.postMessage(e.data, '*');

        // Also send via WebSocket to backend
        if (window.wsConnection && window.wsConnection.readyState === 1) {
          window.wsConnection.send(JSON.stringify({
            ...e.data,
            agentId
          }));
        }
      }
    });

    // Listen for commands from parent (Loxia Web-UI) or WebSocket
    window.addEventListener('message', (e) => {
      if (e.data && (e.data.type === 'highlight' || e.data.type === 'scroll-to' || e.data.type === 'toggle')) {
        // Forward to app iframe (including toggle for Select/Preview mode switching)
        iframe.contentWindow.postMessage(e.data, '*');
      }
    });

    // Connect to WebSocket for backend communication
    const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = wsProtocol + '//' + location.host + '/ws?agentId=' + agentId;

    function connectWebSocket() {
      window.wsConnection = new WebSocket(wsUrl);

      window.wsConnection.onopen = () => {
        console.log('[Visual Editor] WebSocket connected');
        // Notify parent that editor is ready
        window.parent.postMessage({ type: 'editor-ready' }, '*');
      };

      window.wsConnection.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);

          // Forward commands to app iframe
          if (msg.type === 'highlight' || msg.type === 'scroll-to' || msg.type === 'reload') {
            iframe.contentWindow.postMessage(msg, '*');
          }
        } catch (err) {
          console.error('[Visual Editor] Invalid message:', err);
        }
      };

      window.wsConnection.onerror = (e) => {
        console.error('[Visual Editor] WebSocket error');
        window.parent.postMessage({
          type: 'editor-error',
          data: { message: 'WebSocket connection error' }
        }, '*');
      };

      window.wsConnection.onclose = () => {
        console.log('[Visual Editor] WebSocket closed, reconnecting in 3s...');
        setTimeout(connectWebSocket, 3000);
      };
    }

    connectWebSocket();

    // Handle iframe load timeout (35s to allow proxy's 30s timeout to report actual error)
    setTimeout(() => {
      if (!loadingOverlay.classList.contains('hidden')) {
        loadingOverlay.classList.add('hidden');
        errorText.textContent = 'Preview is taking too long to load. Check if ' + appUrl + ' is accessible and responding.';
        errorMessage.style.display = 'block';
      }
    }, 35000);
  </script>
</body>
</html>`;
  }

  /**
   * Get overlay script for element selection
   * @private
   */
  _getOverlayScript() {
    return `/**
 * Loxia Visual Editor Overlay Script
 * Injected into user's app for element selection
 */
(function() {
  'use strict';

  // Prevent double injection
  if (window.__LOXIA_VISUAL_EDITOR_LOADED__) return;
  window.__LOXIA_VISUAL_EDITOR_LOADED__ = true;

  let isEnabled = true;
  let hoveredElement = null;
  let selectedElement = null;
  let highlightOverlay = null;
  let selectionOverlay = null;
  let tooltip = null;

  // Apply cursor style based on mode
  function updateCursorStyle(enabled) {
    document.body.style.cursor = enabled ? 'crosshair' : '';
  }
  updateCursorStyle(true);

  // Create highlight overlay element (hover)
  function createHighlightOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loxia-highlight-overlay';
    overlay.style.cssText = \`
      position: fixed;
      pointer-events: none;
      background: rgba(59, 130, 246, 0.1);
      border: 2px solid #3b82f6;
      border-radius: 4px;
      z-index: 999998;
      transition: all 0.1s ease;
      display: none;
    \`;
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create selection overlay element (click)
  function createSelectionOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'loxia-selection-overlay';
    overlay.style.cssText = \`
      position: fixed;
      pointer-events: none;
      background: rgba(34, 197, 94, 0.15);
      border: 2px solid #22c55e;
      border-radius: 4px;
      z-index: 999999;
      display: none;
    \`;
    document.body.appendChild(overlay);
    return overlay;
  }

  // Create tooltip for element info
  function createTooltip() {
    const tip = document.createElement('div');
    tip.id = 'loxia-tooltip';
    tip.style.cssText = \`
      position: fixed;
      background: #1f2937;
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 12px;
      font-family: ui-monospace, monospace;
      z-index: 1000000;
      pointer-events: none;
      display: none;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    \`;
    document.body.appendChild(tip);
    return tip;
  }

  // Generate CSS selector for element
  function getSelector(el) {
    if (!el || el === document.body || el === document.documentElement) {
      return el ? el.tagName.toLowerCase() : '';
    }

    // Try ID first
    if (el.id && /^[a-zA-Z][\\w-]*$/.test(el.id)) {
      return '#' + el.id;
    }

    let path = [];
    let current = el;

    while (current && current !== document.body && path.length < 5) {
      let selector = current.tagName.toLowerCase();

      // Add id if available
      if (current.id && /^[a-zA-Z][\\w-]*$/.test(current.id)) {
        path.unshift('#' + current.id);
        break;
      }

      // Add meaningful classes (skip utility classes)
      if (current.className && typeof current.className === 'string') {
        const classes = current.className
          .split(/\\s+/)
          .filter(c => c && c.length > 2 && !c.match(/^(w-|h-|p-|m-|text-|bg-|flex|grid|block|inline)/))
          .slice(0, 2);
        if (classes.length) {
          selector += '.' + classes.join('.');
        }
      }

      // Add nth-child if needed for uniqueness
      const siblings = current.parentElement ?
        Array.from(current.parentElement.children).filter(s => s.tagName === current.tagName) : [];
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        selector += ':nth-child(' + index + ')';
      }

      path.unshift(selector);
      current = current.parentElement;
    }

    return path.join(' > ');
  }

  // Try to get React component info
  function getReactInfo(el) {
    // Look for React fiber
    const fiberKey = Object.keys(el).find(k =>
      k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance')
    );

    if (!fiberKey) return null;

    let fiber = el[fiberKey];
    let depth = 0;
    const maxDepth = 20;

    while (fiber && depth < maxDepth) {
      if (fiber.type && typeof fiber.type === 'function') {
        const name = fiber.type.displayName || fiber.type.name;
        if (name && name !== 'Anonymous' && !name.startsWith('_')) {
          return {
            component: name,
            source: fiber._debugSource || null
          };
        }
      }
      fiber = fiber.return;
      depth++;
    }

    return null;
  }

  // Extract a useful relative path from absolute file path
  function getRelativePath(fullPath) {
    if (!fullPath) return null;

    // Common source folder markers (prioritized)
    const sourceMarkers = ['/src/', '/app/', '/pages/', '/components/', '/lib/', '/utils/'];

    for (const marker of sourceMarkers) {
      const index = fullPath.indexOf(marker);
      if (index !== -1) {
        // Return path starting from the marker (e.g., 'src/components/Button.tsx')
        return fullPath.substring(index + 1);
      }
    }

    // Fallback: return last 3 path segments
    const parts = fullPath.split('/').filter(Boolean);
    if (parts.length <= 3) {
      return parts.join('/');
    }
    return parts.slice(-3).join('/');
  }

  // Get element info for selection
  function getElementInfo(el) {
    const rect = el.getBoundingClientRect();
    const reactInfo = getReactInfo(el);
    const computedStyle = window.getComputedStyle(el);

    return {
      selector: getSelector(el),
      tagName: el.tagName.toLowerCase(),
      text: (el.textContent || '').trim().slice(0, 100),
      attributes: {
        id: el.id || null,
        class: el.className || null,
        href: el.href || null,
        src: el.src || null,
        type: el.type || null,
        name: el.name || null
      },
      boundingRect: {
        top: Math.round(rect.top),
        left: Math.round(rect.left),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      computedStyle: {
        display: computedStyle.display,
        position: computedStyle.position,
        color: computedStyle.color,
        backgroundColor: computedStyle.backgroundColor,
        fontSize: computedStyle.fontSize
      },
      sourceHint: reactInfo ? {
        component: reactInfo.component,
        file: getRelativePath(reactInfo.source?.fileName),
        fullPath: reactInfo.source?.fileName,
        line: reactInfo.source?.lineNumber,
        confidence: reactInfo.source ? 'high' : 'low'
      } : null
    };
  }

  // Position overlay on element
  function positionOverlay(overlay, el) {
    const rect = el.getBoundingClientRect();
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';
  }

  // Handle element selection
  function selectElement(el, event) {
    event.preventDefault();
    event.stopPropagation();

    selectedElement = el;
    const info = getElementInfo(el);

    // Show selection overlay
    if (!selectionOverlay) selectionOverlay = createSelectionOverlay();
    positionOverlay(selectionOverlay, el);

    // Send selection to parent
    const message = {
      type: 'element-selected',
      data: info
    };

    window.parent.postMessage(message, '*');

    console.log('[Loxia] Element selected:', info.selector);
  }

  // Mouse move - highlight hovered element
  document.addEventListener('mousemove', (e) => {
    if (!isEnabled) return;

    const el = e.target;
    if (el === hoveredElement) return;
    if (el.id?.startsWith('loxia-')) return;

    hoveredElement = el;

    if (!highlightOverlay) highlightOverlay = createHighlightOverlay();
    if (!tooltip) tooltip = createTooltip();

    positionOverlay(highlightOverlay, el);

    // Update tooltip
    const tagName = el.tagName.toLowerCase();
    const id = el.id ? '#' + el.id : '';
    const classes = el.className && typeof el.className === 'string' ?
      '.' + el.className.split(' ').slice(0, 2).join('.') : '';

    tooltip.textContent = tagName + id + classes;
    tooltip.style.left = (e.clientX + 10) + 'px';
    tooltip.style.top = (e.clientY + 10) + 'px';
    tooltip.style.display = 'block';
  }, true);

  // Mouse leave - hide highlight
  document.addEventListener('mouseleave', () => {
    if (highlightOverlay) highlightOverlay.style.display = 'none';
    if (tooltip) tooltip.style.display = 'none';
  }, true);

  // Click - select element
  document.addEventListener('click', (e) => {
    if (!isEnabled) return;
    if (e.target.id?.startsWith('loxia-')) return;

    selectElement(e.target, e);
  }, true);

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Escape - toggle overlay
    if (e.key === 'Escape') {
      isEnabled = !isEnabled;
      updateCursorStyle(isEnabled);
      if (!isEnabled) {
        if (highlightOverlay) highlightOverlay.style.display = 'none';
        if (selectionOverlay) selectionOverlay.style.display = 'none';
        if (tooltip) tooltip.style.display = 'none';
        hoveredElement = null;
      }
      // Notify parent of mode change
      window.parent.postMessage({ type: 'mode-toggled', enabled: isEnabled }, '*');
      console.log('[Loxia] Visual editor ' + (isEnabled ? 'enabled' : 'disabled'));
    }
  });

  // Listen for commands from editor
  window.addEventListener('message', (e) => {
    if (!e.data || !e.data.type) return;

    switch (e.data.type) {
      case 'highlight':
        const highlightEl = document.querySelector(e.data.selector);
        if (highlightEl) {
          if (!selectionOverlay) selectionOverlay = createSelectionOverlay();
          positionOverlay(selectionOverlay, highlightEl);

          // Auto-hide after duration
          setTimeout(() => {
            if (selectionOverlay) selectionOverlay.style.display = 'none';
          }, e.data.duration || 2000);
        }
        break;

      case 'scroll-to':
        const scrollEl = document.querySelector(e.data.selector);
        if (scrollEl) {
          scrollEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        break;

      case 'reload':
        location.reload();
        break;

      case 'toggle':
        isEnabled = e.data.enabled !== undefined ? e.data.enabled : !isEnabled;
        updateCursorStyle(isEnabled);
        // Hide/show overlays based on new state
        if (!isEnabled) {
          if (highlightOverlay) highlightOverlay.style.display = 'none';
          if (selectionOverlay) selectionOverlay.style.display = 'none';
          if (tooltip) tooltip.style.display = 'none';
          hoveredElement = null;
        }
        console.log('[Loxia] Visual editor ' + (isEnabled ? 'enabled (Select mode)' : 'disabled (Preview mode)'));
        break;

      case 'set-error-reporting':
        errorReportingEnabled = !!e.data.enabled;
        console.log('[Loxia] Error reporting ' + (errorReportingEnabled ? 'enabled' : 'disabled'));
        break;
    }
  });

  // === Console Error Capture ===
  let errorReportingEnabled = true;
  const capturedErrors = [];
  const MAX_CAPTURED = 20;

  function reportError(error) {
    if (!errorReportingEnabled) return;
    if (capturedErrors.length >= MAX_CAPTURED) return;
    // Skip Loxia's own logs
    if (typeof error.message === 'string' && error.message.startsWith('[Loxia]')) return;

    const entry = {
      type: error.type || 'error',
      message: String(error.message || error).slice(0, 500),
      source: error.source || null,
      line: error.line || null,
      col: error.col || null,
      timestamp: Date.now()
    };
    capturedErrors.push(entry);

    window.parent.postMessage({
      type: 'console-error',
      data: entry
    }, '*');
  }

  // Capture unhandled errors
  window.addEventListener('error', (e) => {
    reportError({
      type: 'runtime-error',
      message: e.message,
      source: e.filename,
      line: e.lineno,
      col: e.colno
    });
  });

  // Capture unhandled promise rejections
  window.addEventListener('unhandledrejection', (e) => {
    reportError({
      type: 'unhandled-rejection',
      message: e.reason ? (e.reason.message || String(e.reason)) : 'Unknown rejection'
    });
  });

  // Intercept console.error
  const originalConsoleError = console.error;
  console.error = function() {
    const msg = Array.from(arguments).map(a => {
      if (a instanceof Error) return a.message + (a.stack ? '\\n' + a.stack.split('\\n').slice(0, 3).join('\\n') : '');
      if (typeof a === 'object') try { return JSON.stringify(a).slice(0, 300); } catch { return String(a); }
      return String(a);
    }).join(' ');

    reportError({ type: 'console-error', message: msg });
    originalConsoleError.apply(console, arguments);
  };

  // Intercept console.warn for build warnings
  const originalConsoleWarn = console.warn;
  console.warn = function() {
    const msg = Array.from(arguments).map(a => typeof a === 'string' ? a : String(a)).join(' ');
    // Only capture warnings that look like build/framework issues
    if (/deprecat|warning|failed|error|cannot|invalid/i.test(msg)) {
      reportError({ type: 'console-warning', message: msg });
    }
    originalConsoleWarn.apply(console, arguments);
  };

  console.log('[Loxia] Visual Editor overlay loaded - Click elements to select, ESC to toggle');
})();`;
  }
}

// Singleton instance
let serverInstance = null;

/**
 * Get or create the Visual Editor Server singleton
 * @param {Object} config - Configuration (only used on first call)
 * @returns {VisualEditorServer}
 */
export function getVisualEditorServer(config = {}) {
  if (!serverInstance) {
    serverInstance = new VisualEditorServer(config);
  }
  return serverInstance;
}

/**
 * Reset the singleton (for testing)
 */
export async function resetVisualEditorServer() {
  if (serverInstance) {
    await serverInstance.stop();
    serverInstance = null;
  }
}

/**
 * Set the bridge getter function to enable element selection forwarding
 * This avoids circular dependencies between visualEditorServer and visualEditorBridge
 * @param {Function} getter - Function that returns the visualEditorBridge instance
 */
export { setBridgeGetter };

/**
 * Get the Visual Editor port from service registry (source of truth)
 * Falls back to server instance port or default if not registered
 * @returns {number} The port number
 */
export function getVisualEditorPort() {
  // Check service registry first (source of truth)
  const service = registry.get(SERVICE_NAME);
  if (service) {
    return service.port;
  }

  // Fall back to server instance or default
  return serverInstance?.port || getDefaultPort();
}

/**
 * Get the Visual Editor base URL from service registry
 * @returns {string} The base URL (e.g., http://localhost:4000)
 */
export function getVisualEditorBaseUrl() {
  const port = getVisualEditorPort();
  return `http://localhost:${port}`;
}

export { FALLBACK_PORT as VISUAL_EDITOR_DEFAULT_PORT };
export default VisualEditorServer;
