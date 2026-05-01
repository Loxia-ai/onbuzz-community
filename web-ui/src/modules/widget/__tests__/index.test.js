/**
 * The public API surface: if any of these disappear or get renamed, the
 * 4 core registration points (toolConstants / toolRenderers / toolConfig /
 * App.jsx) will break. This test pins the contract.
 */
import { describe, it, expect } from 'vitest';
import * as api from '../index.js';

describe('widget module public API', () => {
  it('exports all three registrable components', () => {
    expect(typeof api.WidgetRenderer).toBe('function');
    expect(typeof api.WidgetConfigurator).toBe('function');
    expect(typeof api.WidgetAuditPage).toBe('function');
    expect(typeof api.IframeWidget).toBe('function');
  });

  it('pins the tool id to the backend contract', () => {
    expect(api.WIDGET_TOOL_ID).toBe('widget');
    expect(api.WIDGET_AUDIT_ROUTE).toBe('/widget-audit');
  });
});
