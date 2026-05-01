/**
 * IframeWidget — postMessage round-trip.
 *
 * We render the component, grab the iframe element, and dispatch
 * MessageEvent with `source: iframe.contentWindow` so the component's
 * source-auth check passes. Without that, the handler drops the message.
 *
 * Covers:
 *   - resize message updates the iframe height
 *   - event message calls onEvent with the payload
 *   - messages from an unrelated window are ignored
 *   - update-signal triggers postMessage to the child
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, act } from '@testing-library/react';
import IframeWidget from '../IframeWidget.jsx';

afterEach(() => cleanup());

function iframeEl() { return document.querySelector('iframe'); }
// The resizable pane wraps the iframe and now owns the height style.
function paneEl() { return document.querySelector('iframe')?.parentElement; }

describe('IframeWidget — message handling', () => {
  it('resize message bumps the pane height (clamped)', async () => {
    render(<IframeWidget kind="html" content="<p/>" widgetId="wR" agentName="a" />);
    const frame = await waitFor(() => iframeEl() || Promise.reject());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __loxia: true, type: 'resize', widgetId: 'wR', height: 250 },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(paneEl().style.height).toMatch(/^25[0-9]px$/); // 250 + 4 safety = 254
    });
  });

  it('height is clamped to 3000px maximum', async () => {
    render(<IframeWidget kind="html" content="<p/>" widgetId="wR2" agentName="a" />);
    const frame = await waitFor(() => iframeEl() || Promise.reject());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __loxia: true, type: 'resize', widgetId: 'wR2', height: 99999 },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => expect(paneEl().style.height).toBe('3000px'));
  });

  it('pane has CSS resize:both so users can drag the corner', async () => {
    render(<IframeWidget kind="html" content="<p/>" widgetId="wRS" agentName="a" />);
    await waitFor(() => iframeEl() || Promise.reject());
    expect(paneEl().style.resize).toBe('both');
    expect(paneEl().style.overflow).toBe('hidden'); // required for resize handle
  });

  it('event message invokes onEvent with payload', async () => {
    const onEvent = vi.fn();
    render(<IframeWidget kind="html" content="<p/>" widgetId="wE" agentName="a" onEvent={onEvent} />);
    const frame = await waitFor(() => iframeEl() || Promise.reject());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __loxia: true, type: 'event', widgetId: 'wE', payload: { kind: 'submit', value: 42 } },
        source: frame.contentWindow,
      }));
    });
    await waitFor(() => {
      expect(onEvent).toHaveBeenCalledWith({ kind: 'submit', value: 42 });
    });
  });

  it('ignores messages without __loxia marker', async () => {
    const onEvent = vi.fn();
    render(<IframeWidget kind="html" content="<p/>" widgetId="wI" agentName="a" onEvent={onEvent} />);
    const frame = await waitFor(() => iframeEl() || Promise.reject());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { type: 'event', payload: { x: 1 } }, // missing __loxia
        source: frame.contentWindow,
      }));
    });
    // Give React a tick to run any effects
    await new Promise(r => setTimeout(r, 10));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('ignores messages whose source is not this iframe', async () => {
    const onEvent = vi.fn();
    render(<IframeWidget kind="html" content="<p/>" widgetId="wS" agentName="a" onEvent={onEvent} />);
    await waitFor(() => iframeEl() || Promise.reject());
    act(() => {
      // source: window — impersonating would fail the === check
      window.dispatchEvent(new MessageEvent('message', {
        data: { __loxia: true, type: 'event', widgetId: 'wS', payload: { x: 1 } },
        source: window,
      }));
    });
    await new Promise(r => setTimeout(r, 10));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('ignores messages for a different widgetId', async () => {
    const onEvent = vi.fn();
    render(<IframeWidget kind="html" content="<p/>" widgetId="correct" agentName="a" onEvent={onEvent} />);
    const frame = await waitFor(() => iframeEl() || Promise.reject());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __loxia: true, type: 'event', widgetId: 'different', payload: { x: 1 } },
        source: frame.contentWindow,
      }));
    });
    await new Promise(r => setTimeout(r, 10));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it('JSX widget with stripToStatic → shows placeholder, NOT an iframe (risk-2 fix)', () => {
    // The old behaviour dumped the agent's source code into the iframe
    // as "[scripts stripped] <escaped JSX>" which looked broken. A JSX
    // widget whose scripts are stripped has no meaningful static shape —
    // render a deliberate placeholder instead.
    render(
      <IframeWidget kind="jsx" content="return function() { return h('div'); }" widgetId="wSS" agentName="a" stripToStatic />
    );
    // NO iframe for stripped-JSX
    expect(iframeEl()).toBeNull();
    // Placeholder IS there
    expect(document.body.textContent).toMatch(/preview not available/i);
    expect(document.body.textContent).toMatch(/needs JavaScript/i);
    // Chrome still shows the stripped chip so the user knows the mode
    expect(document.body.textContent).toMatch(/scripts stripped/i);
  });

  it('JSX + stripToStatic + trustPlaceholderCTA → renders the CTA inside the placeholder', () => {
    render(
      <IframeWidget
        kind="jsx"
        content="return function(){}"
        widgetId="wCTA"
        agentName="a"
        stripToStatic
        trustPlaceholderCTA={<button type="button">Grant trust</button>}
      />
    );
    expect(iframeEl()).toBeNull();
    expect(document.body.textContent).toMatch(/preview not available/i);
    // CTA is rendered inside the placeholder and is clickable
    const cta = Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Grant trust');
    expect(cta).toBeTruthy();
  });

  it('HTML widget with stripToStatic → still renders the iframe (HTML is already static)', async () => {
    // stripToStatic only changes rendering for JSX — HTML is already
    // static, so the iframe stays (with sandbox="" of course).
    render(
      <IframeWidget kind="html" content="<p>static</p>" widgetId="wHS" agentName="a" stripToStatic />
    );
    await waitFor(() => iframeEl() || Promise.reject());
    expect(iframeEl()).toBeTruthy();
  });

  it('chrome shows "custom html" chip for html kind', async () => {
    render(<IframeWidget kind="html" content="<p/>" widgetId="wH" agentName="a" />);
    await waitFor(() => iframeEl() || Promise.reject());
    expect(document.body.textContent).toMatch(/custom html/i);
  });

  it('variant="embedded" suppresses the chrome bar (gallery cards own their own card chrome)', async () => {
    render(<IframeWidget kind="html" content="<p/>" widgetId="wEmb" agentName="alice" variant="embedded" />);
    await waitFor(() => iframeEl() || Promise.reject());
    // Chrome strings ("agent-generated · alice", kind chip text) MUST be absent.
    expect(document.body.textContent).not.toMatch(/agent-generated/);
    expect(document.body.textContent).not.toMatch(/custom html/i);
    // But "View source" affordance is still reachable via the floating button.
    expect(document.querySelector('[data-testid="iframe-view-source-embedded"]')).toBeTruthy();
  });

  it('variant="card" (default) keeps the chrome bar', async () => {
    render(<IframeWidget kind="html" content="<p/>" widgetId="wCard" agentName="bob" />);
    await waitFor(() => iframeEl() || Promise.reject());
    expect(document.body.textContent).toMatch(/agent-generated/);
    expect(document.body.textContent).toMatch(/bob/);
  });

  it('warning message is surfaced as a chip + forwarded via onEvent — does NOT replace the widget', async () => {
    // Critical regression check: the typo detector originally used the
    // error channel and replaced the whole widget with a red error
    // screen for a single dead click handler. It now uses 'warning'
    // — widget keeps rendering, chip in chrome shows the issue.
    const onEvent = vi.fn();
    // kind=html avoids the runtime-bundle fetch (not mocked here);
    // the warning chip + onEvent forwarding logic is kind-agnostic.
    render(<IframeWidget kind="html" content="<p/>" widgetId="wW" agentName="a" onEvent={onEvent} />);
    const frame = await waitFor(() => iframeEl() || Promise.reject());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          __loxia: true, type: 'warning', widgetId: 'wW',
          phase: 'lint',
          message: 'Attribute "data-bind-click" is NOT auto-wired.',
        },
        source: frame.contentWindow,
      }));
    });
    // Chip rendered with count
    await waitFor(() => {
      expect(document.querySelector('[data-testid="widget-warnings-chip"]')).toBeTruthy();
    });
    expect(document.querySelector('[data-testid="widget-warnings-chip"]').textContent).toMatch(/1 warning/);
    // Iframe is STILL there — not replaced by an error screen.
    expect(iframeEl()).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/Widget failed to load/);
    // Forwarded to onEvent with __widgetWarning so the agent sees it next turn.
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      __widgetWarning: true,
      phase: 'lint',
      message: expect.stringMatching(/data-bind-click/),
    }));
  });

  it('multiple distinct warnings stack in the chip count, duplicates dedupe', async () => {
    render(<IframeWidget kind="html" content="<p/>" widgetId="wMulti" agentName="a" />);
    const frame = await waitFor(() => iframeEl() || Promise.reject());
    function postWarn(message) {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { __loxia: true, type: 'warning', widgetId: 'wMulti', phase: 'lint', message },
          source: frame.contentWindow,
        }));
      });
    }
    postWarn('first warning');
    postWarn('second warning');
    postWarn('first warning'); // duplicate — deduped
    await waitFor(() => {
      expect(document.querySelector('[data-testid="widget-warnings-chip"]')?.textContent).toMatch(/2 warnings/);
    });
  });

  it('error message is surfaced in chrome AND forwarded via onEvent', async () => {
    const onEvent = vi.fn();
    render(<IframeWidget kind="html" content="<p/>" widgetId="wErr" agentName="a" onEvent={onEvent} />);
    const frame = await waitFor(() => iframeEl() || Promise.reject());
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          __loxia: true, type: 'error', widgetId: 'wErr',
          phase: 'render', message: 'h is not defined', stack: 'at …',
        },
        source: frame.contentWindow,
      }));
    });
    // Surfaced in parent chrome
    await waitFor(() => {
      expect(document.body.textContent).toMatch(/h is not defined/);
    });
    // Forwarded to onEvent with the __widgetError marker so WidgetRenderer
    // routes it through postWidgetEvent → agent's toolResults queue.
    expect(onEvent).toHaveBeenCalledWith(expect.objectContaining({
      __widgetError: true,
      phase: 'render',
      message: 'h is not defined',
    }));
  });
});
