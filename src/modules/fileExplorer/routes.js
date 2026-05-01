/**
 * File Explorer Routes
 * Defines all API endpoints for file system operations
 */

import express from 'express';
import FileExplorerController from './controller.js';
import { validatePath, createRateLimit, securityHeaders, requestLogger } from './middleware.js';

/**
 * Create file explorer router with all endpoints
 * @param {Object} config - Configuration options for the file explorer
 * @returns {express.Router} Configured express router
 */
export function createFileExplorerRouter(config = {}) {
  const router = express.Router();
  const controller = new FileExplorerController(config);
  
  // Apply middleware to all routes
  router.use(requestLogger);
  router.use(securityHeaders);
  router.use(createRateLimit(100, 60000)); // 100 requests per minute

  // Health check endpoint
  router.get('/health', (req, res) => {
    const result = controller.healthCheck();
    res.json(result);
  });

  // Get current working directory
  router.get('/cwd', (req, res) => {
    const result = controller.getCurrentWorkingDirectory();
    res.json(result);
  });

  // Get quick access paths (OS-aware common folders)
  router.get('/quick-access', (req, res) => {
    const result = controller.getQuickAccessPaths();
    res.json(result);
  });

  // Browse directory contents
  router.get('/browse', validatePath, async (req, res) => {
    try {
      const requestedPath = req.query.path;
      const options = {
        showHidden: req.query.showHidden === 'true'
      };
      
      const result = await controller.browseDirectory(requestedPath, options);
      
      if (result.success) {
        res.json(result);
      } else {
        const statusCode = result.error.includes('restricted') ? 403 :
                          result.error.includes('not found') ? 404 : 400;
        res.status(statusCode).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // Get file information
  router.get('/file-info', validatePath, async (req, res) => {
    try {
      const filePath = req.query.path;
      const result = await controller.getFileInfo(filePath);
      
      if (result.success) {
        res.json(result);
      } else {
        const statusCode = result.error.includes('not found') ? 404 : 400;
        res.status(statusCode).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // Create directory
  router.post('/mkdir', express.json(), async (req, res) => {
    try {
      const { path: dirPath, recursive = false } = req.body;

      if (!dirPath) {
        return res.status(400).json({
          success: false,
          error: 'Directory path is required'
        });
      }

      const result = await controller.createDirectory(dirPath, { recursive });

      if (result.success) {
        res.json(result);
      } else {
        const statusCode = result.code === 'EEXIST' ? 409 : 400;
        res.status(statusCode).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // Rename file or directory
  router.post('/rename', express.json(), async (req, res) => {
    try {
      const { oldPath, newName } = req.body;

      if (!oldPath || !newName) {
        return res.status(400).json({
          success: false,
          error: 'oldPath and newName are required'
        });
      }

      const result = await controller.renameItem(oldPath, newName);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // Open directory in system file explorer
  router.post('/open', express.json(), async (req, res) => {
    try {
      const { path: dirPath } = req.body;

      if (!dirPath) {
        return res.status(400).json({
          success: false,
          error: 'Directory path is required'
        });
      }

      const result = await controller.openInExplorer(dirPath);

      if (result.success) {
        res.json(result);
      } else {
        res.status(400).json(result);
      }
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  });

  // Download directory as ZIP
  router.post('/download-zip', express.json(), async (req, res) => {
    try {
      const { path: dirPath, respectGitignore = true } = req.body;
      if (!dirPath) return res.status(400).json({ error: 'Path is required' });

      const fs = await import('fs/promises');
      const fsSync = await import('fs');
      const pathModule = await import('path');

      // Verify directory exists
      const stats = await fs.stat(dirPath);
      if (!stats.isDirectory()) return res.status(400).json({ error: 'Path is not a directory' });

      // Read .gitignore patterns for exclusion info
      let ignorePatterns = ['node_modules', '.git', '.env'];
      if (respectGitignore) {
        try {
          const gitignorePath = pathModule.join(dirPath, '.gitignore');
          const gitignoreContent = await fs.readFile(gitignorePath, 'utf8');
          const patterns = gitignoreContent.split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
          ignorePatterns = [...new Set([...ignorePatterns, ...patterns])];
        } catch { /* no .gitignore */ }
      }

      const dirName = pathModule.basename(dirPath);
      const os = await import('os');
      const tmpDir = os.tmpdir();
      const zipFileName = `${dirName}-${Date.now()}.zip`;
      const zipPath = pathModule.join(tmpDir, zipFileName);

      // Build exclude args for PowerShell or tar
      const isWin = process.platform === 'win32';
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execAsync = promisify(exec);

      if (isWin) {
        // Use PowerShell Compress-Archive on Windows
        // First, create a temp directory with filtered contents
        const tempCopyDir = pathModule.join(tmpDir, `zip-staging-${Date.now()}`);

        // Build PowerShell exclude pattern for robocopy
        const robocopyExcludes = ignorePatterns
          .filter(p => !p.includes('/') && !p.startsWith('*'))
          .map(p => p.replace(/\/$/, ''));

        const xdArgs = robocopyExcludes.length > 0 ? `/XD ${robocopyExcludes.join(' ')}` : '';
        const xfArgs = ignorePatterns
          .filter(p => p.startsWith('*.') || p.startsWith('.'))
          .map(p => p);
        const xfStr = xfArgs.length > 0 ? `/XF ${xfArgs.join(' ')}` : '';

        const psScript = `
          $ErrorActionPreference = 'SilentlyContinue'
          $src = '${dirPath.replace(/'/g, "''")}'
          $staging = '${tempCopyDir.replace(/'/g, "''")}'
          $zip = '${zipPath.replace(/'/g, "''")}'
          if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
          robocopy "$src" "$staging" /E /NFL /NDL /NJH /NJS /NC /NS /NP ${xdArgs} ${xfStr}
          Compress-Archive -Path "$staging\\*" -DestinationPath "$zip" -Force
          Remove-Item -Recurse -Force $staging
        `.trim();

        await execAsync(`powershell -NoProfile -Command "${psScript.replace(/"/g, '\\"')}"`, {
          maxBuffer: 50 * 1024 * 1024,
          timeout: 120000
        });
      } else {
        // Use tar + gzip on Linux/Mac, or zip if available
        const excludeArgs = ignorePatterns.map(p => `--exclude='${p}'`).join(' ');
        await execAsync(
          `cd "${dirPath}" && zip -r "${zipPath}" . ${ignorePatterns.map(p => `-x '${p}/*' -x '${p}'`).join(' ')}`,
          { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
        );
      }

      // Stream the zip file back
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', `attachment; filename="${dirName}.zip"`);

      const readStream = fsSync.createReadStream(zipPath);
      readStream.pipe(res);
      readStream.on('end', async () => {
        try { await fs.unlink(zipPath); } catch { /* cleanup best effort */ }
      });
      readStream.on('error', (err) => {
        console.error('ZIP stream error:', err);
        if (!res.headersSent) {
          res.status(500).json({ error: err.message });
        }
      });
    } catch (error) {
      console.error('ZIP download error:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: error.message });
      }
    }
  });

  return router;
}

/**
 * Default configuration for file explorer
 */
export const defaultConfig = {
  showHidden: false,
  allowedExtensions: [], // Empty = all extensions
  maxDepth: 50,
  restrictedPaths: [
    // Add system paths that should be restricted
    // Example: '/etc', '/var', '/usr/bin'
  ]
};

export default createFileExplorerRouter;