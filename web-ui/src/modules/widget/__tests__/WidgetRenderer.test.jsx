/**
 * WidgetRenderer — the gate between the tool-call and the IframeWidget.
 *
 * Scenarios covered:
 *   1. No widget in result → renders nothing
 *   2. First-use (no stored decision) → confirmation modal appears
 *   3. "always" stored → modal skipped, iframe renders
 *   4. "block" stored → blocked placeholder with Undo
 *   5. Allow-once decision → renders without persisting
 *   6. Widget events are forwarded via api.postWidgetEvent
 *   7. Phishing widget → modal shows phishing copy
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react';

// Mock the zustand store — WidgetRenderer reads currentAgent.
vi.mock('../../../stores/appStore.js', () => ({
  useAppStore: () => ({ currentAgent: { id: 'agent-x', name: 'test-agent' } }),
}));

// Mock the api module so we can assert postWidgetEvent calls.
const postWidgetEvent = vi.fn().mockResolvedValue({ success: true });
vi.mock('../../../services/api.js', () => ({
  api: { postWidgetEvent: (...args) => postWidgetEvent(...args) },
}));

vi.mock('react-hot-toast', () => ({
  default: { error: vi.fn(), success: vi.fn() },
}));

import WidgetRenderer from '../WidgetRenderer.jsx';
import useWidgetArtifactsStore from '../../../stores/widgetArtifactsStore.js';

function parsedDataFor(widget) {
  return { _result: widget ? { widget } : {} };
}
const baseWidget = {
  widgetId: 'w1',
  kind: 'html',
  content: '<p>hi</p>',
  props: {},
};

beforeEach(() => {
  localStorage.clear();
  postWidgetEvent.mockClear();
  // Reset widget-artifacts store between tests so dedup observations
  // from earlier tests don't leak.
  useWidgetArtifactsStore.setState({
    byAgent: new Map(),
    latestRenderByWidget: new Map(),
    openArtifact: null,
  });
});
afterEach(() => cleanup());

describe('WidgetRenderer', () => {
  it('renders nothing for non-render actions with no widget (silent)', () => {
    const { container } = render(
      <WidgetRenderer parsedData={{ parameters: { action: 'list' }, _result: { widgets: [] } }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows a visible "disabled" hint when result.disabled is true', () => {
    render(
      <WidgetRenderer parsedData={{
        parameters: { action: 'render' },
        _result: { success: false, disabled: true, error: 'Custom widgets are disabled…' },
      }} />
    );
    expect(screen.getByText(/custom widgets are disabled/i)).toBeInTheDocument();
  });

  it('shows a visible error hint when result has error', () => {
    render(
      <WidgetRenderer parsedData={{
        parameters: { action: 'render' },
        _result: { success: false, error: 'kind must be one of: html, jsx' },
      }} />
    );
    expect(screen.getByText(/kind must be one of/i)).toBeInTheDocument();
  });

  it('first render (no decision) → shows confirmation modal', async () => {
    render(<WidgetRenderer parsedData={parsedDataFor(baseWidget)} />);
    await waitFor(() => {
      expect(screen.getByText(/Allow test-agent to render/i)).toBeInTheDocument();
    });
    // iframe not yet mounted
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('"always" decision persists and skips the modal on next mount', async () => {
    // Prime the decision
    localStorage.setItem('loxia-widget-allow-agent-x', 'always');
    render(<WidgetRenderer parsedData={parsedDataFor(baseWidget)} />);
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy());
    // No modal
    expect(screen.queryByText(/Allow test-agent to render/i)).not.toBeInTheDocument();
  });

  it('"block" decision renders the blocked placeholder with Undo', async () => {
    localStorage.setItem('loxia-widget-allow-agent-x', 'block');
    render(<WidgetRenderer parsedData={parsedDataFor(baseWidget)} />);
    await waitFor(() => expect(screen.getByText(/are blocked/i)).toBeInTheDocument());
    expect(document.querySelector('iframe')).toBeNull();
    const undo = screen.getByRole('button', { name: /undo/i });
    fireEvent.click(undo);
    // After Undo, the modal returns
    await waitFor(() => expect(screen.getByText(/Allow test-agent to render/i)).toBeInTheDocument());
    // And the stored decision is cleared
    expect(localStorage.getItem('loxia-widget-allow-agent-x')).toBeNull();
  });

  it('Allow once → renders without persisting', async () => {
    render(<WidgetRenderer parsedData={parsedDataFor(baseWidget)} />);
    await waitFor(() => screen.getByText(/Allow test-agent to render/i));
    fireEvent.click(screen.getByRole('button', { name: /allow once/i }));
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy());
    // Not persisted
    expect(localStorage.getItem('loxia-widget-allow-agent-x')).toBeNull();
  });

  it('Always allow → renders AND persists', async () => {
    render(<WidgetRenderer parsedData={parsedDataFor(baseWidget)} />);
    await waitFor(() => screen.getByText(/Allow test-agent to render/i));
    fireEvent.click(screen.getByRole('button', { name: /always allow/i }));
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy());
    expect(localStorage.getItem('loxia-widget-allow-agent-x')).toBe('always');
  });

  it('Block from the modal → blocked placeholder, persisted', async () => {
    render(<WidgetRenderer parsedData={parsedDataFor(baseWidget)} />);
    await waitFor(() => screen.getByText(/Allow test-agent to render/i));
    fireEvent.click(screen.getByRole('button', { name: /^block$/i }));
    await waitFor(() => expect(screen.getByText(/are blocked/i)).toBeInTheDocument());
    expect(localStorage.getItem('loxia-widget-allow-agent-x')).toBe('block');
  });

  it('phishing content → modal renders the scary copy', async () => {
    const w = { ...baseWidget, widgetId: 'wp', content: 'Please enter your password' };
    render(<WidgetRenderer parsedData={parsedDataFor(w)} />);
    await waitFor(() => screen.getByText(/asks for sensitive information/i));
    expect(screen.getByText(/Phishing-shape detected/i)).toBeInTheDocument();
  });

  it('forwards widget events via api.postWidgetEvent', async () => {
    localStorage.setItem('loxia-widget-allow-agent-x', 'always');
    render(<WidgetRenderer parsedData={parsedDataFor(baseWidget)} />);
    const iframe = await waitFor(() => {
      const el = document.querySelector('iframe');
      if (!el) throw new Error('no iframe');
      return el;
    });
    // Simulate the iframe posting an event message. The IframeWidget's
    // message handler authenticates by source — we craft a message whose
    // source is the iframe's contentWindow.
    await act(async () => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __loxia: true, type: 'event', widgetId: 'w1', payload: { kind: 'click', x: 1 } },
        source: iframe.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(postWidgetEvent).toHaveBeenCalledWith(expect.objectContaining({
        agentId: 'agent-x',
        widgetId: 'w1',
        payload: { kind: 'click', x: 1 },
      }));
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Chat-feed dedup — only the LATEST render of a widget renders inline;
// earlier renders collapse to a one-line stub linking to the artifacts
// panel. Avoids "1000 copies" in the chat as the agent iterates.
// ─────────────────────────────────────────────────────────────────────────

describe('WidgetRenderer — chat dedup (only latest render shows inline)', () => {
  it('first render of a widget shows inline (no observations exist yet)', async () => {
    localStorage.setItem('loxia-widget-allow-agent-x', 'always');
    render(
      <WidgetRenderer
        parsedData={parsedDataFor(baseWidget)}
        messageTimestamp="2026-04-25T10:00:00Z"
      />
    );
    await waitFor(() => expect(document.querySelector('iframe')).toBeTruthy());
    expect(document.querySelector('[data-testid="widget-superseded"]')).toBeNull();
  });

  it('subsequent render with NEWER timestamp shows inline; the OLDER one collapses to stub', () => {
    localStorage.setItem('loxia-widget-allow-agent-x', 'always');
    // Pre-mark a newer render in the store — simulates the chat
    // feed having already mounted the latest version's renderer.
    useWidgetArtifactsStore.getState().markRenderObservation(
      'agent-x', baseWidget.widgetId, '2026-04-25T11:00:00Z'
    );
    // This renderer is for the OLDER message (10:00, while latest is 11:00)
    render(
      <WidgetRenderer
        parsedData={parsedDataFor(baseWidget)}
        messageTimestamp="2026-04-25T10:00:00Z"
      />
    );
    // Stub appears, full iframe does not
    expect(document.querySelector('[data-testid="widget-superseded"]')).toBeTruthy();
    expect(document.body.textContent).toMatch(/was updated/i);
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('clicking "Open in Artifacts" on the stub sets the panel\'s open artifact', () => {
    localStorage.setItem('loxia-widget-allow-agent-x', 'always');
    // Use ISO timestamps so lexical ordering matches chronological.
    useWidgetArtifactsStore.getState().markRenderObservation(
      'agent-x', baseWidget.widgetId, '2026-04-25T11:00:00Z'
    );
    render(
      <WidgetRenderer
        parsedData={parsedDataFor(baseWidget)}
        messageTimestamp="2026-04-25T10:00:00Z"
      />
    );
    const btn = screen.getByRole('button', { name: /open in artifacts/i });
    fireEvent.click(btn);
    expect(useWidgetArtifactsStore.getState().openArtifact).toEqual({
      agentId: 'agent-x',
      widgetId: 'w1',
    });
  });

  it('upserts a summary into the artifacts store when a render arrives', async () => {
    localStorage.setItem('loxia-widget-allow-agent-x', 'always');
    const widget = {
      ...baseWidget,
      versions: [{}, {}, {}], // 3 versions
      mainVersionId: 'v-3',
      lastRenderedAt: '2026-04-25T10:00:00Z',
      updatedAt: '2026-04-25T10:00:00Z',
      createdAt: '2026-04-25T09:00:00Z',
    };
    render(
      <WidgetRenderer
        parsedData={parsedDataFor(widget)}
        messageTimestamp="2026-04-25T10:00:00Z"
      />
    );
    await waitFor(() => {
      const summaries = useWidgetArtifactsStore.getState().getSummariesForAgent('agent-x');
      expect(summaries).toHaveLength(1);
      expect(summaries[0].widgetId).toBe('w1');
      expect(summaries[0].versionCount).toBe(3);
      expect(summaries[0].mainVersionId).toBe('v-3');
    });
  });
});
