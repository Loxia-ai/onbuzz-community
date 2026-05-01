/**
 * Widget schema + validation.
 *
 * Tool actions:
 *   render   → { widgetId?, kind, content, props? }  (creates or replaces)
 *   update   → { widgetId, props }                   (replaces props on an existing widget)
 *   destroy  → { widgetId }
 *   list     → { }
 *
 * Kinds:
 *   'html' — static HTML+CSS, sandbox="" (no scripts, no forms, no same-origin)
 *   'jsx'  — Preact+htm render function, sandbox="allow-scripts" (scripts only)
 *
 * Size limits are deliberately generous for MVP but finite — agents should
 * not be pushing multi-megabyte iframes into the chat feed.
 */

export const WIDGET_LIMITS = {
  MAX_CONTENT_BYTES:   50 * 1024, // 50 KB per widget payload
  MAX_WIDGET_ID_LEN:   128,
  MAX_WIDGET_NAME_LEN: 80,        // human-friendly display name (not unique)
  MAX_WIDGETS_PER_AGENT: 50,      // LRU-evicted beyond this
  MAX_VERSIONS_PER_WIDGET: 20,    // history ring; older versions evicted
};

// Three kinds:
//   'html'         — static HTML, sandbox="" (no scripts)
//   'jsx'          — Preact + htm runtime; hooks, h(), html``
//   'webcomponent' — class extends LoxiaElement / HTMLElement; standard
//                    web platform APIs only (no JSX, no hooks, no
//                    namespace imports). Recommended for interactive
//                    widgets — eliminates an entire class of failures
//                    rooted in custom-runtime quirks. The JSX path
//                    stays for agents that prefer hooks.
export const WIDGET_KINDS = Object.freeze(['html', 'jsx', 'webcomponent']);

/**
 * Validate a `render` payload.
 * Returns { valid: true } or { valid: false, error: string }.
 */
/**
 * Shared validator for the optional human-friendly display name.
 * Names are NOT unique per agent — that's the widgetId's job. Names are
 * purely cosmetic; multiple widgets named "Calculator" coexist fine.
 */
function validateName(name) {
  if (name == null) return { valid: true };
  if (typeof name !== 'string') return { valid: false, error: 'name must be a string' };
  // Trim before length check so trailing whitespace doesn't push valid
  // names over the cap; the canonical (trimmed) value is what we store.
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return { valid: false, error: 'name must be non-empty (or omit it)' };
  }
  if (trimmed.length > WIDGET_LIMITS.MAX_WIDGET_NAME_LEN) {
    return { valid: false, error: `name exceeds ${WIDGET_LIMITS.MAX_WIDGET_NAME_LEN} chars` };
  }
  // Reject control characters — names appear in card UIs and tooltips,
  // a stray \r or \x00 would mangle layout.
  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return { valid: false, error: 'name must not contain control characters' };
  }
  return { valid: true, normalized: trimmed };
}

/** Public wrapper so the tool can canonicalize the same way validators do. */
export function normalizeName(name) {
  const r = validateName(name);
  return r.valid && r.normalized != null ? r.normalized : null;
}

export function validateRenderParams(params) {
  if (!params || typeof params !== 'object') return { valid: false, error: 'params must be an object' };
  const { kind, content, widgetId, props, name } = params;
  const nameRes = validateName(name);
  if (!nameRes.valid) return nameRes;

  if (!WIDGET_KINDS.includes(kind)) {
    return { valid: false, error: `kind must be one of: ${WIDGET_KINDS.join(', ')}` };
  }
  if (typeof content !== 'string' || !content.trim()) {
    return { valid: false, error: 'content (string) is required' };
  }
  if (Buffer.byteLength(content, 'utf8') > WIDGET_LIMITS.MAX_CONTENT_BYTES) {
    return {
      valid: false,
      error: `content exceeds ${WIDGET_LIMITS.MAX_CONTENT_BYTES} bytes — trim or split`,
    };
  }
  // kind:'html' is sandbox="" — scripts won't run. Catch this here with a
  // clear named error so the agent doesn't ship a static widget that
  // silently loses its interactivity (browser only logs "Blocked script
  // execution in about:srcdoc … allow-scripts not set" to the iframe
  // console, which the agent never sees).
  if (kind === 'html' && /<script\b/i.test(content)) {
    return {
      valid: false,
      error:
        "kind:'html' is a static-only mode (sandbox=\"\" — scripts are blocked). " +
        "Your content contains a <script> tag, which will not execute. " +
        "Switch to kind:'webcomponent' (recommended) or kind:'jsx' for interactive widgets. " +
        "If you only need styling and layout, remove the <script> tag.",
    };
  }
  if (widgetId != null) {
    if (typeof widgetId !== 'string' || widgetId.length === 0 || widgetId.length > WIDGET_LIMITS.MAX_WIDGET_ID_LEN) {
      return { valid: false, error: `widgetId must be a 1..${WIDGET_LIMITS.MAX_WIDGET_ID_LEN}-char string` };
    }
    // Conservative charset: agent-pickable ids, filesystem-safe, URL-safe.
    if (!/^[a-zA-Z0-9._-]+$/.test(widgetId)) {
      return { valid: false, error: 'widgetId may only contain [a-zA-Z0-9._-]' };
    }
  }
  if (props != null && (typeof props !== 'object' || Array.isArray(props))) {
    return { valid: false, error: 'props, if provided, must be a plain object' };
  }
  return { valid: true };
}

export function validateUpdateParams(params) {
  if (!params || typeof params !== 'object') return { valid: false, error: 'params must be an object' };
  const { widgetId, props } = params;
  if (typeof widgetId !== 'string' || !widgetId) {
    return { valid: false, error: 'widgetId is required' };
  }
  if (props == null || typeof props !== 'object' || Array.isArray(props)) {
    return { valid: false, error: 'props (object) is required' };
  }
  return { valid: true };
}

export function validateDestroyParams(params) {
  if (!params || typeof params !== 'object') return { valid: false, error: 'params must be an object' };
  if (typeof params.widgetId !== 'string' || !params.widgetId) {
    return { valid: false, error: 'widgetId is required' };
  }
  return { valid: true };
}

/**
 * Validate `list-versions` and `get-version` payloads. Both take a widgetId;
 * `get-version` additionally requires a versionId.
 */
export function validateListVersionsParams(params) {
  if (!params || typeof params !== 'object') return { valid: false, error: 'params must be an object' };
  if (typeof params.widgetId !== 'string' || !params.widgetId) {
    return { valid: false, error: 'widgetId is required' };
  }
  return { valid: true };
}

export function validateGetVersionParams(params) {
  const base = validateListVersionsParams(params);
  if (!base.valid) return base;
  if (typeof params.versionId !== 'string' || !params.versionId) {
    return { valid: false, error: 'versionId is required' };
  }
  return { valid: true };
}

/**
 * `set-main { widgetId, versionId }` — promote a specific version to be the
 * one rendered when the artifact is opened.
 */
export function validateSetMainParams(params) {
  return validateGetVersionParams(params);
}

/**
 * `rename { widgetId, name }` — set/clear the human-friendly display name.
 * Pass null/empty name to clear. Names are NOT unique — widgetId is.
 */
export function validateRenameParams(params) {
  if (!params || typeof params !== 'object') return { valid: false, error: 'params must be an object' };
  if (typeof params.widgetId !== 'string' || !params.widgetId) {
    return { valid: false, error: 'widgetId is required' };
  }
  // Allow explicit null/'' to CLEAR the name (revert to widgetId-as-display).
  if (params.name === null || params.name === '') return { valid: true, clear: true };
  return validateName(params.name);
}
