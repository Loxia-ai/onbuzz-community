/**
 * File Explorer Middleware
 * Contains middleware functions specific to file explorer operations
 */

/**
 * Validate path parameter middleware
 * @param {import('express').Request} req 
 * @param {import('express').Response} res 
 * @param {import('express').NextFunction} next 
 */
export function validatePath(req, res, next) {
  const { path } = req.query;
  
  if (path && typeof path !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'Path parameter must be a string'
    });
  }
  
  next();
}

/**
 * Rate limiting middleware for file operations
 * Prevents excessive file system requests
 * @param {number} maxRequests - Max requests per window
 * @param {number} windowMs - Time window in milliseconds
 */
export function createRateLimit(maxRequests = 100, windowMs = 60000) {
  const requests = new Map();
  
  return (req, res, next) => {
    const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Get or create request history for this IP
    if (!requests.has(clientIp)) {
      requests.set(clientIp, []);
    }
    
    const clientRequests = requests.get(clientIp);
    
    // Remove old requests outside the window
    const validRequests = clientRequests.filter(timestamp => timestamp > windowStart);
    requests.set(clientIp, validRequests);
    
    // Check if limit exceeded
    if (validRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    }
    
    // Add current request
    validRequests.push(now);
    
    next();
  };
}

/**
 * Security headers middleware for file explorer
 */
export function securityHeaders(req, res, next) {
  // Prevent caching of file system data
  res.set({
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    'Pragma': 'no-cache',
    'Expires': '0'
  });
  
  next();
}

/**
 * Request logging middleware for file explorer
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`[FileExplorer] ${req.method} ${req.originalUrl} - ${res.statusCode} (${duration}ms)`);
  });
  
  next();
}