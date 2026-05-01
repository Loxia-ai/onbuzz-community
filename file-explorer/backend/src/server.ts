import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs/promises';
import { Request, Response } from 'express';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Types
interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: Date;
  extension?: string;
}

interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

// Helper function to get file stats safely
async function getFileStats(filePath: string): Promise<{ stats: any; error?: string }> {
  try {
    const stats = await fs.stat(filePath);
    return { stats };
  } catch (error) {
    return { stats: null, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Helper function to check if path is safe (prevent directory traversal)
function isSafePath(requestedPath: string): boolean {
  const resolvedPath = path.resolve(requestedPath);
  const rootPath = path.resolve('/');
  return resolvedPath.startsWith(rootPath);
}

// Get directory contents
app.get('/api/browse', async (req: Request, res: Response) => {
  try {
    const requestedPath = req.query.path as string || process.cwd();

    if (!isSafePath(requestedPath)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid path'
      } as ApiResponse<null>);
    }

    const { stats, error } = await getFileStats(requestedPath);

    if (error || !stats) {
      return res.status(404).json({
        success: false,
        error: 'Path not found or inaccessible'
      } as ApiResponse<null>);
    }

    if (!stats.isDirectory()) {
      return res.status(400).json({
        success: false,
        error: 'Path is not a directory'
      } as ApiResponse<null>);
    }

    const items = await fs.readdir(requestedPath);
    const fileItems: FileItem[] = [];

    for (const item of items) {
      const itemPath = path.join(requestedPath, item);
      const { stats: itemStats } = await getFileStats(itemPath);

      if (itemStats) {
        const fileItem: FileItem = {
          name: item,
          path: itemPath,
          type: itemStats.isDirectory() ? 'directory' : 'file',
          size: itemStats.isFile() ? itemStats.size : undefined,
          lastModified: itemStats.mtime,
          extension: itemStats.isFile() ? path.extname(item).toLowerCase() : undefined
        };
        fileItems.push(fileItem);
      }
    }

    // Sort directories first, then files, both alphabetically
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
    } as ApiResponse<any>);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Server error'
    } as ApiResponse<null>);
  }
});

// Get file information
app.get('/api/file-info', async (req: Request, res: Response) => {
  try {
    const filePath = req.query.path as string;

    if (!filePath || !isSafePath(filePath)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid file path'
      } as ApiResponse<null>);
    }

    const { stats, error } = await getFileStats(filePath);

    if (error || !stats) {
      return res.status(404).json({
        success: false,
        error: 'File not found'
      } as ApiResponse<null>);
    }

    const fileInfo: FileItem = {
      name: path.basename(filePath),
      path: filePath,
      type: stats.isDirectory() ? 'directory' : 'file',
      size: stats.isFile() ? stats.size : undefined,
      lastModified: stats.mtime,
      extension: stats.isFile() ? path.extname(filePath).toLowerCase() : undefined
    };

    res.json({
      success: true,
      data: fileInfo
    } as ApiResponse<FileItem>);

  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Server error'
    } as ApiResponse<null>);
  }
});

// Get current working directory
app.get('/api/cwd', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      cwd: process.cwd(),
      platform: process.platform,
      homedir: require('os').homedir()
    }
  } as ApiResponse<any>);
});

// Health check
app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    success: true,
    data: {
      status: 'healthy',
      timestamp: new Date().toISOString()
    }
  } as ApiResponse<any>);
});

app.listen(PORT, () => {
  console.log(`File Explorer API server running on port ${PORT}`);
  console.log(`Current working directory: ${process.cwd()}`);
});