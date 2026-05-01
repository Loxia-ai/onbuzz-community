/**
 * WidgetArtifactsSection — embedded in the Artifacts panel; lists every
 * widget the agent has rendered. Tests cover empty state, populated
 * grid, click-to-open dispatch, and the kind/version/phishing chips.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('../../../stores/appStore.js', () => ({
  useAppStore: (selector) => {
    const state = { currentAgent: { id: 'agent-x', name: 'test-agent' } };
    return selector ? selector(state) : state;
  },
}));

import WidgetArtifactsSection from '../WidgetArtifactsSection.jsx';
import useWidgetArtifactsStore from '../../../stores/widgetArtifactsStore.js';

beforeEach(() => {
  // Fresh store before each test
  useWidgetArtifactsStore.setState({
    byAgent: new Map(),
    latestRenderByWidget: new Map(),
    openArtifact: null,
  });
  // Default fetch mock — empty audit
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, widgets: [] }),
  });
});
afterEach(() => cleanup());

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

describe('empty state', () => {
  it('renders a friendly placeholder when no widgets are cached', () => {
    render(<WidgetArtifactsSection />);
    // Section header is present (use the uppercase WIDGETS heading specifically)
    expect(document.body.textContent).toMatch(/Widgets/);
    // The empty-state copy is present
    expect(screen.getByText(/No widgets rendered yet/i)).toBeInTheDocument();
  });
});

describe('populated state', () => {
  it('renders one card per widget, newest-rendered first', () => {
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-x', [
      mkSummary({ widgetId: 'old',  lastRenderedAt: '2026-04-25T08:00:00Z' }),
      mkSummary({ widgetId: 'new',  lastRenderedAt: '2026-04-25T12:00:00Z' }),
      mkSummary({ widgetId: 'mid',  lastRenderedAt: '2026-04-25T10:00:00Z' }),
    ]);
    render(<WidgetArtifactsSection />);
    const cards = screen.getAllByTestId('widget-artifact-card');
    expect(cards).toHaveLength(3);
    // Order — newest first
    expect(cards[0].textContent).toContain('new');
    expect(cards[1].textContent).toContain('mid');
    expect(cards[2].textContent).toContain('old');
  });

  it('shows version count chip when > 1', () => {
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-x', [
      mkSummary({ widgetId: 'w1', versionCount: 5 }),
      mkSummary({ widgetId: 'w2', versionCount: 1 }),
    ]);
    render(<WidgetArtifactsSection />);
    // v5 chip visible for w1
    expect(screen.getByText('v5')).toBeInTheDocument();
    // v1 NOT shown for w2 (single-version widgets don't get a chip)
    expect(screen.queryByText('v1')).toBeNull();
  });

  it('shows kind chip with correct label', () => {
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-x', [
      mkSummary({ widgetId: 'h', kind: 'html' }),
      mkSummary({ widgetId: 'j', kind: 'jsx' }),
      mkSummary({ widgetId: 'w', kind: 'webcomponent' }),
    ]);
    render(<WidgetArtifactsSection />);
    expect(screen.getByText('html')).toBeInTheDocument();
    expect(screen.getByText('jsx')).toBeInTheDocument();
    expect(screen.getByText('web component')).toBeInTheDocument();
  });

  it('shows phishing flag chip with title=hits when phishingHits is non-empty', () => {
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-x', [
      mkSummary({ widgetId: 'pw', phishingHits: ['password', 'credit card'] }),
      mkSummary({ widgetId: 'ok', phishingHits: [] }),
    ]);
    render(<WidgetArtifactsSection />);
    // The flagged card has a chip whose title attribute lists the hits
    const flaggedChip = document.querySelector('[title="password, credit card"]');
    expect(flaggedChip).toBeTruthy();
    // The non-flagged card has no such chip
    expect(document.querySelectorAll('[title*="password"]')).toHaveLength(1);
  });

  it('clicking a card sets openArtifact in the store', () => {
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-x', [
      mkSummary({ widgetId: 'click-me' }),
    ]);
    render(<WidgetArtifactsSection />);
    fireEvent.click(screen.getByTestId('widget-artifact-card'));
    expect(useWidgetArtifactsStore.getState().openArtifact).toEqual({
      agentId: 'agent-x',
      widgetId: 'click-me',
    });
  });
});

describe('agent isolation', () => {
  it('only renders widgets for the CURRENT agent — others are not visible', () => {
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-x', [
      mkSummary({ widgetId: 'mine' }),
    ]);
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-other', [
      mkSummary({ widgetId: 'theirs' }),
    ]);
    render(<WidgetArtifactsSection />);
    expect(screen.getByText('mine')).toBeInTheDocument();
    expect(screen.queryByText('theirs')).toBeNull();
  });
});

describe('upgrade-available badge (linked, non-diverged widgets)', () => {
  it('renders the upgrade chip when /check-upgrade reports hasUpgrade=true', async () => {
    const linkedSummary = mkSummary({
      widgetId: 'linked',
      linkedGalleryTemplateId: 'tpl',
      linkedGalleryVersion: 1,
    });
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/widget/audit')) {
        // Audit must return the linked summary, otherwise the section's
        // mount effect would clobber the pre-seeded store.
        return Promise.resolve({ ok: true, json: async () => ({ success: true, widgets: [linkedSummary] }) });
      }
      if (url.includes('/api/widget/check-upgrade')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, hasUpgrade: true, currentVersion: 1, latestVersion: 2 }),
        });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-x', [linkedSummary]);
    render(<WidgetArtifactsSection />);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="upgrade-available-badge"]')).toBeTruthy();
    });
  });

  it('does NOT render the badge for diverged widgets (no fetch issued)', async () => {
    let upgradeChecked = false;
    const divergedSummary = mkSummary({
      widgetId: 'd', linkedGalleryTemplateId: 'tpl', divergedFromGallery: true,
    });
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/widget/audit')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, widgets: [divergedSummary] }) });
      }
      if (url.includes('/api/widget/check-upgrade')) {
        upgradeChecked = true;
        return Promise.resolve({ ok: true, json: async () => ({ success: true, hasUpgrade: true }) });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    useWidgetArtifactsStore.getState().setSummariesForAgent('agent-x', [divergedSummary]);
    render(<WidgetArtifactsSection />);
    await new Promise(r => setTimeout(r, 30));
    expect(upgradeChecked).toBe(false);
    expect(document.querySelector('[data-testid="upgrade-available-badge"]')).toBeNull();
  });
});

describe('initial fetch', () => {
  it('fetches /api/widget/audit on mount and populates the store', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        widgets: [mkSummary({ widgetId: 'remote-w' })],
      }),
    });
    render(<WidgetArtifactsSection />);
    // Wait for fetch + state update
    await new Promise(r => setTimeout(r, 10));
    expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('/api/widget/audit'));
  });
});
