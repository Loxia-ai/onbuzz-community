/**
 * Widget Artifacts Store — caching of widget summaries + chat-feed
 * dedup logic. Tests pin both halves so the panel and the chat
 * renderer keep working together.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import useWidgetArtifactsStore from '../widgetArtifactsStore.js';

beforeEach(() => {
  // Reset to a clean slate before each test.
  useWidgetArtifactsStore.setState({
    byAgent: new Map(),
    latestRenderByWidget: new Map(),
    openArtifact: null,
  });
});

const mkSummary = (overrides) => ({
  widgetId: 'w1',
  kind: 'webcomponent',
  createdAt: '2026-04-25T10:00:00Z',
  updatedAt: '2026-04-25T10:00:00Z',
  lastRenderedAt: '2026-04-25T10:00:00Z',
  size: 100,
  phishingHits: [],
  versionCount: 1,
  mainVersionId: 'v-1',
  linkedGalleryTemplateId: null,
  linkedGalleryVersion: null,
  divergedFromGallery: false,
  ...overrides,
});

describe('summaries cache', () => {
  it('setSummariesForAgent replaces the agent\'s map', () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [mkSummary({ widgetId: 'w1' }), mkSummary({ widgetId: 'w2' })]);
    expect(s.getSummariesForAgent('a')).toHaveLength(2);

    // Replacing — the old entries vanish entirely.
    s.setSummariesForAgent('a', [mkSummary({ widgetId: 'w3' })]);
    const after = s.getSummariesForAgent('a');
    expect(after).toHaveLength(1);
    expect(after[0].widgetId).toBe('w3');
  });

  it('upsertSummary adds OR updates a single widget without touching others', () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [mkSummary({ widgetId: 'w1', versionCount: 1 })]);
    s.upsertSummary('a', mkSummary({ widgetId: 'w1', versionCount: 5 }));
    s.upsertSummary('a', mkSummary({ widgetId: 'w2', versionCount: 1 }));
    const list = s.getSummariesForAgent('a');
    const byId = Object.fromEntries(list.map(x => [x.widgetId, x]));
    expect(byId.w1.versionCount).toBe(5);
    expect(byId.w2.versionCount).toBe(1);
  });

  it('removeSummary drops a single widget; no-op for unknown id', () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [mkSummary({ widgetId: 'w1' }), mkSummary({ widgetId: 'w2' })]);
    s.removeSummary('a', 'w1');
    expect(s.getSummariesForAgent('a').map(x => x.widgetId)).toEqual(['w2']);
    s.removeSummary('a', 'unknown'); // no-op
    expect(s.getSummariesForAgent('a').map(x => x.widgetId)).toEqual(['w2']);
  });

  it('per-agent isolation — agent A and agent B don\'t see each other\'s widgets', () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [mkSummary({ widgetId: 'shared' })]);
    s.setSummariesForAgent('b', [mkSummary({ widgetId: 'shared' })]);
    s.upsertSummary('a', mkSummary({ widgetId: 'shared', versionCount: 99 }));
    expect(s.getSummariesForAgent('a')[0].versionCount).toBe(99);
    expect(s.getSummariesForAgent('b')[0].versionCount).toBe(1);
  });

  it('summaries are returned newest first by lastRenderedAt', () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [
      mkSummary({ widgetId: 'old',  lastRenderedAt: '2026-04-25T08:00:00Z' }),
      mkSummary({ widgetId: 'new',  lastRenderedAt: '2026-04-25T12:00:00Z' }),
      mkSummary({ widgetId: 'mid',  lastRenderedAt: '2026-04-25T10:00:00Z' }),
    ]);
    expect(s.getSummariesForAgent('a').map(x => x.widgetId)).toEqual(['new', 'mid', 'old']);
  });

  it('getTotalCount aggregates across agents', () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [mkSummary({ widgetId: 'w1' }), mkSummary({ widgetId: 'w2' })]);
    s.setSummariesForAgent('b', [mkSummary({ widgetId: 'w3' })]);
    expect(s.getTotalCount()).toBe(3);
  });
});

describe('chat-feed dedup (latestRenderByWidget)', () => {
  it('first observation is treated as latest by default (returns true with no prior data)', () => {
    const s = useWidgetArtifactsStore.getState();
    expect(s.isLatestRender('a', 'w1', 'msg-1')).toBe(true);
  });

  it('after marking msg-2 as the latest render, msg-1 becomes non-latest', () => {
    const s = useWidgetArtifactsStore.getState();
    s.markRenderObservation('a', 'w1', 'msg-1');
    s.markRenderObservation('a', 'w1', 'msg-2');
    expect(useWidgetArtifactsStore.getState().isLatestRender('a', 'w1', 'msg-1')).toBe(false);
    expect(useWidgetArtifactsStore.getState().isLatestRender('a', 'w1', 'msg-2')).toBe(true);
  });

  it('MONOTONIC: marking an OLDER id after a newer one does NOT downgrade the newer', () => {
    // Regression: chat renderers can mount in arbitrary order. If an
    // older-message renderer mounts after a newer-message renderer,
    // the newer one must STAY latest. Otherwise dedup is wrong.
    const s = useWidgetArtifactsStore.getState();
    s.markRenderObservation('a', 'w1', '2026-04-25T11:00:00Z'); // newer
    s.markRenderObservation('a', 'w1', '2026-04-25T10:00:00Z'); // older — should NOT win
    const fresh = useWidgetArtifactsStore.getState();
    expect(fresh.isLatestRender('a', 'w1', '2026-04-25T11:00:00Z')).toBe(true);
    expect(fresh.isLatestRender('a', 'w1', '2026-04-25T10:00:00Z')).toBe(false);
  });

  it('marking the same id twice is a no-op (no spurious set call)', () => {
    const s = useWidgetArtifactsStore.getState();
    s.markRenderObservation('a', 'w1', 'msg-1');
    const before = useWidgetArtifactsStore.getState().latestRenderByWidget;
    s.markRenderObservation('a', 'w1', 'msg-1');
    const after = useWidgetArtifactsStore.getState().latestRenderByWidget;
    // Same Map reference (no new Map allocated) when no change
    expect(after).toBe(before);
  });

  it('observations are scoped per (agent, widget) — agent B\'s widget doesn\'t affect agent A\'s', () => {
    const s = useWidgetArtifactsStore.getState();
    s.markRenderObservation('a', 'w1', 'msg-A');
    s.markRenderObservation('b', 'w1', 'msg-B');
    expect(useWidgetArtifactsStore.getState().isLatestRender('a', 'w1', 'msg-A')).toBe(true);
    expect(useWidgetArtifactsStore.getState().isLatestRender('b', 'w1', 'msg-B')).toBe(true);
  });

  it('clearAll resets BOTH summaries and observations', () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [mkSummary()]);
    s.markRenderObservation('a', 'w1', 'msg-1');
    s.clearAll();
    expect(useWidgetArtifactsStore.getState().getTotalCount()).toBe(0);
    expect(useWidgetArtifactsStore.getState().latestRenderByWidget.size).toBe(0);
  });
});

describe('panel state', () => {
  it('openInPanel sets the artifact identity; closePanel clears it', () => {
    const s = useWidgetArtifactsStore.getState();
    s.openInPanel({ agentId: 'a', widgetId: 'w1' });
    expect(useWidgetArtifactsStore.getState().openArtifact).toEqual({ agentId: 'a', widgetId: 'w1' });
    useWidgetArtifactsStore.getState().closePanel();
    expect(useWidgetArtifactsStore.getState().openArtifact).toBeNull();
  });
});

describe('fetchForAgent', () => {
  it('loads summaries from /api/widget/audit and stores them', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, widgets: [mkSummary({ widgetId: 'remote-w' })] }),
    });
    await useWidgetArtifactsStore.getState().fetchForAgent('a');
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a').map(x => x.widgetId))
      .toEqual(['remote-w']);
  });

  it('non-OK response is tolerated — keeps existing state, does not throw', async () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [mkSummary({ widgetId: 'cached' })]);
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(s.fetchForAgent('a')).resolves.toBeUndefined();
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a')[0].widgetId).toBe('cached');
  });

  it('network error is tolerated — keeps existing state, does not throw', async () => {
    const s = useWidgetArtifactsStore.getState();
    s.setSummariesForAgent('a', [mkSummary({ widgetId: 'cached' })]);
    global.fetch = vi.fn().mockRejectedValue(new Error('network down'));
    await expect(s.fetchForAgent('a')).resolves.toBeUndefined();
    expect(useWidgetArtifactsStore.getState().getSummariesForAgent('a')[0].widgetId).toBe('cached');
  });
});
