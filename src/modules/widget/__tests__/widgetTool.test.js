/**
 * Tests for WidgetTool — render/update/destroy/list + LRU eviction +
 * per-agent isolation + the toolConfig kill switch.
 */

import { describe, test, expect, beforeEach } from '@jest/globals';
import { WidgetTool } from '../widgetTool.js';
import { WIDGET_LIMITS } from '../schema.js';

const LOGGER = { info() {}, warn() {}, error() {}, debug() {} };

function makeTool() {
  return new WidgetTool({}, LOGGER);
}
function ctx(agentId = 'agent-a', overrides = {}) {
  return { agentId, toolConfig: { allowCustomCode: true }, ...overrides };
}

describe('WidgetTool.execute — render', () => {
  let tool;
  beforeEach(() => { tool = makeTool(); });

  test('basic html render succeeds and returns widgetId + widget', async () => {
    const r = await tool.execute({ action: 'render', kind: 'html', content: '<div>hi</div>' }, ctx());
    expect(r.success).toBe(true);
    expect(r.widgetId).toBeTruthy();
    expect(r.widget.kind).toBe('html');
    expect(r.widget.content).toBe('<div>hi</div>');
  });

  test('explicit widgetId is honoured and round-trips', async () => {
    const r = await tool.execute({
      action: 'render', kind: 'jsx', widgetId: 'my-widget-1',
      content: 'loxia.render(() => loxia.html`<div>x</div>`);',
    }, ctx());
    expect(r.widgetId).toBe('my-widget-1');
  });

  test('same widgetId replaces (update-by-render)', async () => {
    await tool.execute({ action: 'render', kind: 'html', widgetId: 'w1', content: '<p>v1</p>' }, ctx());
    const r2 = await tool.execute({ action: 'render', kind: 'html', widgetId: 'w1', content: '<p>v2</p>' }, ctx());
    expect(r2.widget.content).toBe('<p>v2</p>');
    const list = await tool.execute({ action: 'list' }, ctx());
    expect(list.widgets.filter(w => w.widgetId === 'w1')).toHaveLength(1);
  });

  test('rejects invalid kind', async () => {
    const r = await tool.execute({ action: 'render', kind: 'wasm', content: '...' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/kind must be one of/);
  });

  test('rejects missing content', async () => {
    const r = await tool.execute({ action: 'render', kind: 'html', content: '' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/content/);
  });

  test('rejects oversized content', async () => {
    const big = 'x'.repeat(WIDGET_LIMITS.MAX_CONTENT_BYTES + 1);
    const r = await tool.execute({ action: 'render', kind: 'html', content: big }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/exceeds/);
  });

  test('rejects widgetId with bad chars', async () => {
    const r = await tool.execute({ action: 'render', kind: 'html', widgetId: 'bad id!', content: '<p/>' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/[a-zA-Z0-9\._-]/);
  });

  test('flags phishing keywords in content', async () => {
    const r = await tool.execute({
      action: 'render', kind: 'html',
      content: '<form>Enter your password to continue</form>',
    }, ctx());
    expect(r.success).toBe(true);
    expect(r.widget.phishingHits).toContain('password');
  });

  test('toolConfig.allowCustomCode=false short-circuits render', async () => {
    const r = await tool.execute(
      { action: 'render', kind: 'html', content: '<p/>' },
      { agentId: 'agent-a', toolConfig: { allowCustomCode: false } }
    );
    expect(r.success).toBe(false);
    expect(r.disabled).toBe(true);
  });

  test('no toolConfig at all → disabled by default (safe posture)', async () => {
    // Default is OFF: rendering custom code requires explicit opt-in via
    // the agent's toolConfig.widget.allowCustomCode toggle. The UI-facing
    // WidgetConfigurator + first-use confirmation modal handle the
    // user-facing enablement flow; at the tool level, unset = blocked.
    const r = await tool.execute(
      { action: 'render', kind: 'html', content: '<p/>' },
      { agentId: 'agent-a' } // no toolConfig at all
    );
    expect(r.success).toBe(false);
    expect(r.disabled).toBe(true);
  });
});

describe('WidgetTool.execute — update', () => {
  let tool;
  beforeEach(() => { tool = makeTool(); });

  test('update merges props and bumps updatedAt', async () => {
    await tool.execute({ action: 'render', kind: 'jsx', widgetId: 'w', content: 'x', props: { a: 1 } }, ctx());
    const r = await tool.execute({ action: 'update', widgetId: 'w', props: { b: 2 } }, ctx());
    expect(r.success).toBe(true);
    expect(r.widget.props).toEqual({ a: 1, b: 2 });
  });

  test('update on unknown id fails', async () => {
    const r = await tool.execute({ action: 'update', widgetId: 'nope', props: {} }, ctx());
    expect(r.success).toBe(false);
  });

  test('update with missing props fails validation', async () => {
    const r = await tool.execute({ action: 'update', widgetId: 'w' }, ctx());
    expect(r.success).toBe(false);
  });
});

describe('WidgetTool.execute — destroy', () => {
  let tool;
  beforeEach(() => { tool = makeTool(); });

  test('destroy removes the widget', async () => {
    await tool.execute({ action: 'render', kind: 'html', widgetId: 'w', content: '<p/>' }, ctx());
    const r = await tool.execute({ action: 'destroy', widgetId: 'w' }, ctx());
    expect(r.success).toBe(true);
    const list = await tool.execute({ action: 'list' }, ctx());
    expect(list.widgets).toEqual([]);
  });

  test('destroy on unknown id fails', async () => {
    const r = await tool.execute({ action: 'destroy', widgetId: 'ghost' }, ctx());
    expect(r.success).toBe(false);
  });
});

describe('WidgetTool.execute — list + isolation', () => {
  let tool;
  beforeEach(() => { tool = makeTool(); });

  test('list returns only this agent\'s widgets', async () => {
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'a1' }, ctx('agent-a'));
    await tool.execute({ action: 'render', kind: 'html', content: '<p/>', widgetId: 'b1' }, ctx('agent-b'));
    const listA = await tool.execute({ action: 'list' }, ctx('agent-a'));
    const listB = await tool.execute({ action: 'list' }, ctx('agent-b'));
    expect(listA.widgets.map(w => w.widgetId)).toEqual(['a1']);
    expect(listB.widgets.map(w => w.widgetId)).toEqual(['b1']);
  });

  test('empty agent → empty list', async () => {
    const r = await tool.execute({ action: 'list' }, ctx('fresh'));
    expect(r).toEqual({ success: true, widgets: [] });
  });
});

describe('WidgetTool.execute — LRU eviction', () => {
  test('beyond the per-agent cap, oldest is evicted', async () => {
    const tool = makeTool();
    for (let i = 0; i < WIDGET_LIMITS.MAX_WIDGETS_PER_AGENT + 5; i++) {
      await tool.execute({ action: 'render', kind: 'html', widgetId: `w-${i}`, content: '<p/>' }, ctx());
    }
    const list = await tool.execute({ action: 'list' }, ctx());
    expect(list.widgets).toHaveLength(WIDGET_LIMITS.MAX_WIDGETS_PER_AGENT);
    // Oldest 5 evicted
    const ids = list.widgets.map(w => w.widgetId);
    expect(ids).not.toContain('w-0');
    expect(ids).not.toContain('w-4');
    expect(ids).toContain(`w-${WIDGET_LIMITS.MAX_WIDGETS_PER_AGENT + 4}`);
  });
});

describe('WidgetTool.execute — list-capabilities', () => {
  // The agent's self-doc. Critical for the feedback loop — when a
  // WIDGET RENDER ERROR happens, the agent is told to call this to see
  // exactly what IS available.
  test('returns structured capabilities covering every layer', async () => {
    const tool = makeTool();
    const r = await tool.execute({ action: 'list-capabilities' }, ctx());
    expect(r.success).toBe(true);
    expect(r.action).toBe('list-capabilities');
    const c = r.capabilities;
    expect(c).toBeTruthy();
    expect(c.globals).toEqual(expect.arrayContaining([
      'h', 'html', 'createElement', 'Fragment',
      'useState', 'useEffect', 'useMemo', 'useCallback', 'useRef', 'useReducer',
      'LoxiaCard', 'LoxiaButton',
    ]));
    expect(c.namespaces.aliased).toEqual(expect.arrayContaining([
      'htmPreact', 'preact', 'preactHooks', 'React', 'htm',
    ]));
    expect(c.loxia['loxia.render(Component, props)']).toBeTruthy();
    expect(c.notImplemented.classes).toEqual(expect.arrayContaining(['Component', 'PureComponent']));
    expect(c.notImplemented.functions).toEqual(expect.arrayContaining([
      'useContext', 'useLayoutEffect', 'forwardRef', 'memo', 'Suspense',
    ]));
    // useReducer must NOT be in notImplemented — it IS implemented now.
    expect(c.notImplemented.functions).not.toContain('useReducer');
    expect(typeof c.notImplemented.rewritePaths['useContext(Ctx)']).toBe('string');
    expect(c.hardErrors).toEqual(expect.arrayContaining(['fetch', 'localStorage', 'import']));
    expect(c.constraints.maxContentBytes).toBeGreaterThan(0);
    expect(c.constraints.maxWidgetsPerAgent).toBeGreaterThan(0);
  });

  test('reachable even when allowCustomCode is off (so agent can unblock itself)', async () => {
    const tool = makeTool();
    const r = await tool.execute(
      { action: 'list-capabilities' },
      { agentId: 'a' } // no toolConfig → allowCustomCode defaults off
    );
    expect(r.success).toBe(true);
    expect(r.capabilities).toBeTruthy();
  });

  test('list-capabilities appears in getSupportedActions', () => {
    const tool = makeTool();
    expect(tool.getSupportedActions()).toContain('list-capabilities');
  });
});

describe('WidgetTool.execute — render attaches code-analyzer warnings', () => {
  test('typo attribute in widget content → ONE consolidated warning on the result', async () => {
    const tool = makeTool();
    const r = await tool.execute({
      action: 'render',
      kind: 'webcomponent',
      content: `
        class App extends LoxiaElement {
          toggleYes() {}
          template() { return '<button data-bind-click="toggleYes">X</button>'; }
        }
        loxia.render(App, window.__loxiaInitialProps);
      `,
    }, ctx());
    expect(r.success).toBe(true);
    expect(Array.isArray(r.warnings)).toBe(true);
    expect(r.warnings).toHaveLength(1);
    // The single warning lists the issue + provides the fix snippets.
    expect(r.warnings[0]).toMatch(/data-bind-click="toggleYes"/);
    expect(r.warnings[0]).toMatch(/data-on-click="toggleYes"/);
    expect(r.warnings[0]).toMatch(/afterRender/);
  });

  test('clean code → result has NO warnings field (avoids context noise)', async () => {
    const tool = makeTool();
    const r = await tool.execute({
      action: 'render',
      kind: 'webcomponent',
      content: `
        class App extends LoxiaElement {
          toggleYes() {}
          template() { return '<button data-on-click="toggleYes">X</button>'; }
        }
        loxia.render(App, window.__loxiaInitialProps);
      `,
    }, ctx());
    expect(r.success).toBe(true);
    expect(r.warnings).toBeUndefined();
  });

  test('html kind: typos in the markup are still flagged in the consolidated warning', async () => {
    const tool = makeTool();
    const r = await tool.execute({
      action: 'render', kind: 'html',
      content: '<button data-action="x">A</button>',
    }, ctx());
    expect(r.success).toBe(true);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/data-action="x"/);
  });

  test('many distinct typos → still ONE consolidated warning, listing all of them', async () => {
    const tool = makeTool();
    const r = await tool.execute({
      action: 'render', kind: 'webcomponent',
      content: `
        class App extends LoxiaElement {
          a(){} b(){} c(){}
          template() {
            return \`
              <button data-bind-click="a">A</button>
              <button data-bind-click="a">A2</button>
              <button data-action="b">B</button>
              <button data-on:click="c">C</button>
            \`;
          }
        }
        loxia.render(App, window.__loxiaInitialProps);
      `,
    }, ctx());
    expect(r.warnings).toHaveLength(1);
    const w = r.warnings[0];
    // All three distinct typo families are listed (duplicate data-bind-click="a" deduped).
    expect(w).toMatch(/data-bind-click="a"/);
    expect(w).toMatch(/data-action="b"/);
    expect(w).toMatch(/data-on:click="c"/);
    expect(w.match(/data-bind-click="a"/g)).toHaveLength(1);
  });
});

describe('WidgetTool.execute — unknown action', () => {
  test('returns informative error naming supported actions', async () => {
    const tool = makeTool();
    const r = await tool.execute({ action: 'teleport' }, ctx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown action: teleport/);
    expect(r.error).toMatch(/Supported:/);
    expect(r.error).toMatch(/list-capabilities/);
  });
});
