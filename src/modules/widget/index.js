/**
 * Widget module — public API.
 *
 * This is the ONLY file outside the module that core code imports from.
 * The module owns: the widgetTool, the runtime bundle, the HTTP routes,
 * the schema, and the phishing scanner. Nothing else.
 *
 * Core integration is two lines:
 *
 *   // src/index.js
 *   if (!widgetModule.isDisabled()) {
 *     await this.toolsRegistry.registerTool(widgetModule.WidgetTool);
 *   }
 *
 *   // src/interfaces/webServer.js
 *   widgetModule.registerRoutes(this.app, this.orchestrator);
 *
 * Removing the feature = delete this directory + those two lines.
 * See also: LOXIA_DISABLE_WIDGETS=1 env flag below (zero-source disable).
 */

import { WidgetTool } from './widgetTool.js';
import { registerRoutes } from './routes.js';

export { WidgetTool, registerRoutes };

/**
 * Feature flag — when truthy, the module declines all registration.
 * Core files use `isDisabled()` so they can skip registering the tool +
 * routes without needing to know whether this file is on disk. Cheap way
 * to ship a kill-switch in production AND a clean seam for test suites.
 */
export function isDisabled() {
  return process.env.LOXIA_DISABLE_WIDGETS === '1'
      || process.env.LOXIA_DISABLE_WIDGETS === 'true';
}

export default { WidgetTool, registerRoutes, isDisabled };
