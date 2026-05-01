const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs').promises;

const app = express();
const PORT = 3001;

// Simplified CORS configuration - allow all origins in development
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  credentials: true
}));
app.use(express.json());


// Simple health check
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    }
  });
});

// Simple browse endpoint
app.get('/api/browse', async (req, res) => {
  try {
    let requestedPath = req.query.path || process.cwd();

    // Convert WSL paths to Windows paths if running on Windows
    if (process.platform === 'win32' && requestedPath.startsWith('/mnt/')) {
      requestedPath = requestedPath.replace(/^\/mnt\/([a-z])\//i, '$1:/');
    }


    const stats = await fs.stat(requestedPath);

    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        error: 'Path is not a directory'
      });
    }

    const items = await fs.readdir(requestedPath);
    const fileItems = [];

    for (const item of items) {
      try {
        const itemPath = path.join(requestedPath, item);
        const itemStats = await fs.stat(itemPath);

        fileItems.push({
          name: item,
          path: itemPath,
          type: itemStats.isDirectory() ? 'directory' : 'file',
          size: itemStats.isFile() ? itemStats.size : undefined,
          lastModified: itemStats.mtime,
          extension: itemStats.isFile() ? path.extname(item).toLowerCase() : undefined
        });
      } catch (err) {
        // Skip items we can't read
      }
    }

    // Sort directories first, then files
    fileItems.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name);
      }
      return a.type === 'directory' ? -1 : 1;
    });

    res.json({
      success: true,
      data: {
        currentPath: requestedPath,
        parentPath: path.dirname(requestedPath),
        items: fileItems
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get current working directory
app.get('/api/cwd', (req, res) => {
  let cwd = process.cwd();

  // Convert WSL paths to Windows paths if running on Windows
  if (process.platform === 'win32' && cwd.startsWith('/mnt/')) {
    cwd = cwd.replace(/^\/mnt\/([a-z])\//i, '$1:/');
  }


  res.json({
    success: true,
    data: {
      cwd: cwd,
      platform: process.platform,
      homedir: require('os').homedir()
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`File Explorer API server running on http://127.0.0.1:${PORT}`);
});