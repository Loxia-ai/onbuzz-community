/**
 * Tool Renderers Module
 *
 * Exports all tool renderers and the registry for use in MessageBubble.
 *
 * To add a new renderer:
 * 1. Create the renderer component in this directory
 * 2. Import it in registry.js and add to RENDERER_REGISTRY
 * 3. (Optional) Export it here for direct use
 */

import {
  getRenderer,
  registerRenderer,
  setFallbackRenderer,
  hasCustomRenderer,
  getRegisteredToolIds,
  getToolsWithCustomRenderers
} from './registry';

// Import renderers
import FallbackRenderer from './FallbackRenderer';
import ToolContentRenderer from './ToolContentRenderer';

// Initialize fallback renderer
setFallbackRenderer(FallbackRenderer);

// Note: All renderers are now registered directly in registry.js via the
// RENDERER_REGISTRY Map, rather than through registerRenderer() calls here.
// This avoids duplicate registration and keeps the registry as the single
// source of truth.

// Export everything
export {
  // Main component for use in MessageBubble
  ToolContentRenderer,

  // Individual renderers (for direct use if needed)
  FallbackRenderer,

  // Registry functions
  getRenderer,
  registerRenderer,
  hasCustomRenderer,
  getRegisteredToolIds,
  getToolsWithCustomRenderers
};

export default ToolContentRenderer;
