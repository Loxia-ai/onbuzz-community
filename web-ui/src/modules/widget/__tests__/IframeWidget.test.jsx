/**
 * IframeWidget sandbox-flag correctness. The single most load-bearing
 * security property of the whole module: html → sandbox="",
 * jsx → sandbox="allow-scripts", and NEITHER ever sets allow-same-origin.
 * If this regresses the iframe escapes the null origin and the CSP-based
 * security story falls apart.
 */
import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import IframeWidget from '../IframeWidget.jsx';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function iframeEl() {
  return document.querySelector('iframe');
}

describe('IframeWidget sandbox flags', () => {
  it('html mode → sandbox is empty string (no scripts)', async () => {
    render(
      <IframeWidget
        kind="html"
        content="<p>hello</p>"
        widgetId="w1"
        agentName="agent-x"
      />
    );
    await waitFor(() => expect(iframeEl()).toBeTruthy());
    const frame = iframeEl();
    // sandbox attr is present but empty — that's the full-restriction mode
    expect(frame.getAttribute('sandbox')).toBe('');
    // NEVER allow-same-origin
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-same-origin/);
  });

  it('jsx mode → sandbox="allow-scripts" (and NEVER allow-same-origin)', async () => {
    // stub fetch so the runtime resolves instantly
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '/* runtime */',
    });
    render(
      <IframeWidget
        kind="jsx"
        content="return function(){ return {type:'div',props:{},children:['ok']}; }"
        widgetId="w2"
        agentName="agent-x"
      />
    );
    await waitFor(() => expect(iframeEl()).toBeTruthy());
    const frame = iframeEl();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-same-origin/);
  });

  it('stripToStatic + kind=jsx → renders placeholder (no iframe at all — risk-2 fix)', () => {
    // Previously: we forced sandbox="" on the JSX srcdoc and showed raw
    // stripped source. Now: we don't render an iframe at all for this
    // combination — instead we show a placeholder explaining that the
    // widget needs scripts. The sandbox-invariant ("never allow-same-origin")
    // is still maintained: no iframe → no script privileges → no leak.
    render(
      <IframeWidget
        kind="jsx"
        content="anything"
        widgetId="w3"
        agentName="agent-x"
        stripToStatic
      />
    );
    expect(iframeEl()).toBeNull();
    expect(document.body.textContent).toMatch(/preview not available/i);
  });

  it('webcomponent kind: sandbox is "allow-scripts" (just like jsx) and never allow-same-origin', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true, text: async () => '/* wc runtime */',
    });
    render(
      <IframeWidget
        kind="webcomponent"
        content="class X extends LoxiaElement {} loxia.render(X);"
        widgetId="wWC"
        agentName="agent-x"
      />
    );
    await waitFor(() => expect(iframeEl()).toBeTruthy());
    const frame = iframeEl();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('sandbox')).not.toMatch(/allow-same-origin/);
    // Fetched the WC runtime, not the JSX runtime
    expect(global.fetch).toHaveBeenCalledWith('/api/widget/runtime-wc.js');
  });

  it('webcomponent kind shows distinct chrome chip ("custom code (web component)")', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '' });
    render(<IframeWidget kind="webcomponent" content="x" widgetId="wWC2" agentName="a" />);
    await waitFor(() => expect(iframeEl()).toBeTruthy());
    expect(document.body.textContent).toMatch(/web component/i);
  });

  it('webcomponent kind + stripToStatic → placeholder, no iframe', () => {
    render(
      <IframeWidget
        kind="webcomponent"
        content="x"
        widgetId="wWCS"
        agentName="a"
        stripToStatic
      />
    );
    expect(iframeEl()).toBeNull();
    expect(document.body.textContent).toMatch(/preview not available/i);
  });

  it('chrome always shows the agent-generated badge', async () => {
    render(
      <IframeWidget kind="html" content="<p>ok</p>" widgetId="w4" agentName="coder-bolt" />
    );
    expect(screen.getByText(/agent-generated/i)).toBeInTheDocument();
    expect(screen.getByText('coder-bolt')).toBeInTheDocument();
  });
});
