import { FileItem } from '../types';

export function getFileIcon(item: FileItem): string {
  if (item.type === 'directory') {
    return '📁';
  }

  const extension = item.extension?.toLowerCase();

  switch (extension) {
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
      return '📄';
    case '.json':
      return '📋';
    case '.html':
    case '.htm':
      return '🌐';
    case '.css':
    case '.scss':
    case '.sass':
      return '🎨';
    case '.md':
    case '.markdown':
      return '📝';
    case '.pdf':
      return '📕';
    case '.doc':
    case '.docx':
      return '📘';
    case '.xls':
    case '.xlsx':
      return '📗';
    case '.ppt':
    case '.pptx':
      return '📙';
    case '.jpg':
    case '.jpeg':
    case '.png':
    case '.gif':
    case '.svg':
    case '.webp':
      return '🖼️';
    case '.mp4':
    case '.avi':
    case '.mov':
    case '.mkv':
      return '🎬';
    case '.mp3':
    case '.wav':
    case '.flac':
    case '.aac':
      return '🎵';
    case '.zip':
    case '.rar':
    case '.tar':
    case '.gz':
      return '📦';
    case '.exe':
    case '.msi':
      return '⚙️';
    default:
      return '📄';
  }
}

export function formatFileSize(bytes?: number): string {
  if (bytes === undefined) return '';

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function formatDate(date?: Date): string {
  if (!date) return '';

  const dateObj = typeof date === 'string' ? new Date(date) : date;
  return dateObj.toLocaleDateString() + ' ' + dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function isHiddenFile(fileName: string): boolean {
  return fileName.startsWith('.');
}

export function sortFileItems(items: FileItem[]): FileItem[] {
  return items.sort((a, b) => {
    // Directories first
    if (a.type !== b.type) {
      return a.type === 'directory' ? -1 : 1;
    }

    // Then alphabetical
    return a.name.localeCompare(b.name, undefined, {
      numeric: true,
      sensitivity: 'base'
    });
  });
}

export function getParentPath(currentPath: string): string {
  if (currentPath === '/' || currentPath === '') {
    return '/';
  }

  const parts = currentPath.split('/').filter(Boolean);
  if (parts.length <= 1) {
    return '/';
  }

  return '/' + parts.slice(0, -1).join('/');
}

export function joinPath(...paths: string[]): string {
  return paths
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '') || '/';
}

export function getFileName(path: string): string {
  return path.split('/').pop() || '';
}

export function isValidPath(path: string): boolean {
  if (!path) return false;

  // Basic validation - adjust based on your security requirements
  const invalidChars = /[<>:"|?*]/;
  return !invalidChars.test(path);
}