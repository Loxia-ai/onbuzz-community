/**
 * File Explorer Module
 * Main entry point for the file explorer functionality
 */

import { createFileExplorerRouter, defaultConfig } from './routes.js';
import FileExplorerController from './controller.js';

/**
 * Initialize file explorer module
 * @param {Object} config - Configuration options
 * @returns {Object} Module interface
 */
export function initFileExplorerModule(config = {}) {
  const mergedConfig = { ...defaultConfig, ...config };
  const router = createFileExplorerRouter(mergedConfig);
  const controller = new FileExplorerController(mergedConfig);
  
  return {
    router,
    controller,
    config: mergedConfig
  };
}

// Export individual components for advanced usage
export { default as FileExplorerController } from './controller.js';
export { createFileExplorerRouter, defaultConfig } from './routes.js';
export * from './middleware.js';

// Default export
export default {
  init: initFileExplorerModule,
  Controller: FileExplorerController,
  createRouter: createFileExplorerRouter,
  defaultConfig
};