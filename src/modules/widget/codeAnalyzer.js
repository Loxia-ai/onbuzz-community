/**
 * Static analyzer for widget content.
 *
 * Runs at submission time (inside _render), BEFORE the iframe tries to
 * mount. Output is consolidated into a SINGLE multi-line warning string
 * (or an empty array for clean code) so the agent gets one focused,
 * actionable message in its next turn — instead of a flurry of nags.
 *
 * Detects:
 *   1. Typo attributes that look like event-handler bindings but aren't
 *      recognized by the runtime — data-bind-click (Knockout-style),
 *      data-on:click (Vue/Alpine), data-action (Stimulus), inline
 *      onclick="…", etc.
 *   2. Methods on the LoxiaElement subclass that look like handlers
 *      ("on*", "handle*", "toggle*", *Click) and aren't referenced
 *      anywhere as LOCAL handlers.
 *   3. Methods referenced ONLY via data-emit. data-emit posts a message
 *      to the agent — it does NOT call the local method on click. So a
 *      button with data-emit="addTodo" won't actually run addTodo()
 *      when the user clicks it; the agent would have to handle the
 *      emitted event on its next turn. Almost always a misconception
 *      — flag it explicitly.
 *
 * Implementation note: this module prefers plain string functions
 * (indexOf / includes / slice) over regex where the answer is simply
 * "is this token in the content?". Regex is reserved for actual
 * tokenization (attribute name=value pairs, class-method declarations)
 * where it materially improves clarity.
 */

// Reserved method names: lifecycle hooks and base-class machinery.
const RESERVED_METHODS = new Set([
  'constructor', 'template', 'render', 'setState',
  'onMount', 'onUnmount', 'afterRender',
  'handleUpdate', 'emit', 'connectedCallback', 'disconnectedCallback',
  'attributeChangedCallback', 'adoptedCallback',
  'observedAttributes', 'state',
]);

// Heuristic: does this method name look like an event handler?
// Conservative — only flag obvious patterns so we don't nag about helpers.
function looksLikeHandler(name) {
  if (RESERVED_METHODS.has(name)) return false;
  if (/^(on|handle)[A-Z]/.test(name)) return true;
  if (/^(toggle|do|submit|click|change|input|press)/i.test(name)) return true;
  if (/Click$|Change$|Input$|Submit$|Press$/.test(name)) return true;
  return false;
}

/**
 * Pull method-name candidates out of the source. We use one regex (the
 * cleanest tool for tokenization) but the consumer-side logic afterwards
 * is plain string ops. Catches:
 *   methodName() { ... }
 *   async methodName() { ... }
 *   methodName(...args) { ... }
 *
 * False-positive risk is small (top-level functions also match) and the
 * downstream "is referenced" check filters those out.
 */
function extractClassMethods(content) {
  const methods = [];
  // Anchor on any "statement boundary" character — a method can follow a
  // newline, ; { or } (the closing brace of a previous method body).
  // The original regex omitted } and missed back-to-back declarations like
  //   addTodo() {} clearAll() {}
  // where clearAll is preceded by } not \n/;/{.
  // Word-boundary on the keyword filter is critical: without \b the
  // lookahead `(?!delete)` rejects ANY identifier starting with "delete"
  // (deleteTodo, deleteRow, deletedAt, …). Same for `do` rejecting doFoo,
  // `new` rejecting newItem, etc. The \b limits the match to the actual
  // keyword and lets compound names through.
  const RE = /(?:^|[\n;{}])\s*(?:async\s+)?(?!(?:if|for|while|switch|catch|return|function|new|typeof|delete|void|throw)\b)([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/g;
  let m;
  while ((m = RE.exec(content)) !== null) {
    const name = m[1];
    if (RESERVED_METHODS.has(name)) continue;
    if (!methods.includes(name)) methods.push(name);
  }
  return methods;
}

/**
 * Build the substring patterns that, if literally present in `content`,
 * mean `methodName` is wired as a LOCAL HANDLER (run when a DOM event
 * fires OR called from another method). Plain .includes() checks —
 * no regex escaping concerns.
 *
 * IMPORTANT: data-emit is INTENTIONALLY EXCLUDED. data-emit posts an
 * event to the agent — it does NOT call the method on click. Treating
 * data-emit as wiring was the bug that let "buttons that visually do
 * nothing" through static analysis.
 *
 * Variable-suffix attributes (data-on-<event>, data-bind-<event>,
 * data-on:<event>) are handled by attributeWithValueExists, not here.
 */
function localWiringPatterns(methodName) {
  const m = methodName;
  return [
    // Fixed-name typo attributes the runtime auto-rewrites to data-on-click.
    'data-action="' + m + '"',   "data-action='" + m + "'",
    'data-handler="' + m + '"',  "data-handler='" + m + "'",
    'data-click="' + m + '"',    "data-click='" + m + "'",
    'data-onclick="' + m + '"',  "data-onclick='" + m + "'",
    // Direct method calls.
    'this.' + m,
    'self.' + m,
  ];
}

/**
 * Substring patterns that prove a method is referenced ONLY via
 * data-emit. data-emit DOES contain the method name as a string, so
 * the analyzer sees it — but the runtime treats it as an event-name,
 * not a method-call. If a method appears ONLY inside data-emit (not in
 * any data-on-* / addEventListener / direct-call site), the user's
 * click won't run it locally.
 */
function emitOnlyPatterns(methodName) {
  return [
    'data-emit="' + methodName + '"',
    "data-emit='" + methodName + "'",
  ];
}

/**
 * Scan `content` for attributes starting with `prefix` whose VALUE
 * (between matching quotes) equals `methodName`. Pure string ops —
 * no regex.
 *
 * Handles attributes with variable suffixes:
 *   prefix='data-on-'   matches data-on-click, data-on-input, …
 *   prefix='data-bind-' matches data-bind-click (typo, auto-rewritten)
 *   prefix='data-on:'   matches data-on:click  (typo, auto-rewritten)
 */
function attributeWithValueExists(content, prefix, methodName) {
  let idx = content.indexOf(prefix);
  while (idx !== -1) {
    let j = idx + prefix.length;
    // Skip the variable-length suffix (event name characters).
    while (j < content.length && /[a-zA-Z]/.test(content[j])) j++;
    // Optional whitespace, then '='
    while (j < content.length && (content[j] === ' ' || content[j] === '\t')) j++;
    if (content[j] === '=') {
      j++;
      while (j < content.length && (content[j] === ' ' || content[j] === '\t')) j++;
      const q = content[j];
      if (q === '"' || q === "'") {
        const end = content.indexOf(q, j + 1);
        if (end !== -1 && content.slice(j + 1, end) === methodName) return true;
      }
    }
    idx = content.indexOf(prefix, idx + 1);
  }
  return false;
}

/**
 * @returns {'wired' | 'emit-only' | 'unwired'}
 */
function classifyMethodWiring(content, methodName) {
  // Local wiring — direct call sites or any handler-binding attribute
  // (canonical OR typo — the runtime auto-rewrites typos). Plain string
  // .includes() for the unambiguous patterns; the variable-suffix
  // attributes get a small string scanner.
  for (const p of localWiringPatterns(methodName)) {
    if (content.includes(p)) return 'wired';
  }
  // Variable-suffix attribute scan (data-on-<event>, data-bind-<event>,
  // data-on:<event>). Each can have any suffix the agent picks.
  if (attributeWithValueExists(content, 'data-on-', methodName)) return 'wired';
  if (attributeWithValueExists(content, 'data-bind-', methodName)) return 'wired';
  if (attributeWithValueExists(content, 'data-on:', methodName)) return 'wired';

  // Local-wire patterns absent. Now check if the method appears via data-emit.
  for (const p of emitOnlyPatterns(methodName)) {
    if (content.includes(p)) return 'emit-only';
  }
  return 'unwired';
}

/**
 * Pattern matchers for the typo-attribute classes. Regex IS the right
 * tool for tokenizing attribute name+value pairs — that's literally
 * what regex was designed for. Each yields {attr, method, event, inline}
 * records. The aggregator dedups before formatting.
 */
const TYPO_PATTERNS = [
  {
    re: /\bdata-bind-([a-zA-Z]+)\s*=\s*["']([^"']+)["']/g,
    extract: (m) => ({ attr: 'data-bind-' + m[1], event: m[1], method: m[2], inline: false }),
  },
  {
    re: /\bdata-on:([a-zA-Z]+)\s*=\s*["']([^"']+)["']/g,
    extract: (m) => ({ attr: 'data-on:' + m[1], event: m[1], method: m[2], inline: false }),
  },
  {
    re: /\bdata-(action|handler|click|onclick)\s*=\s*["']([^"']+)["']/g,
    extract: (m) => ({ attr: 'data-' + m[1], event: 'click', method: m[2], inline: false }),
  },
  {
    re: /<[^>]*?\s(on[a-z]+)\s*=\s*["']([^"']*)["']/g,
    extract: (m) => ({ attr: m[1], event: m[1].slice(2), method: m[2], inline: true }),
  },
];

function collectFindings(content, kind) {
  const findings = [];
  const seen = new Set();
  for (const pat of TYPO_PATTERNS) {
    pat.re.lastIndex = 0;
    let m;
    while ((m = pat.re.exec(content)) !== null) {
      const f = pat.extract(m);
      const key = f.attr + '|' + f.method;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(f);
    }
  }

  let deadMethods = [];
  let emitOnlyMethods = [];
  if (kind === 'webcomponent') {
    const methods = extractClassMethods(content);
    for (const name of methods) {
      const status = classifyMethodWiring(content, name);
      if (status === 'emit-only') {
        // ALWAYS flag emit-only — data-emit is a strong-enough signal
        // that the agent intended a local handler. Don't gate on the
        // looksLikeHandler heuristic; the original bug exists precisely
        // because helpful-looking names like "addTodo" / "deleteTodo"
        // /"clearAll" don't match the handler-shape regex.
        emitOnlyMethods.push(name);
      } else if (status === 'unwired' && looksLikeHandler(name)) {
        // Unwired methods we flag as dead ONLY if the name looks like
        // a handler — otherwise we'd nag about every helper method.
        deadMethods.push(name);
      }
    }
  }
  return { findings, deadMethods, emitOnlyMethods };
}

function buildConsolidatedWarning(findings, deadMethods, emitOnlyMethods) {
  if (findings.length === 0 && deadMethods.length === 0 && emitOnlyMethods.length === 0) {
    return [];
  }

  const lines = [];
  lines.push('Some event handlers in your widget WILL NOT FIRE — fix before re-rendering.');
  lines.push('');

  if (findings.length > 0) {
    lines.push('Unwired attributes detected:');
    for (const f of findings) {
      if (f.inline) {
        const code = f.method.length > 50 ? f.method.slice(0, 47) + '…' : f.method;
        lines.push(
          '  • ' + f.attr + '="' + code + '"  ' +
          '— inline handler runs in iframe global scope; "this" is the element, not your LoxiaElement instance.'
        );
      } else {
        lines.push(
          '  • ' + f.attr + '="' + f.method + '"  ' +
          '— this attribute name is not recognized; method "' + f.method + '" will NOT be called on ' + f.event + '.'
        );
      }
    }
    lines.push('');
  }

  if (emitOnlyMethods.length > 0) {
    lines.push('Methods referenced ONLY via data-emit (not actually called on click):');
    for (const name of emitOnlyMethods) {
      lines.push(
        '  • ' + name + '()  — data-emit="' + name + '" sends an event to the AGENT; ' +
        'it does NOT invoke this.' + name + '() locally. The button click will appear to do nothing.'
      );
    }
    lines.push('');
  }

  if (deadMethods.length > 0) {
    lines.push('Methods defined but not wired to any DOM event:');
    for (const name of deadMethods) {
      lines.push('  • ' + name + '()  — define a binding, or remove the method if unused.');
    }
    lines.push('');
  }

  // Build representative method names + event from the findings so the
  // copy-pastable snippet is immediately actionable.
  const methodNames = Array.from(new Set([
    ...findings.filter(f => !f.inline).map(f => f.method),
    ...emitOnlyMethods,
    ...deadMethods,
  ])).slice(0, 4);
  const sampleMethod = methodNames[0] || 'methodName';
  const sampleEvent  = (findings.find(f => !f.inline) || {}).event || 'click';

  // RECOMMENDED PATTERN FIRST — addEventListener inside afterRender.
  // It's the web-standard, typo-proof path and covers events that
  // data-on-<event> can't (custom events, AbortSignal, capture phase, …).
  lines.push('Fix using ONE of these patterns:');
  lines.push('');
  lines.push('  (A) RECOMMENDED — addEventListener inside afterRender(root):');
  lines.push('      Web-standard, typo-proof, full Event API (AbortSignal, { once,');
  lines.push('      capture, passive }, custom events, delegation). afterRender(root)');
  lines.push('      runs after EVERY render (post-setState too) so listeners attached');
  lines.push('      there survive state updates.');
  lines.push('');
  lines.push('      afterRender(root) {');
  if (methodNames.length === 0) {
    lines.push('        root.querySelector(\'#yourBtn\').addEventListener(\'click\', () => this.methodName());');
  } else {
    for (const m of methodNames) {
      lines.push('        root.querySelector(\'#' + m + 'Btn\').addEventListener(\'' + sampleEvent + '\', () => this.' + m + '());');
    }
  }
  lines.push('      }');
  lines.push('');
  lines.push('  (B) Shortcut — data-on-<event> attribute (concise; runtime convention):');
  lines.push('      <button data-on-' + sampleEvent + '="' + sampleMethod + '">…</button>');
  lines.push('      Works for any DOM event name. The runtime walks the rendered DOM');
  lines.push('      after each render and binds via addEventListener under the hood.');
  lines.push('');
  lines.push('  NOT recommended:');
  lines.push('  • data-emit="<name>" — sends an event to the AGENT, not a local call.');
  lines.push('    Use only when you want the agent to receive a notification.');
  lines.push('  • Inline onclick="…" — runs in iframe global scope; "this" is the element.');
  lines.push('  • addEventListener in onMount() — listeners die on first setState (innerHTML wipe).');

  return [lines.join('\n')];
}

/**
 * Analyze widget code submitted via widget.render. Returns at most ONE
 * consolidated multi-line warning string (or empty array for clean code).
 *
 * @param {string} content    The agent's widget source.
 * @param {string} kind       'html' | 'jsx' | 'webcomponent'
 * @returns {{ warnings: string[] }}
 */
export function analyzeWidgetCode(content, kind) {
  if (typeof content !== 'string' || !content) return { warnings: [] };
  const { findings, deadMethods, emitOnlyMethods } = collectFindings(content, kind);
  return { warnings: buildConsolidatedWarning(findings, deadMethods, emitOnlyMethods) };
}

export default { analyzeWidgetCode };
