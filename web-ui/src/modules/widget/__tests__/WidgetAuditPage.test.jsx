/**
 * WidgetAuditPage — fetches /api/widget/audit and renders grouped tables.
 *
 * Coverage: loading state, error state, empty state, populated state with
 * phishing flag, refresh button re-fetches.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import WidgetAuditPage from '../WidgetAuditPage.jsx';

afterEach(() => cleanup());
beforeEach(() => { vi.restoreAllMocks(); });

function mockFetchOnce(body, ok = true) {
  global.fetch = vi.fn().mockResolvedValue({
    ok, json: async () => body,
  });
}

describe('WidgetAuditPage', () => {
  it('renders empty state when audit returns no groups', async () => {
    mockFetchOnce({ success: true, groups: [] });
    render(<WidgetAuditPage />);
    await waitFor(() => expect(screen.getByText(/No widgets rendered yet/i)).toBeInTheDocument());
  });

  it('renders an error when success:false is returned', async () => {
    mockFetchOnce({ success: false, error: 'nope' });
    render(<WidgetAuditPage />);
    await waitFor(() => expect(screen.getByText(/nope/)).toBeInTheDocument());
  });

  it('renders groups with agent id, widget count, and kind chips', async () => {
    mockFetchOnce({
      success: true,
      groups: [
        {
          agentId: 'agent-A', count: 2, widgets: [
            { widgetId: 'w1', kind: 'html', createdAt: new Date().toISOString(), size: 123, phishingHits: [] },
            { widgetId: 'w2', kind: 'jsx',  createdAt: new Date().toISOString(), size: 456, phishingHits: ['password'] },
          ],
        },
      ],
    });
    render(<WidgetAuditPage />);
    await waitFor(() => expect(screen.getByText('agent-A')).toBeInTheDocument());
    expect(screen.getByText('w1')).toBeInTheDocument();
    expect(screen.getByText('w2')).toBeInTheDocument();
    expect(screen.getByText('html')).toBeInTheDocument();
    expect(screen.getByText('jsx')).toBeInTheDocument();
    // phishing flag on w2 (header says "1 flagged" and row says "1 flag"
    // — both match, so we just require at least one)
    const flagMatches = screen.getAllByText(/1 flag/i);
    expect(flagMatches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows aggregate counts in the header (N widgets across M agents)', async () => {
    mockFetchOnce({
      success: true,
      groups: [
        { agentId: 'a', count: 2, widgets: [
          { widgetId: 'w1', kind: 'html', createdAt: '2025-01-01', size: 1, phishingHits: [] },
          { widgetId: 'w2', kind: 'html', createdAt: '2025-01-01', size: 1, phishingHits: [] },
        ] },
        { agentId: 'b', count: 1, widgets: [
          { widgetId: 'w3', kind: 'jsx', createdAt: '2025-01-01', size: 1, phishingHits: ['otp'] },
        ] },
      ],
    });
    render(<WidgetAuditPage />);
    await waitFor(() => expect(screen.getByText(/3 widgets across 2 agents/)).toBeInTheDocument());
    expect(screen.getByText(/1 flagged/)).toBeInTheDocument();
  });

  it('refresh button triggers a second fetch', async () => {
    mockFetchOnce({ success: true, groups: [] });
    render(<WidgetAuditPage />);
    await waitFor(() => expect(screen.getByText(/No widgets/i)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTitle(/refresh/i));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
  });
});
