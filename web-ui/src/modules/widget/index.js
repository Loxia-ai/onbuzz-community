/**
 * Widget module — public API.
 *
 * The ONLY file outside this directory should import from here. The four
 * core-file registration points (toolConstants, toolRenderers/registry,
 * toolConfig/registry, App.jsx route) each import one named export.
 *
 * Removing the feature = delete this directory + the four import lines.
 */

export { default as WidgetRenderer } from './WidgetRenderer.jsx';
export { default as WidgetConfigurator } from './WidgetConfigurator.jsx';
export { default as WidgetAuditPage } from './WidgetAuditPage.jsx';
export { default as WidgetGalleryPage } from './WidgetGalleryPage.jsx';
export { default as IframeWidget } from './IframeWidget.jsx';

export const WIDGET_TOOL_ID = 'widget';
export const WIDGET_DISPLAY_NAME = 'Widget';
export const WIDGET_AUDIT_ROUTE = '/widget-audit';
export const WIDGET_GALLERY_ROUTE = '/widget-gallery';
