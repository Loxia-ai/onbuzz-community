/**
 * File Explorer Module
 * Main entry point for file explorer components and utilities
 */

// Components
export { default as FileExplorer } from './components/FileExplorer.jsx';
export { default as FileExplorerModal } from './components/FileExplorerModal.jsx';

// Services
export { default as fileExplorerApi } from './services/api.js';

// Types and constants
export * from './types/index.js';

// Utilities
export * from './utils/fileUtils.js';

// Default export for convenience
import FileExplorerModal from './components/FileExplorerModal.jsx';
export default FileExplorerModal;