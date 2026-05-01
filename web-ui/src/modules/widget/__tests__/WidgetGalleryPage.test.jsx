/**
 * WidgetGalleryPage — /widget-gallery route. Tests cover loading,
 * empty state, populated grid, tag filter, refresh, and unshare.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import WidgetGalleryPage from '../WidgetGalleryPage.jsx';

const mkTemplate = (overrides) => ({
  templateId: 'loan-calc-v1-abcd',
  version: 1,
  title: 'Loan calculator',
  kind: 'webcomponent',
  tags: ['finance', 'demo'],
  sharedAt: '2026-04-25T10:00:00Z',
  sharedBy: { agentId: 'a', agentName: 'Coder', sessionId: null },
  renderCount: 0,
  starred: false,
  forkedFrom: null,
  phishingHits: [],
  size: 200,
  ...overrides,
});

beforeEach(() => {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ success: true, count: 0, templates: [] }),
  });
  // confirm() defaults to true so unshare flow proceeds
  global.confirm = vi.fn(() => true);
});
afterEach(() => cleanup());

describe('empty state', () => {
  it('shows a friendly placeholder when the gallery is empty', async () => {
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getByText(/No widgets in the gallery yet/i)).toBeInTheDocument());
    expect(screen.getByText(/Open a widget in the artifacts panel/i)).toBeInTheDocument();
  });
});

describe('populated state', () => {
  it('renders one card per template with title + version + tags', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true, count: 2,
        templates: [
          mkTemplate({ templateId: 'a', title: 'A', tags: ['x'] }),
          mkTemplate({ templateId: 'b', title: 'B', tags: ['y', 'z'] }),
        ],
      }),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getAllByTestId('gallery-card')).toHaveLength(2));
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
    // Tags appear both in their card AND in the tag-filter dropdown,
    // so use getAllByText to tolerate the duplication.
    expect(screen.getAllByText('#x').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('#y').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('#z').length).toBeGreaterThanOrEqual(1);
  });

  it('header reports the count', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, count: 3, templates: [
        mkTemplate({ templateId: '1' }),
        mkTemplate({ templateId: '2' }),
        mkTemplate({ templateId: '3' }),
      ]}),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getByText('3 templates')).toBeInTheDocument());
  });

  it('shows the phishing flag chip when a template has phishingHits', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, count: 1, templates: [
        mkTemplate({ phishingHits: ['password', 'credit card'] }),
      ]}),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(document.querySelector('[title="password, credit card"]')).toBeTruthy());
  });
});

describe('tag filter', () => {
  it('refetches with ?tag=X when the user picks a filter', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, count: 1, templates: [
        mkTemplate({ tags: ['finance'] }),
      ]}),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getAllByTestId('gallery-card')).toHaveLength(1));
    // The filter dropdown is rendered when there are tags
    const select = screen.getByLabelText('Filter by tag');
    fireEvent.change(select, { target: { value: 'finance' } });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining('?tag=finance'));
    });
  });
});

describe('unshare', () => {
  it('clicking a card\'s trash icon DELETEs the template and refreshes', async () => {
    let listCalls = 0;
    global.fetch = vi.fn().mockImplementation((url, opts) => {
      if (opts?.method === 'DELETE') {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, removed: true }) });
      }
      listCalls++;
      return Promise.resolve({
        ok: true, json: async () => ({
          success: true, count: 1,
          templates: listCalls === 1 ? [mkTemplate({ templateId: 'gone' })] : [],
        }),
      });
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getAllByTestId('gallery-card')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('card-unshare'));
    // confirm() returns true, DELETE is called, list re-fetched
    await waitFor(() => {
      const deleteCalls = global.fetch.mock.calls.filter(([, o]) => o?.method === 'DELETE');
      expect(deleteCalls).toHaveLength(1);
      expect(deleteCalls[0][0]).toContain('/api/widget/gallery/');
    });
    await waitFor(() => expect(screen.queryByTestId('gallery-card')).toBeNull());
  });

  it('confirm() returning false aborts — no DELETE issued', async () => {
    global.confirm = vi.fn(() => false);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, count: 1, templates: [mkTemplate()] }),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getAllByTestId('gallery-card')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('card-unshare'));
    // Wait a tick; no DELETE should fire
    await new Promise(r => setTimeout(r, 20));
    const deleteCalls = global.fetch.mock.calls.filter(([, o]) => o?.method === 'DELETE');
    expect(deleteCalls).toHaveLength(0);
  });
});

describe('refresh button', () => {
  it('triggers another fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: true, count: 0, templates: [] }),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByTitle(/refresh/i));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});

describe('error state', () => {
  it('shows the backend error message', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, json: async () => ({ success: false, error: 'something went wrong' }),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getByText(/something went wrong/i)).toBeInTheDocument());
  });
});

describe('per-template trust prompt', () => {
  beforeEach(() => {
    // localStorage trust persists between tests — clear it.
    try { window.localStorage.clear(); window.sessionStorage.clear(); } catch (_) {}
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true, count: 1,
        templates: [mkTemplate({ templateId: 't1', title: 'T1' })],
      }),
    });
  });

  it('untrusted card shows the trust prompt with two grant buttons', async () => {
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getByText(/Preview hidden/i)).toBeInTheDocument());
    expect(screen.getByTestId('trust-template-btn')).toBeInTheDocument();
    expect(screen.getByTestId('trust-author-session-btn')).toBeInTheDocument();
  });

  it('clicking "Trust this template" elevates trust + dismisses the prompt', async () => {
    // Mock the single-template fetch so the iframe gets content after trust.
    global.fetch = vi.fn().mockImplementation((url) => {
      if (String(url).includes('/api/widget/gallery/t1')) {
        return Promise.resolve({ ok: true, json: async () => ({ success: true, template: mkTemplate({ templateId: 't1', content: '<p>hi</p>' }) }) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ success: true, count: 1, templates: [mkTemplate({ templateId: 't1', title: 'T1' })] }) });
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getByTestId('trust-template-btn')).toBeInTheDocument());
    fireEvent.click(screen.getByTestId('trust-template-btn'));
    // Prompt disappears, revoke button appears
    await waitFor(() => expect(screen.queryByTestId('trust-template-btn')).toBeNull());
    expect(screen.getByTestId('revoke-template-btn')).toBeInTheDocument();
  });

  it('"Trust author (session)" button is omitted when sharedBy.agentId is missing', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true, count: 1,
        templates: [mkTemplate({ sharedBy: { agentId: null, agentName: null } })],
      }),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getByTestId('trust-template-btn')).toBeInTheDocument());
    expect(screen.queryByTestId('trust-author-session-btn')).toBeNull();
  });

  it('untrusted state does NOT lazy-fetch full content (saves bandwidth)', async () => {
    const fetchSpy = global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, count: 1, templates: [mkTemplate({ templateId: 't1' })] }),
    });
    render(<WidgetGalleryPage />);
    await waitFor(() => expect(screen.getByTestId('trust-template-btn')).toBeInTheDocument());
    // The list endpoint is the only call — the per-template content fetch
    // is gated on `isTrusted`.
    const calls = fetchSpy.mock.calls.map(c => String(c[0]));
    expect(calls.some(u => u.includes('/api/widget/gallery/t1'))).toBe(false);
  });
});
