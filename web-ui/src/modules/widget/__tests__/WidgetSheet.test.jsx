/**
 * WidgetSheet — full-size viewer for a widget artifact.
 *
 * Coverage:
 *   - Mounts only when openArtifact is set
 *   - Fetches /api/widget/full and shows the active version's iframe
 *   - Version pills appear when versionCount > 1
 *   - Selecting a non-main version shows the "Pin as main" button
 *   - "Pin as main" POSTs /api/widget/set-main + updates the store
 *   - Closing via backdrop / × clears openArtifact
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

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import WidgetSheet from '../WidgetSheet.jsx';
import useWidgetArtifactsStore from '../../../stores/widgetArtifactsStore.js';

const buildWidget = (overrides) => ({
  widgetId: 'w1',
  kind: 'html',
  content: '<p>v2</p>',
  props: {},
  phishingHits: [],
  size: 12,
  createdAt: '2026-04-25T09:00:00Z',
  updatedAt: '2026-04-25T10:00:00Z',
  lastRenderedAt: '2026-04-25T10:00:00Z',
  versions: [
    { versionId: 'v-1', kind: 'html', content: '<p>v1</p>', props: {}, phishingHits: [], size: 11, createdAt: '2026-04-25T09:00:00Z' },
    { versionId: 'v-2', kind: 'html', content: '<p>v2</p>', props: {}, phishingHits: [], size: 12, createdAt: '2026-04-25T10:00:00Z' },
  ],
  mainVersionId: 'v-2',
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
  // Pre-grant trust so IframeWidget renders the iframe (not the
  // strip-to-static placeholder), simplifying assertions.
  localStorage.setItem('loxia-widget-trust-template-w1', 'true');
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('mounting / unmounting', () => {
  it('renders nothing when openArtifact is null', () => {
    const { container } = render(<WidgetSheet />);
    // The sheet is portaled — querying through document keeps it correct.
    expect(document.querySelector('[data-testid="widget-sheet-backdrop"]')).toBeNull();
  });

  it('renders the sheet when openArtifact is set', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: buildWidget() }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => {
      expect(document.querySelector('[data-testid="widget-sheet-backdrop"]')).toBeTruthy();
    });
  });
});

describe('version pills', () => {
  it('shows one pill per version when there is more than 1', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: buildWidget() }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => {
      // 1 main pill + 1 non-main pill
      const pills = document.querySelectorAll('[data-testid^="version-pill"]');
      expect(pills.length).toBe(2);
    });
    expect(document.querySelectorAll('[data-testid="version-pill-main"]').length).toBe(1);
  });

  it('does NOT render the version selector when there is only 1 version', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, widget: buildWidget({ versions: [
        { versionId: 'v-1', kind: 'html', content: '<p>only</p>', props: {}, phishingHits: [], size: 13, createdAt: '2026-04-25T09:00:00Z' },
      ], mainVersionId: 'v-1' }) }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => {
      expect(document.querySelectorAll('[data-testid^="version-pill"]').length).toBe(0);
    });
  });
});

describe('Pin as main flow', () => {
  it('clicking a non-main version reveals "Pin as main" button', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: buildWidget() }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => {
      expect(document.querySelector('[data-testid="widget-sheet-backdrop"]')).toBeTruthy();
    });
    // The viewing version is the main by default → button hidden
    expect(document.querySelector('[data-testid="set-main-btn"]')).toBeNull();
    // Click the non-main pill (v-1)
    const pills = document.querySelectorAll('[data-testid^="version-pill"]');
    const nonMain = Array.from(pills).find(p => p.getAttribute('data-testid') === 'version-pill');
    fireEvent.click(nonMain);
    await waitFor(() => {
      expect(document.querySelector('[data-testid="set-main-btn"]')).toBeTruthy();
    });
  });

  it('clicking "Pin as main" POSTs to /api/widget/set-main and updates store', async () => {
    let setMainCalled = false;
    global.fetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/widget/full')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, widget: buildWidget() }) });
      }
      if (url.includes('/api/widget/set-main')) {
        setMainCalled = true;
        const body = JSON.parse(init.body);
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            widget: buildWidget({ mainVersionId: body.versionId }),
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-sheet-backdrop"]')).toBeTruthy());
    // Switch to non-main
    const nonMain = Array.from(document.querySelectorAll('[data-testid="version-pill"]'))[0];
    fireEvent.click(nonMain);
    await waitFor(() => expect(document.querySelector('[data-testid="set-main-btn"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="set-main-btn"]'));
    await waitFor(() => expect(setMainCalled).toBe(true));
  });
});

describe('close behaviour', () => {
  it('clicking the backdrop closes the sheet', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: buildWidget() }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-sheet-backdrop"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="widget-sheet-backdrop"]'));
    expect(useWidgetArtifactsStore.getState().openArtifact).toBeNull();
  });

  it('clicking the X button closes the sheet', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: buildWidget() }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-sheet-backdrop"]')).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(useWidgetArtifactsStore.getState().openArtifact).toBeNull();
  });
});

describe('share / unshare flow', () => {
  it('Share button posts to /api/widget/share + refreshes local widget state', async () => {
    let shareCalled = false;
    global.fetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/widget/full')) {
        // After share, the refetched widget is linked
        const linked = shareCalled;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            widget: buildWidget(linked
              ? { linkedGalleryTemplateId: 'shared-id', linkedGalleryVersion: 1 }
              : {}),
          }),
        });
      }
      if (url.includes('/api/widget/share') && init?.method === 'POST') {
        shareCalled = true;
        return Promise.resolve({
          ok: true,
          json: async () => ({ success: true, templateId: 'shared-id', version: 1 }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="share-btn"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="share-btn"]'));
    await waitFor(() => expect(shareCalled).toBe(true));
    // Header now shows "shared in gallery" chip
    await waitFor(() => expect(document.body.textContent).toMatch(/shared in gallery/i));
  });

  it('Unshare button DELETEs the template + clears linkage', async () => {
    let unshareCalled = false;
    let firstFull = true;
    global.fetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/widget/full')) {
        // Pre-unshare: linked. Post-unshare: link cleared.
        const linked = !unshareCalled && firstFull;
        firstFull = false;
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            widget: buildWidget(linked
              ? { linkedGalleryTemplateId: 'tpl-x', linkedGalleryVersion: 1 }
              : { linkedGalleryTemplateId: null, linkedGalleryVersion: null }),
          }),
        });
      }
      if (url.includes('/api/widget/gallery/') && init?.method === 'DELETE') {
        unshareCalled = true;
        return Promise.resolve({
          ok: true, json: async () => ({ success: true, removed: true }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="unshare-btn"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="unshare-btn"]'));
    await waitFor(() => expect(unshareCalled).toBe(true));
  });
});

describe('upgrade prompt', () => {
  it('shows the banner when /check-upgrade reports hasUpgrade=true', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/widget/full')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            widget: buildWidget({
              linkedGalleryTemplateId: 'tpl-x',
              linkedGalleryVersion: 1,
              divergedFromGallery: false,
            }),
          }),
        });
      }
      if (url.includes('/api/widget/check-upgrade')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true, hasUpgrade: true,
            currentVersion: 1, latestVersion: 2,
            latestTemplateId: 'tpl-y',
          }),
        });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="upgrade-banner"]')).toBeTruthy());
    expect(document.body.textContent).toMatch(/v2.*is available/);
  });

  it('does NOT show the banner for a diverged widget', async () => {
    global.fetch = vi.fn().mockImplementation((url) => {
      if (url.includes('/api/widget/full')) {
        return Promise.resolve({
          ok: true, json: async () => ({
            success: true,
            widget: buildWidget({
              linkedGalleryTemplateId: 'tpl-x',
              linkedGalleryVersion: 1,
              divergedFromGallery: true, // ← diverged
            }),
          }),
        });
      }
      // check-upgrade should NOT be called when diverged
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-sheet-backdrop"]')).toBeTruthy());
    // Give the upgrade-check effect a tick — it should bail out
    await new Promise(r => setTimeout(r, 20));
    expect(document.querySelector('[data-testid="upgrade-banner"]')).toBeNull();
  });

  it('clicking Upgrade POSTs /apply-upgrade and clears the banner', async () => {
    let upgradeCalled = false;
    global.fetch = vi.fn().mockImplementation((url, init) => {
      if (url.includes('/api/widget/full')) {
        return Promise.resolve({
          ok: true, json: async () => ({
            success: true,
            widget: buildWidget({
              linkedGalleryTemplateId: 'tpl-x',
              linkedGalleryVersion: upgradeCalled ? 2 : 1,
            }),
          }),
        });
      }
      if (url.includes('/api/widget/check-upgrade')) {
        return Promise.resolve({
          ok: true, json: async () => ({
            success: true,
            hasUpgrade: !upgradeCalled,
            currentVersion: upgradeCalled ? 2 : 1,
            latestVersion: 2,
          }),
        });
      }
      if (url.includes('/api/widget/apply-upgrade') && init?.method === 'POST') {
        upgradeCalled = true;
        return Promise.resolve({
          ok: true, json: async () => ({
            success: true, fromVersion: 1, toVersion: 2,
            newVersionId: 'v-new',
          }),
        });
      }
      return Promise.reject(new Error(`unexpected: ${url}`));
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="apply-upgrade-btn"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="apply-upgrade-btn"]'));
    await waitFor(() => expect(upgradeCalled).toBe(true));
    // Banner clears once upgrade is applied
    await waitFor(() => expect(document.querySelector('[data-testid="upgrade-banner"]')).toBeNull());
  });
});

describe('trust bar (interactive widgets)', () => {
  beforeEach(() => {
    // Override the test-default trust grant so we exercise the untrusted path.
    localStorage.clear();
    sessionStorage.clear();
  });

  // Build a webcomponent widget where BOTH the top-level + versions[]
  // entries are kind:'webcomponent' (the trust bar checks viewedVersion.kind).
  const wcWidget = () => buildWidget({
    kind: 'webcomponent',
    content: 'class C extends LoxiaElement {}',
    versions: [
      { versionId: 'v-1', kind: 'webcomponent', content: 'class C extends LoxiaElement {}', props: {}, phishingHits: [], size: 30, createdAt: '2026-04-25T10:00:00Z' },
    ],
    mainVersionId: 'v-1',
  });

  it('untrusted webcomponent widget shows the trust bar with both grant buttons', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: wcWidget() }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-trust-bar"]')).toBeTruthy());
    expect(document.querySelector('[data-testid="trust-widget-btn"]')).toBeTruthy();
    expect(document.querySelector('[data-testid="trust-agent-session-btn"]')).toBeTruthy();
  });

  it('clicking "Trust this widget" makes the trust bar disappear and the revoke control appear', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: wcWidget() }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="trust-widget-btn"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="trust-widget-btn"]'));
    await waitFor(() => expect(document.querySelector('[data-testid="widget-trust-bar"]')).toBeNull());
    expect(document.querySelector('[data-testid="revoke-trust-btn"]')).toBeTruthy();
  });

  it('html-kind widgets do NOT show the trust bar (no scripts ever, nothing to trust)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: buildWidget({ kind: 'html' }) }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-sheet-backdrop"]')).toBeTruthy());
    expect(document.querySelector('[data-testid="widget-trust-bar"]')).toBeNull();
  });
});

describe('inline rename', () => {
  beforeEach(() => {
    localStorage.setItem('loxia-widget-trust-template-w1', 'true');
  });

  it('header shows widgetId in monospace when no name is set, with pencil rename button', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: buildWidget() }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-sheet-title"]')).toBeTruthy());
    expect(document.querySelector('[data-testid="widget-sheet-title"]').textContent).toBe('w1');
    expect(document.querySelector('[data-testid="widget-rename-btn"]')).toBeTruthy();
  });

  it('header shows the friendly name when set, with widgetId as subtitle', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, widget: buildWidget({ name: 'My Calc' }) }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-sheet-title"]')?.textContent).toBe('My Calc'));
    // Subtitle still shows widgetId for traceability
    expect(document.body.textContent).toMatch(/w1/);
  });

  it('clicking the pencil opens an input pre-populated with current name; Enter commits via POST', async () => {
    let renameBody = null;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (String(url).endsWith('/api/widget/rename')) {
        renameBody = JSON.parse(options.body);
        return Promise.resolve({
          ok: true, json: async () => ({
            success: true, name: 'Calculator',
            widget: buildWidget({ name: 'Calculator' }),
          }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, widget: buildWidget() }) });
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-rename-btn"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="widget-rename-btn"]'));
    const input = await waitFor(() => {
      const el = document.querySelector('[data-testid="widget-rename-input"]');
      if (!el) throw new Error('input not found');
      return el;
    });
    fireEvent.change(input, { target: { value: 'Calculator' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(renameBody).toEqual({ agentId: 'agent-x', widgetId: 'w1', name: 'Calculator' }));
  });

  it('Escape cancels the rename without sending a request', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation((url) => {
      calls++;
      if (String(url).endsWith('/api/widget/rename')) {
        throw new Error('rename should NOT have been called');
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, widget: buildWidget() }) });
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-rename-btn"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="widget-rename-btn"]'));
    const input = await waitFor(() => document.querySelector('[data-testid="widget-rename-input"]') || Promise.reject());
    fireEvent.change(input, { target: { value: 'Whatever' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    // Input should disappear; pencil restored.
    await waitFor(() => expect(document.querySelector('[data-testid="widget-rename-input"]')).toBeNull());
  });

  it('empty submission clears the name (sends name: null)', async () => {
    let renameBody = null;
    global.fetch = vi.fn().mockImplementation((url, options) => {
      if (String(url).endsWith('/api/widget/rename')) {
        renameBody = JSON.parse(options.body);
        return Promise.resolve({
          ok: true, json: async () => ({ success: true, name: null, widget: buildWidget({ name: null }) }),
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, widget: buildWidget({ name: 'Old' }) }) });
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'w1' });
    await waitFor(() => expect(document.querySelector('[data-testid="widget-rename-btn"]')).toBeTruthy());
    fireEvent.click(document.querySelector('[data-testid="widget-rename-btn"]'));
    const input = await waitFor(() => document.querySelector('[data-testid="widget-rename-input"]') || Promise.reject());
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(renameBody?.name).toBeNull());
  });
});

describe('error states', () => {
  it('shows the error message when /api/widget/full fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 404,
      json: async () => ({ success: false, error: 'Widget not found: x' }),
    });
    render(<WidgetSheet />);
    useWidgetArtifactsStore.getState().openInPanel({ agentId: 'agent-x', widgetId: 'x' });
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/Widget not found/);
    });
  });
});
