/**
 * Tests for analyzeWidgetCode — the submission-time static analyzer.
 *
 * Produces ONE consolidated multi-line warning per render (or none),
 * containing:
 *   - Unwired typo attributes (data-bind-click, data-action, …)
 *   - Methods referenced ONLY via data-emit (won't fire locally)
 *   - Methods that look like handlers but are unreferenced (dead)
 *   - Two fix patterns with copy-pastable code, addEventListener FIRST.
 */

import { describe, test, expect } from '@jest/globals';
import { analyzeWidgetCode } from '../codeAnalyzer.js';

describe('analyzeWidgetCode — consolidation', () => {
  test('clean code (data-on-click + afterRender) → no warnings', () => {
    const code = `
      class App extends LoxiaElement {
        toggleYes() {}
        afterRender(root) {
          root.querySelector('#b').addEventListener('click', () => this.toggleYes());
        }
        template() { return '<button id="b">X</button>'; }
      }
    `;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings).toEqual([]);
  });

  test('any number of findings → exactly ONE warning entry', () => {
    const code = `
      class App extends LoxiaElement {
        a() {} b() {} c() {}
        template() {
          return '<button data-bind-click="a">X</button><button data-action="b">Y</button>';
        }
      }
    `;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings).toHaveLength(1);
  });
});

describe('typo-attribute detection', () => {
  test('data-bind-click flagged with method name', () => {
    const code = `<button data-bind-click="toggleYes">X</button>`;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/data-bind-click="toggleYes"/);
    expect(w).toMatch(/method "toggleYes" will NOT be called/);
  });

  test('data-on:click (colon) flagged', () => {
    const code = `<button data-on:click="foo">X</button>`;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings[0]).toMatch(/data-on:click="foo"/);
  });

  test('data-action / data-handler / data-click / data-onclick all flagged', () => {
    const code = `
      <button data-action="x">A</button>
      <button data-handler="y">B</button>
      <button data-click="z">C</button>
      <button data-onclick="w">D</button>
    `;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/data-action="x"/);
    expect(w).toMatch(/data-handler="y"/);
    expect(w).toMatch(/data-click="z"/);
    expect(w).toMatch(/data-onclick="w"/);
  });

  test('inline on*= attributes flagged with global-scope explanation', () => {
    const code = `<button onclick="this.toggleYes()">X</button>`;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/inline handler runs in iframe global scope/i);
  });

  test('duplicates of same typo deduped', () => {
    const code = `
      <button data-bind-click="x">A</button>
      <button data-bind-click="x">B</button>
      <button data-bind-click="x">C</button>
    `;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w.match(/data-bind-click="x"/g)).toHaveLength(1);
  });
});

describe('emit-only methods (the new finding)', () => {
  test('method used ONLY via data-emit → flagged as "click won\'t fire it"', () => {
    // This was the actual bug from Coder-Rapid-8086: button has data-emit
    // pointing at a method, agent thinks it'll fire on click — it doesn't.
    const code = `
      class App extends LoxiaElement {
        addTodo() { /* … */ }
        template() {
          return '<button data-emit="addTodo">Add</button>';
        }
      }
    `;
    const { warnings } = analyzeWidgetCode(code, 'webcomponent');
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    expect(w).toMatch(/Methods referenced ONLY via data-emit/);
    expect(w).toMatch(/addTodo\(\)/);
    expect(w).toMatch(/sends an event to the AGENT/);
    expect(w).toMatch(/does NOT invoke this\.addTodo\(\) locally/);
  });

  test('method used via BOTH data-emit AND addEventListener → NOT flagged (locally wired)', () => {
    const code = `
      class App extends LoxiaElement {
        addTodo() {}
        afterRender(root) {
          root.querySelector('#b').addEventListener('click', () => this.addTodo());
        }
        template() {
          return '<button id="b" data-emit="addTodo">Add</button>';
        }
      }
    `;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings).toEqual([]);
  });

  test('method used via data-emit AND data-on-click → NOT flagged', () => {
    const code = `
      class App extends LoxiaElement {
        addTodo() {}
        template() {
          return '<button data-emit="addTodo" data-on-click="addTodo">Add</button>';
        }
      }
    `;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings).toEqual([]);
  });

  test('multiple emit-only methods all listed', () => {
    const code = `
      class App extends LoxiaElement {
        addTodo() {} clearAll() {} deleteTodo() {}
        template() {
          return \`
            <button data-emit="addTodo">Add</button>
            <button data-emit="clearAll">Clear</button>
            <button data-emit="deleteTodo">Del</button>
          \`;
        }
      }
    `;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/addTodo\(\)/);
    expect(w).toMatch(/clearAll\(\)/);
    expect(w).toMatch(/deleteTodo\(\)/);
  });
});

describe('dead handler-shaped methods', () => {
  test('handler-shaped method never referenced → flagged', () => {
    const code = `
      class App extends LoxiaElement {
        toggleYes() {}
        template() { return '<div/>'; }
      }
    `;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/Methods defined but not wired/);
    expect(w).toMatch(/toggleYes/);
  });

  test('lifecycle methods never flagged', () => {
    const code = `
      class App extends LoxiaElement {
        onMount() {}
        onUnmount() {}
        afterRender() {}
        handleUpdate() {}
        template() { return '<div/>'; }
      }
    `;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings).toEqual([]);
  });

  test('non-handler methods (formatDate, computeTotal) never flagged', () => {
    const code = `
      class App extends LoxiaElement {
        formatDate() {}
        computeTotal() {}
        template() { return '<div/>'; }
      }
    `;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings).toEqual([]);
  });

  test('method called via this.method() from another method → not flagged', () => {
    const code = `
      class App extends LoxiaElement {
        afterRender(root) { this.handleSubmit(); }
        handleSubmit() {}
        template() { return '<div/>'; }
      }
    `;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings).toEqual([]);
  });

  test('method referenced via data-on-<any-event>="m" → not flagged (generic suffix)', () => {
    const code = `
      class App extends LoxiaElement {
        handleKeyPress() {}
        template() { return '<input data-on-keypress="handleKeyPress">'; }
      }
    `;
    expect(analyzeWidgetCode(code, 'webcomponent').warnings).toEqual([]);
  });

  test('method referenced via typo attribute (auto-rewritten by runtime) → still considered wired', () => {
    const code = `
      class App extends LoxiaElement {
        toggleYes() {}
        template() { return '<button data-bind-click="toggleYes">X</button>'; }
      }
    `;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    // Typo IS flagged in "Unwired attributes detected" section
    expect(w).toMatch(/data-bind-click="toggleYes"/);
    // But NOT in "Methods defined but not wired" — runtime auto-rewrite wires it.
    expect(w).not.toMatch(/Methods defined but not wired/);
  });
});

describe('fix snippets in the warning', () => {
  test('addEventListener pattern is presented FIRST (recommended)', () => {
    const code = `<button data-bind-click="x">X</button>`;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    const idxA = w.indexOf('addEventListener inside afterRender');
    const idxB = w.indexOf('data-on-<event>');
    expect(idxA).toBeGreaterThan(0);
    expect(idxB).toBeGreaterThan(0);
    expect(idxA).toBeLessThan(idxB);   // (A) before (B)
  });

  test('addEventListener pattern is labelled RECOMMENDED', () => {
    const code = `<button data-bind-click="x">X</button>`;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/RECOMMENDED.*addEventListener/i);
  });

  test('warning explicitly says data-emit is NOT recommended', () => {
    const code = `<button data-bind-click="x">X</button>`;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/NOT recommended/);
    expect(w).toMatch(/data-emit.*sends an event to the AGENT/i);
  });

  test('addEventListener snippet uses the actual method names', () => {
    const code = `
      class App extends LoxiaElement {
        toggleYes() {}
        onNoClick() {}
        template() {
          return '<button data-bind-click="toggleYes">A</button><button data-bind-click="onNoClick">B</button>';
        }
      }
    `;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/this\.toggleYes\(\)/);
    expect(w).toMatch(/this\.onNoClick\(\)/);
  });

  test('explains why afterRender (not onMount) is the right hook', () => {
    const code = `<button data-bind-click="x">X</button>`;
    const w = analyzeWidgetCode(code, 'webcomponent').warnings[0];
    expect(w).toMatch(/afterRender/);
    expect(w).toMatch(/onMount/);
    expect(w).toMatch(/innerHTML/);
  });
});

describe('kind awareness', () => {
  test('jsx kind: dead-method analysis SKIPPED (preact onClick={fn})', () => {
    const code = `
      function App() {
        function toggleYes() {}
        return html\`<div/>\`;
      }
    `;
    expect(analyzeWidgetCode(code, 'jsx').warnings).toEqual([]);
  });

  test('html kind: typos in markup still flagged', () => {
    const code = `<button data-action="x">A</button>`;
    expect(analyzeWidgetCode(code, 'html').warnings[0]).toMatch(/data-action/);
  });
});

describe('defensive guards', () => {
  test.each([null, undefined, '', 123, {}, []])('non-string content → no warnings (%p)', (input) => {
    expect(analyzeWidgetCode(input, 'webcomponent').warnings).toEqual([]);
  });
});

describe('regression: the Coder-Rapid-8086 todo widget', () => {
  test('widget with data-emit on every button + handleInput/handleKeyPress methods → flags BOTH classes', () => {
    // Reproduces the exact widget from the conversation:
    //   - Buttons use data-emit (which the agent thought was local)
    //   - handleInput / handleKeyPress methods defined but unwired
    const code = `
      class TodoListWidget extends LoxiaElement {
        addTodo() {}
        toggleTodo(id) {}
        deleteTodo(id) {}
        clearAll() {}
        handleInput(e) {}
        handleKeyPress(e) {}
        template(state) {
          return \`
            <input type="text" data-bind="inputValue" />
            <button data-emit="addTodo">Add</button>
            <input type="checkbox" data-emit="toggleTodo" />
            <button data-emit="deleteTodo">Delete</button>
            <button data-emit="clearAll">Clear</button>
          \`;
        }
      }
      loxia.render(TodoListWidget, window.__loxiaInitialProps);
    `;
    const { warnings } = analyzeWidgetCode(code, 'webcomponent');
    expect(warnings).toHaveLength(1);
    const w = warnings[0];
    // Emit-only section catches what we MISSED before
    expect(w).toMatch(/Methods referenced ONLY via data-emit/);
    expect(w).toMatch(/addTodo\(\)/);
    expect(w).toMatch(/toggleTodo\(\)/);
    expect(w).toMatch(/deleteTodo\(\)/);
    expect(w).toMatch(/clearAll\(\)/);
    // Dead-method section catches the rest
    expect(w).toMatch(/Methods defined but not wired/);
    expect(w).toMatch(/handleInput/);
    expect(w).toMatch(/handleKeyPress/);
    // Fix snippet uses addEventListener FIRST and includes the actual methods
    expect(w).toMatch(/RECOMMENDED.*addEventListener/i);
    expect(w).toMatch(/this\.addTodo\(\)/);
  });
});
