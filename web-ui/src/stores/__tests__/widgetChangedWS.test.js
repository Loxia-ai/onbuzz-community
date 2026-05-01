/**
 * Tests the appStore WebSocket handler for `widget_changed` messages —
 * the bridge from the backend's WidgetTool event bus into the frontend
 * widgetArtifactsStore. This is what keeps the artifacts panel in sync
 * regardless of chat-feed virtualization.
 *
 * Contract:
 *   - changeType:'rendered' | 'updated' | 'main-set' | 'shared'
 *     | 'unshared' | 'upgrade-applied'  → upsertSummary(agentId, summary)
 *   - changeType:'destroyed'                                → removeSummary(agentId, widgetId)
 *   - missing agentId, missing changeType, no global store  → no-op (safe)
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore.js';
import useWidgetArtifactsStore from '../widgetArtifactsStore.js';

const mkSummary = (overrides) => ({
  widgetId: 'w1',
  kind: 'webcomponent',
  createdAt: '2026-04-25T10:00:00Z',
  updatedAt: '2026-04-25T10:00:00Z',
  lastRenderedAt: '2026-04-25T10:00:00Z',
  size: 50,
  phishingHits: [],
  versionCount: 1,
  mainVersionId: 'v-1',
  linkedGalleryTemplateId: null,
  linkedGalleryVersion: null,
  divergedFromGallery: false,
  ...overrides,
});

beforeEach(() => {
  useWidgetArtifactsStore.setState({
    byAgent: new Map(),
    latestRenderByWidget: new Map(),
    openArtifact: null,
  });
  // The appStore handler reads window.__widgetArtifactsStore — importing
  // the store registers it, but in case test isolation swallowed that:
  if (typeof window !== 'undefined') {
    window.__widgetArtifactsStore = useWidgetArtifactsStore;
  }
});

function dispatch(message) {
  useAppStore.getState().handleWebSocketMessage(message);
}

describe('widget_changed → upsertSummary', () => {
  it('"rendered" inserts a new summary into the agent\'s cache', () => {
    const summary = mkSummary({ widgetId: 'w-new', versionCount: 1 });
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w-new', changeType: 'rendered', summary },
    });
    const cached = useWidgetArtifactsStore.getState().getSummariesForAgent('a1');
    expect(cached).toHaveLength(1);
    expect(cached[0]).toMatchObject({ widgetId: 'w-new', versionCount: 1 });
  });

  it('"rendered" again replaces the summary (versionCount bumps)', () => {
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'rendered',
              summary: mkSummary({ widgetId: 'w1', versionCount: 1 }) },
    });
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'rendered',
              summary: mkSummary({ widgetId: 'w1', versionCount: 2 }) },
    });
    const cached = useWidgetArtifactsStore.getState().getSummariesForAgent('a1');
    expect(cached).toHaveLength(1);
    expect(cached[0].versionCount).toBe(2);
  });

  it('"main-set" updates mainVersionId in cache', () => {
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'rendered',
              summary: mkSummary({ widgetId: 'w1', mainVersionId: 'v-1' }) },
    });
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'main-set',
              summary: mkSummary({ widgetId: 'w1', mainVersionId: 'v-2' }) },
    });
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a1')[0].mainVersionId).toBe('v-2');
  });

  it('"shared" sets linkedGalleryTemplateId on the cached row', () => {
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'shared',
              templateId: 'tpl-1', templateVersion: 1,
              summary: mkSummary({ widgetId: 'w1', linkedGalleryTemplateId: 'tpl-1', linkedGalleryVersion: 1 }) },
    });
    const row = useWidgetArtifactsStore.getState().getSummariesForAgent('a1')[0];
    expect(row.linkedGalleryTemplateId).toBe('tpl-1');
    expect(row.linkedGalleryVersion).toBe(1);
  });

  it('"unshared" clears linkedGalleryTemplateId', () => {
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'shared',
              summary: mkSummary({ widgetId: 'w1', linkedGalleryTemplateId: 'tpl-1' }) },
    });
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'unshared',
              summary: mkSummary({ widgetId: 'w1', linkedGalleryTemplateId: null }) },
    });
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a1')[0].linkedGalleryTemplateId).toBeNull();
  });

  it('"upgrade-applied" treated as upsert (versionCount and link bump)', () => {
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'upgrade-applied',
              summary: mkSummary({ widgetId: 'w1', versionCount: 3, linkedGalleryVersion: 2 }) },
    });
    const row = useWidgetArtifactsStore.getState().getSummariesForAgent('a1')[0];
    expect(row.versionCount).toBe(3);
    expect(row.linkedGalleryVersion).toBe(2);
  });
});

describe('widget_changed → removeSummary', () => {
  it('"destroyed" removes the widget from the agent\'s cache', () => {
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'rendered',
              summary: mkSummary({ widgetId: 'w1' }) },
    });
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a1')).toHaveLength(1);
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'destroyed', summary: null },
    });
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a1')).toHaveLength(0);
  });

  it('"destroyed" for an unknown widget is a no-op (does not throw)', () => {
    expect(() => dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'never-there', changeType: 'destroyed', summary: null },
    })).not.toThrow();
  });
});

describe('cross-agent isolation', () => {
  it('a widget_changed for agent a1 does not affect agent a2 cache', () => {
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'rendered',
              summary: mkSummary({ widgetId: 'w1' }) },
    });
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a2')).toHaveLength(0);
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a1')).toHaveLength(1);
  });
});

describe('defensive guards', () => {
  it('missing agentId is a no-op', () => {
    dispatch({
      type: 'widget_changed',
      data: { widgetId: 'w1', changeType: 'rendered', summary: mkSummary() },
    });
    // No throw, no insertion under any agent
    expect(useWidgetArtifactsStore.getState().byAgent.size).toBe(0);
  });

  it('missing changeType is a no-op', () => {
    dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', summary: mkSummary() },
    });
    expect(useWidgetArtifactsStore.getState().byAgent.size).toBe(0);
  });

  it('upsert with missing summary is silently skipped (no throw)', () => {
    expect(() => dispatch({
      type: 'widget_changed',
      data: { agentId: 'a1', widgetId: 'w1', changeType: 'rendered', summary: null },
    })).not.toThrow();
  });

  it('handler is robust when window.__widgetArtifactsStore is missing', () => {
    const saved = window.__widgetArtifactsStore;
    delete window.__widgetArtifactsStore;
    try {
      expect(() => dispatch({
        type: 'widget_changed',
        data: { agentId: 'a1', widgetId: 'w1', changeType: 'rendered', summary: mkSummary() },
      })).not.toThrow();
    } finally {
      window.__widgetArtifactsStore = saved;
    }
  });
});
