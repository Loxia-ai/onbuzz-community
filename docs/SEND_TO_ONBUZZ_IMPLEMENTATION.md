# Send to OnBuzz — Chrome Extension Implementation Guide

A complete, share-ready walkthrough of how the **"Send to OnBuzz agent"**
feature is built end-to-end: the Manifest V3 Chrome extension, the side
panel chat UI, the backend endpoints, the security model, and the
restricted-tool policy that keeps the user safe from an LLM that was
fed text from a random web page.

This document is the implementation explainer. For *install + use*
instructions, see [`BROWSER_EXTENSION.md`](./BROWSER_EXTENSION.md).

---

## 1. What the feature is

The user highlights text on any webpage, right-clicks **"Send to
OnBuzz agent"**, and Chrome's Side Panel opens with a polished branded
chat. The selection, page title, and URL come in pre-populated. The
user can pick a quick action ("Summarize", "Translate → EN", "Key
points", "Tone check"), type a custom question, or speak one via the
microphone. The local OnBuzz server handles the request, runs an agent
named **"Quick Send"** against a restricted tool allowlist, and the
reply streams back into the side panel.

Two distinguishing characteristics:

- **Local-only by design.** The extension's host permissions are
  hard-locked to `localhost`/`127.0.0.1`. Nothing leaves the user's
  machine.
- **Restricted tool policy is enforced at the backend, not the
  extension.** The Quick Send agent can use a hand-picked allowlist
  (web fetch, PDF read, etc.) and *cannot* be coaxed into calling
  terminal, filesystem, or git — even if a hostile selection tries.

---

## 2. Architecture at a glance

```
┌────────────────────────────┐
│  Chrome context menu       │   user highlights text & right-clicks
│  "Send to OnBuzz agent"    │
└─────────────┬──────────────┘
              │
              ▼
┌────────────────────────────┐
│  background.js (MV3 SW)    │   1. chrome.sidePanel.open() (sync, gesture-bound)
│                            │   2. stash selection in chrome.storage.session
└─────────────┬──────────────┘   3. send 'selection-staged' runtime message
              │
              ▼
┌────────────────────────────┐
│  sidepanel.html / .js / .css                                        │
│  - reads staged selection                                            │
│  - renders branded UI (Sunshine light / Hive dark)                  │
│  - composer with chips + mic + lang picker                          │
│  - POSTs to /api/chat/quick-send                                    │
│  - polls /api/chat/quick-send/messages every 1.5 s                  │
└─────────────┬──────────────────────────────────────────────────────┘
              │ POST { selected_text, source_url, page_title, user_message }
              │ X-OnBuzz-Token: <token>
              ▼
┌────────────────────────────────────────────────────────────────────┐
│  src/interfaces/webServer.js                                       │
│                                                                    │
│  1. verifyExtensionToken()  ── shared-secret check (401 otherwise) │
│  2. validate body, 100 KB cap per field                            │
│  3. collectCandidates()      ── pool + on-disk agent-index.json    │
│  4. find-or-create-or-heal Quick Send agent                        │
│       buildQuickSendAgentConfig() / diffQuickSendPolicy()          │
│  5. orchestrator.processRequest({ SEND_MESSAGE, ... })             │
│  6. respond { ok, agentId, conversationId, firstMessageIndex }     │
└─────────────┬──────────────────────────────────────────────────────┘
              │
              ▼
┌────────────────────────────────────────────────────────────────────┐
│  Existing OnBuzz pipeline                                          │
│  messageProcessor.processMessage()                                 │
│      → agentScheduler                                              │
│           → AI service (Ollama / Anthropic / etc.)                 │
│           → executeTools()  ← ★ restrictedToolset gate ★           │
│           → addMessageToConversation()  ← assistant reply lands    │
│                in agent.conversations.full.messages                │
└─────────────┬──────────────────────────────────────────────────────┘
              │
              ▼ side panel poll picks it up and renders the bubble
```

The pipeline is **REST-only** from the extension's perspective. There
is no WebSocket connection from the side panel. A stable sentinel
session id (`extension-quick-send`) keeps the WS broadcaster from
fanning extension replies out to the main UI's WebSocket clients.

---

## 3. Changeset inventory

Everything that ships with this feature, by area:

```
browser-extension/                       (entirely new — 2,037 lines)
├── manifest.json                39 L    MV3 manifest with sidePanel + brand icons
├── background.js               132 L    context menu, sidePanel.open, selection stash
├── sidepanel.html              143 L    branded chat UI structure
├── sidepanel.css               681 L    Sunshine light + Hive dark, animations, bubbles
├── sidepanel.js                751 L    state, send/poll flow, mic, lang picker, chips
├── options.html                 91 L    server URL + token form
├── options.js                   61 L    persistence + URL validation
├── assets/
│   ├── mascot.webp                      header tile + welcome state + AI avatar
│   └── wordmark.webp                    light-theme "OnBuzz" logo
└── icons/
    ├── icon-16.png   icon-32.png        toolbar + management page
    ├── icon-48.png   icon-128.png       (generated from web-ui/build/brands/onbuzz/logo.webp
    └── icon-256.png                      by padding to square + resize with sharp)

src/services/                            (new)
├── extensionToken.js           117 L    env-or-file token resolver, constant-time verify
└── quickSendPolicy.js          132 L    allowlist + builder + diff helper

src/core/                                (modified)
└── messageProcessor.js                  +33 L: restrictedToolset runtime gate

src/interfaces/                          (modified)
└── webServer.js                         +345 L: two endpoints + WS broadcast tweak

src/core/__tests__/                      (new)
└── messageProcessor.restrictedToolset.test.js   306 L — 14 tests

docs/
├── BROWSER_EXTENSION.md        211 L    install / configure / use / troubleshooting
└── SEND_TO_ONBUZZ_IMPLEMENTATION.md     this file
```

Backend changes are *additive*. Agents created via the existing UI see
zero behaviour change; only the Quick Send agent (and any future agent
that opts in via `metadata.restrictedToolset`) is subject to the new
runtime gate.

---

## 4. The extension package

### 4.1 `manifest.json`

The contract with Chrome. Each field is load-bearing:

```json
{
  "manifest_version": 3,
  "minimum_chrome_version": "114",   // sidePanel API ships in Chrome 114+
  "permissions": [
    "contextMenus",                  // right-click entry
    "storage",                       // serverUrl, token, replyLanguage
    "notifications",                 // error toasts
    "sidePanel"                      // open the panel programmatically
  ],
  "host_permissions": [
    "http://localhost/*",
    "http://127.0.0.1/*"
  ],
  "background": { "service_worker": "background.js" },
  "side_panel": { "default_path": "sidepanel.html" },
  "options_page": "options.html",

  "icons":   { "16": ..., "32": ..., "48": ..., "128": "icons/icon-128.png" },
  "action": {
    "default_title": "Open OnBuzz Side Panel",
    "default_icon": { "16": ..., "32": ..., "48": ..., "128": ... }
  }
}
```

**Why these choices**:

- `host_permissions` is `localhost`/`127.0.0.1` only. The extension
  cannot make HTTP calls anywhere else, ever. This is the strongest
  blast-radius guarantee in the design.
- `icons` (for the management page + install dialog) and
  `action.default_icon` (for the toolbar + puzzle menu) both point to
  the same brand-derived PNG set, generated from
  `web-ui/build/brands/onbuzz/logo.webp` by padding to a transparent
  square with `sharp`, then resizing — so the logo doesn't get
  squashed in any of Chrome's icon slots.
- No `content_security_policy` override. MV3's default extension
  policy (`script-src 'self'`) is already strict; we don't need to
  loosen it because the side panel loads only local scripts.

### 4.2 `background.js` — the MV3 service worker

Three responsibilities, kept stateless:

#### 4.2.1 Context-menu registration (idempotent)

```js
function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: 'Send to OnBuzz agent',
      contexts: ['selection']            // only appears on a text selection
    });
  });
}
chrome.runtime.onInstalled.addListener(ensureContextMenu);
chrome.runtime.onStartup.addListener(ensureContextMenu);
```

MV3 service workers can be killed and re-woken at any time. `removeAll
+ create` is the canonical idempotent pattern — calling `create()` on
an id that already exists throws.

#### 4.2.2 Context-menu click handler (the auto-open fix)

```js
// IMPORTANT: this listener is NOT async. chrome.sidePanel.open() is
// user-gesture-gated, and the gesture token from a context-menu click
// is consumed by the FIRST `await` boundary inside the handler.
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID) return;

  const selection = (info.selectionText || '').trim();
  if (!selection) { notify('No text selected.'); return; }

  const payload = {
    selected_text: selection,
    source_url:    (tab && tab.url) || '',
    page_title:    (tab && tab.title) || '',
    captured_at:   Date.now()
  };

  // 1. Open the side panel synchronously — must happen before any
  //    `await` so the user-gesture token is still valid.
  let openPromise = null;
  try {
    if (tab && typeof tab.windowId === 'number') {
      openPromise = chrome.sidePanel.open({ windowId: tab.windowId });
    } else if (tab && typeof tab.id === 'number') {
      openPromise = chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch (err) {
    notify(`Could not open Side Panel: ${err.message || 'unknown error'}`);
  }
  if (openPromise && typeof openPromise.catch === 'function') {
    openPromise.catch((err) => notify(`Could not open Side Panel: ${err.message}`));
  }

  // 2. Stash AFTER open() is already in flight. The side panel reads
  //    chrome.storage.session on load AND listens for the runtime
  //    message stashSelection sends, so this can safely race the
  //    panel's init.
  stashSelection(payload).catch((err) => {
    notify(`Could not stage selection: ${err.message || 'unknown error'}`);
  });
});
```

**Why the call order matters**: this was the fix for *"the side panel
doesn't open from the context menu, I have to use the puzzle icon."*
`chrome.sidePanel.open()` is user-gesture-gated. The context-menu
click *is* a gesture, but the gesture token is consumed by the first
`await` in the handler. With `await stashSelection(...)` running
first, the open call later ran without a gesture and Chrome silently
rejected it.

#### 4.2.3 Toolbar icon → side panel

```js
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
```

So clicking the toolbar icon also opens the panel, without needing a
fresh selection.

#### 4.2.4 `notify()` and `stashSelection()`

`notify` wraps `chrome.notifications.create` and references the 128 px
brand icon. `stashSelection` writes to `chrome.storage.session` and
also fires `chrome.runtime.sendMessage({ type: 'onbuzz/selection-staged' })`
so an already-open side panel updates immediately without waiting on
storage change events.

### 4.3 `sidepanel.html` — the chat UI structure

A single page, no SPA framework, no build step. The DOM is a faithful
translation of the design handoff's component tree:

```
<header class="app-header">
  <div class="brand-tile">                ← 34×34 yellow tile with 28px mascot
    <img src="assets/mascot.webp">
  </div>
  <div class="brand-stack">
    <div class="wordmark-light"><img src="assets/wordmark.webp"></div>
    <div class="wordmark-dark"><span>On<span class="accent">Buzz</span></span></div>
    <!-- light vs dark wordmark toggled by prefers-color-scheme -->
    <div id="appHeaderSub">No selection yet</div>
  </div>
  <button id="historyBtn">  ⏱  </button>  ← placeholder (disabled)
  <button id="settingsBtn"> ⚙  </button>  ← opens options.html
</header>

<div class="body-region">
  <section id="selectionCard" hidden>     ← doc icon + title + URL + accented quote
  <section id="actionChips" hidden>       ← yellow card, 4 chips with data-prompt
  <section id="emptyState">               ← mascot in radial glow + "Hi, I'm OnBuzz."
  <section id="conversation" hidden>      ← bubbles appended here
  <section id="errorBanner" hidden>       ← alert glyph + title + body
</div>

<form id="composer">
  <div id="selectionPill">● Selection attached</div>
  <div class="composer-shell">
    <textarea id="userMessage" placeholder="Ask about the selection… (Enter to send, Shift+Enter for newline)">
  </div>
  <div class="composer-actions">
    <button id="micBtn">🎤 <span class="mic-pulse"></span></button>
    <div class="lang-wrap">
      <button id="langBtn">🌐 <span id="langBadge"></span></button>
      <div id="langPopover">
        <button data-lang="">Auto-detect</button>
        <button data-lang="en">English</button>
        <button data-lang="he">עברית (Hebrew)</button>
        <button data-lang="es">Español</button>
        <button data-lang="fr">Français</button>
        <button data-lang="ar">العربية (Arabic)</button>
      </div>
    </div>
    <div id="sendHint"></div>
    <button id="sendBtn" type="submit">Send ▲</button>
  </div>
</form>
```

Three Google Font families load from the stylesheet link in `<head>`:

- **Plus Jakarta Sans** — UI body text.
- **Heebo** — Hebrew (the design specifically anticipates Hebrew use).
- **Nunito** — the wordmark in dark theme.

Every SVG icon is inlined with `stroke="currentColor"` and
`stroke-width="1.6"`, matching the design's Icon component. Palette
swaps recolour them automatically via `currentColor`.

### 4.4 `sidepanel.css` — palette + layout

The visual contract. Two palettes — **Sunshine** (light) and **Hive**
(dark) — both copied 1:1 from the design handoff's `THEMES` object.
Swapped via `prefers-color-scheme`:

```css
:root {
  /* SUNSHINE — light, default */
  --panel-bg:    #FFFCF3;    --surface:     #FFFFFF;    --surface-alt: #FBF6E6;
  --border:      #EBE2C7;    --text:        #1A1714;    --text-muted:  #776E5C;
  --brand:       #FFC700;    --brand-soft:  #FFF4BF;
  --user-bubble: #FFEC9A;    --ai-bubble:   #F4EFDE;
  --radius:      14px;       --danger:      #D7322B;
  ...
}

@media (prefers-color-scheme: dark) {
  :root {
    /* HIVE — dark, mascot-forward, neon yellow on black */
    --panel-bg:    #0D0D10;    --surface:     #17171B;    --surface-alt: #1E1E23;
    --border:      #26262C;    --text:        #FBFBFC;    --text-muted:  #878790;
    --brand:       #FFD400;    --brand-soft:  #3A3315;
    --user-bubble: #FFD400;    --ai-bubble:   #1E1E23;
    --danger:      #FF6B5E;
    ...
  }
}
```

The design also included a third theme (**Buzz** — monochrome with
one yellow tick); we skipped it as a stylistic dup of Sunshine.

**Animations** copied verbatim from the design:

```css
@keyframes ob-hover        { 50% { transform: translateY(-4px); } }
@keyframes ob-dot-bounce   { 30% { transform: translateY(-4px); opacity: 1; } }
@keyframes mic-pulse-anim  { 70% { box-shadow: 0 0 0 6px rgba(215,50,43,0); } }
```

**Bubbles** — the most iterated rule in the file:

```css
.bubble {
  max-width: 82%;
  padding: 10px 13px;
  /* Explicit longhand so the per-corner overrides below are unambiguous
     and can't be clipped by any inherited shorthand. */
  border-top-left-radius:     18px;
  border-top-right-radius:    18px;
  border-bottom-left-radius:  18px;
  border-bottom-right-radius: 18px;
  border: 0;
  /* (Originally had border: 1px solid transparent which sat outside
     the background fill and made the visible top corners look
     subtly squared — removed entirely.) */
}

.bubble.user               { border-bottom-right-radius: 4px; }       /* LTR speaker */
.bubble.user[dir="rtl"]    { border-bottom-right-radius: 18px;
                              border-bottom-left-radius:  4px; }      /* RTL mirror */
.bubble.assistant          { border-bottom-left-radius:  4px; }
.bubble.assistant[dir="rtl"]{ border-bottom-left-radius:  18px;
                              border-bottom-right-radius: 4px; }
```

The bubble's `dir` attribute is set per-message by the JS based on
`detectDir()` (Hebrew/Arabic vs Latin). The CSS flips the squared
corner AND the row's flex-justification simultaneously, so a Hebrew
reply correctly hugs the right side with the mascot avatar on its
right.

### 4.5 `sidepanel.js` — controller

The largest file (751 lines). One golden rule:

> **Logic for the working pipeline — send, poll, error handling,
> stale-bail — is preserved verbatim across all iterations. Visual /
> UX additions sit alongside without rewriting the network code.**

Top-down map:

#### 4.5.1 Constants and DOM lookups

```js
const DEFAULT_SERVER_URL = 'http://localhost:8080';
const PENDING_KEY        = 'pendingSelection';
const POLL_INTERVAL_MS   = 1500;          // poll the messages endpoint every 1.5 s
const POLL_TIMEOUT_MS    = 60_000;        // give up after 60 s

const els = { /* every DOM node we'll touch, looked up once at module load */ };

const MASCOT_URL = chrome.runtime.getURL('assets/mascot.webp');
```

#### 4.5.2 Direction detection (Hebrew / Arabic / LTR)

```js
function detectDir(text) {
  if (typeof text !== 'string') return 'ltr';
  // Hebrew U+0590–U+05FF, Arabic U+0600–U+06FF and U+0750–U+077F.
  const m = text.match(/[֐-׿؀-ۿݐ-ݿ]|[A-Za-z]/);
  if (!m) return 'ltr';
  return /[֐-׿؀-ۿݐ-ݿ]/.test(m[0]) ? 'rtl' : 'ltr';
}
```

Per-message: an English reply right after a Hebrew selection still
lays out LTR — direction comes from the **message text**, not from a
global UI flag.

#### 4.5.3 State router — `renderSelection(sel)`

The single function that puts the whole UI into a consistent state.
Given a staged selection (or `null`):

- `null` — welcome state. Mascot in radial glow visible, everything
  else hidden, header sub-line: "No selection yet".
- selection present — selection card populated (title, URL host
  extracted via `hostFromUrl()`, RTL-aware quote), chips shown, "●
  Selection attached" pill shown, header sub-line set to the host.

```js
function renderSelection(sel) {
  currentSelection = sel;
  if (!sel) {
    els.selectionCard.classList.add('hidden');
    els.actionChips.classList.add('hidden');
    els.conversation.classList.add('hidden');
    els.emptyState.classList.remove('hidden');
    els.selectionPill.classList.add('hidden');
    els.appHeaderSub.textContent = 'No selection yet';
    return;
  }
  // ... populate cards, show chips, set sub-line, etc.
}
```

#### 4.5.4 `appendMessage({ role, content, loading })`

Builds a bubble row in the design's exact shape:

```js
function appendMessage({ role, content, loading = false }) {
  els.conversation.classList.remove('hidden');

  const row = document.createElement('div');
  const text = loading ? '' : (typeof content === 'string' ? content : '');
  const dir = role === 'assistant' && loading
    ? (currentSelection ? detectDir(currentSelection.selected_text) : 'ltr')
    : detectDir(text);
  row.className = `msg-row ${role}`;
  row.setAttribute('dir', dir);

  if (role === 'assistant') {
    // 28×28 mascot avatar. While loading, the .is-thinking class makes
    // it bounce via the ob-hover keyframe.
    const avatar = document.createElement('div');
    avatar.className = `msg-avatar${loading ? ' is-thinking' : ''}`;
    const img = document.createElement('img');
    img.src = MASCOT_URL; img.alt = '';
    avatar.appendChild(img);
    row.appendChild(avatar);
  }

  const bubble = document.createElement('div');
  bubble.className = `bubble ${role}${loading ? ' is-loading' : ''}`;
  bubble.setAttribute('dir', dir);
  if (loading) {
    for (let i = 0; i < 3; i++) {                          // three bouncing dots
      const dot = document.createElement('span');
      dot.className = 'ob-dot';
      bubble.appendChild(dot);
    }
  } else {
    bubble.textContent = text;                              // text — NOT innerHTML
  }
  row.appendChild(bubble);
  els.conversation.appendChild(row);
  els.conversation.scrollTop = els.conversation.scrollHeight;

  // Once a REAL assistant reply lands, hide the Quick actions chips.
  // They're useful before the first answer; after, they crowd the
  // conversation. New selection → renderSelection re-shows them.
  if (role === 'assistant' && !loading && els.actionChips) {
    els.actionChips.classList.add('hidden');
  }
  return row;
}
```

#### 4.5.5 Error banner (title + body)

`showError(message, opts?)` writes a **structured** banner with a
title and a body line. Auto-splits a single string on `' — '`:

```js
function showError(message, opts = {}) {
  let title = opts.title || null;
  let body  = opts.body  || null;
  if (!title && !body) {
    const raw = String(message || '');
    const splitIdx = raw.indexOf(' — ');
    if (splitIdx > 0 && splitIdx < 80) {
      title = raw.slice(0, splitIdx).trim();
      body  = raw.slice(splitIdx + 3).trim();
    } else {
      title = "Couldn't reach OnBuzz";
      body  = raw;
    }
  }
  els.errorTitle.textContent = title;
  els.errorBody.textContent  = body;
  els.errorBanner.classList.remove('hidden');
}
```

#### 4.5.6 Network — `postQuickSend` and `pollForReply`

```js
async function postQuickSend({ serverUrl, token, selection, userMessage }) {
  const res = await fetch(`${serverUrl}/api/chat/quick-send`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-OnBuzz-Token': token },
    body: JSON.stringify({
      selected_text: selection.selected_text,
      source_url:    selection.source_url || null,
      page_title:    selection.page_title || null,
      user_message:  userMessage || null
    })
  });
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}${json?.error ? `: ${json.error}` : ''}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function pollForReply({ serverUrl, token, agentId, since, signal }) {
  const start = Date.now();
  const MAX_TRANSIENT_RETRIES = 3;
  let transientRetries = 0;

  while (Date.now() - start < POLL_TIMEOUT_MS) {
    if (signal?.aborted) throw new DOMException('Poll aborted', 'AbortError');

    const url = new URL(`${serverUrl}/api/chat/quick-send/messages`);
    url.searchParams.set('agentId', agentId);
    url.searchParams.set('since',   String(since));

    let res;
    try {
      res = await fetch(url.toString(), { headers: { 'X-OnBuzz-Token': token }, signal });
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (transientRetries++ >= MAX_TRANSIENT_RETRIES)
        throw new Error('Lost the connection to OnBuzz while waiting for the reply.');
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    if (res.status === 401) throw withStatus(401, 'Server rejected the extension token...');
    if (res.status === 404) throw new Error('The Quick Send agent is missing — try sending again.');
    if (!res.ok) {
      if (transientRetries++ >= MAX_TRANSIENT_RETRIES) throw new Error(`HTTP ${res.status}`);
      await sleep(POLL_INTERVAL_MS); continue;
    }
    transientRetries = 0;

    const body = await res.json().catch(() => null);

    // FAIL FAST when the server reports the agent is unhealthy
    // (paused, or an [system-error] user message was injected by the
    // scheduler after a failed AI call). Without this, the panel would
    // sit on "Thinking…" for 60 s, then time out — opaque to the user.
    if (body?.unhealthy) {
      const err = new Error(
        `Quick Send agent is unhealthy${body.agentStatus ? ` (agent status: ${body.agentStatus})` : ''}` +
        `${body.errorHint ? ` — ${body.errorHint}` : ''}`);
      err.unhealthy = true;
      throw err;
    }

    for (const m of (body?.messages || [])) {
      if (m.role === 'assistant' && (m.content || '').trim().length > 0) return m;
    }
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error('Timed out waiting for the agent reply.');
}
```

#### 4.5.7 `handleSend()` — the send orchestrator

This is the function with the most invariants:

```js
async function handleSend() {
  if (!currentSelection?.selected_text) { showError(...); return; }
  if (!token) { showError('Extension token is not set...'); return; }
  clearError();

  els.sendBtn.disabled = true; els.userMessage.disabled = true;
  els.sendHint.textContent = 'Sending…';

  appendMessage({ role: 'user', content: preview });
  const loadingNode = appendMessage({ role: 'assistant', loading: true });

  // Per-invocation token. Any continuation that finds it's no longer
  // the latest must exit silently. This is the guard that prevents a
  // stale poll's timeout from overwriting a freshly rendered reply.
  const myInvocation = ++sendInvocationCounter;
  latestSendInvocation = myInvocation;
  const isStale = () => myInvocation !== latestSendInvocation;

  if (activePollAbort) activePollAbort.abort();
  activePollAbort = new AbortController();

  try {
    // Reply-language hint prepended client-side. The backend treats it
    // as plain content; the LLM sees it as an instruction. Keeps the
    // wire format unchanged.
    const hint = languageHintForCurrentChoice();         // e.g. "[Reply in Hebrew.]"
    const composed = hint
      ? (userMessage ? `${hint}\n\n${userMessage}` : hint)
      : userMessage;

    const sendResult = await postQuickSend({ ..., userMessage: composed });
    if (isStale()) return;
    if (!sendResult?.ok || !sendResult.agentId)
      throw new Error(sendResult?.error || 'Unexpected server response.');

    const reply = await pollForReply({
      ..., agentId: sendResult.agentId,
      since: sendResult.firstMessageIndex || 0,
      signal: activePollAbort.signal
    });
    if (isStale()) return;

    removeNode(loadingNode);
    appendMessage({ role: 'assistant', content: reply.content });
    els.sendHint.textContent = 'Reply received.';
    activePollAbort = null;                                // success → no abort needed later
  } catch (err) {
    if (isStale()) return;                                 // ← stale guard
    removeNode(loadingNode);
    if (err.name === 'AbortError') { els.sendHint.textContent = ''; return; }
    if (err.status === 401)        showError('OnBuzz rejected the extension token...');
    else if (err.unhealthy)        showError(`${err.message}. Open OnBuzz Settings...`);
    else if (/HTTP 5\d\d/.test(err.message)) showError(`OnBuzz returned a server error...`);
    else if (/Failed to fetch/i.test(err.message)) showError('Could not reach OnBuzz...');
    else showError(err.message);
    els.sendHint.textContent = '';
  } finally {
    if (!isStale()) {                                      // ← stale finally is a no-op
      els.sendBtn.disabled = false;
      els.userMessage.disabled = false;
      els.userMessage.value = '';
      els.userMessage.focus();
    }
  }
}
```

The per-invocation token + `isStale()` guard exists specifically to
prevent the "assistant reply renders, then a timeout banner appears 60 s
later" bug. See §10.

#### 4.5.8 Event wiring

- **Form submit** → `handleSend()`.
- **Keydown on textarea** — `Enter` sends, `Shift+Enter` newlines,
  `isComposing` guard for IME safety.
- **Clear-selection button** → `invalidateInFlightSend()` (bumps the
  counter, aborts the controller), wipes storage, `renderSelection(null)`.
- **Settings button** → `chrome.runtime.openOptionsPage()`.
- **Action chips** — event-delegated click handler. Reads
  `data-prompt`, drops it into the textarea, fires `handleSend()`.

#### 4.5.9 Reply-language picker

```js
const LANG_NAMES = {
  '':   { code: 'AUTO', name: 'auto-detected language' },
  en:   { code: 'EN',   name: 'English' },
  he:   { code: 'HE',   name: 'Hebrew' },
  es:   { code: 'ES',   name: 'Spanish' },
  fr:   { code: 'FR',   name: 'French' },
  ar:   { code: 'AR',   name: 'Arabic' }
};
let replyLanguage = '';

function languageHintForCurrentChoice() {
  if (!replyLanguage) return '';
  const meta = LANG_NAMES[replyLanguage];
  return meta ? `[Reply in ${meta.name}.]` : '';
}
```

When the user picks a non-Auto language:
- The small `EN`/`HE`/etc. badge appears on the globe button.
- The choice persists in `chrome.storage.local.replyLanguage`.
- Every `handleSend` prepends `[Reply in X.]` to the user message.
- The choice also biases the speech recognizer's locale (see below).

Popover opens on click, closes on outside click, closes on Escape.

#### 4.5.10 Voice input (Web Speech API)

```js
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

function localeForRecognition() {
  // Bias the recognizer toward the picked reply language when set.
  switch (replyLanguage) {
    case 'he': return 'he-IL';
    case 'es': return 'es-ES';
    case 'fr': return 'fr-FR';
    case 'ar': return 'ar-SA';
    case 'en': return 'en-US';
    default:   return navigator.language || 'en-US';
  }
}

function startRecording() {
  if (!SR) { showError('Voice input not supported in this browser'); return; }
  recognition = new SR();
  recognition.lang           = localeForRecognition();
  recognition.interimResults = true;
  recognition.continuous     = false;
  speechBaseValue            = els.userMessage.value;     // preserve typed text

  recognition.onstart  = () => { /* btn.is-recording + hint = "Listening…" */ };
  recognition.onresult = (ev) => {
    let interim = '', final = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++)
      (ev.results[i].isFinal ? final : interim) += ev.results[i][0].transcript;
    els.userMessage.value = `${speechBaseValue} ${final}${interim}`;
    if (final) speechBaseValue = els.userMessage.value;    // promote final to the base
  };
  recognition.onerror  = (ev) => {
    if (ev.error === 'not-allowed')      showError('Microphone permission denied — ...');
    else if (ev.error === 'no-speech')   { /* quiet — no banner for silence */ }
    else                                 showError(`Recognizer error: ${ev.error}`);
  };
  recognition.onend    = () => { /* btn.- is-recording, restore hint, focus textarea */ };
  recognition.start();
}
```

Click toggles between start and stop. Interim results stream into the
textarea live; finals stay. On Firefox (no SR) the button auto-disables
with a tooltip.

#### 4.5.11 Selection-staged listener + init

```js
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === 'onbuzz/selection-staged') {
    const staged = await readStagedSelection();
    if (staged) {
      invalidateInFlightSend();           // any in-flight poll is now stale
      clearConversation(); clearError();
      els.sendHint.textContent = '';
      renderSelection(staged);            // re-shows chips, selection card, pill
    }
  }
});

(async function init() {
  const staged = await readStagedSelection();
  renderSelection(staged);                // welcome state OR staged selection
})();
```

### 4.6 `options.html` + `options.js`

A plain HTML form with two fields — **Server URL** (default
`http://localhost:8080`) and **Token** (password type). Both persist
in `chrome.storage.local`. Includes a `<details>` block telling the
user exactly where to find the auto-generated token file on each OS.

`normaliseServerUrl()` validates the URL parses, that it's http or
https, and strips trailing slashes.

### 4.7 Assets and icons

- `assets/mascot.webp` — header tile, welcome state hero, assistant
  avatar. The same image at multiple sizes.
- `assets/wordmark.webp` — "OnBuzz" wordmark used in light theme. Dark
  theme renders an inline `<span>On<span class="accent">Buzz</span></span>`
  styled with Nunito 900, swapped via media query.
- `icons/icon-{16,32,48,128,256}.png` — derived from
  `web-ui/build/brands/onbuzz/logo.webp` (897×655 with alpha) by
  padding to a transparent square then resizing with `sharp` —
  preserving the entire logo without cropping or squashing.

---

## 5. Backend additions

### 5.1 `src/services/extensionToken.js`

Shared-secret resolver. Two-tier:

```js
// Resolution order:
//   1. ONBUZZ_EXTENSION_TOKEN env var (preferred for headless setups)
//   2. <userDataPaths.settings>/extension-token.json — auto-generated
//      on first call, persisted with mode 0600.

export async function getExtensionToken() {
  if (process.env.ONBUZZ_EXTENSION_TOKEN) {
    return { token: process.env.ONBUZZ_EXTENSION_TOKEN, source: 'env', filePath };
  }
  // Try the persisted file.
  const existing = await readPersistedToken();
  if (existing) return { token: existing, source: 'file', filePath };

  // First-run: generate, persist 0600, return.
  const fresh = randomBytes(32).toString('hex');
  await writePersistedToken(fresh);
  return { token: fresh, source: 'generated', filePath };
}

export async function verifyExtensionToken(presented) {
  // Constant-time comparison to avoid timing-leak attacks.
  if (!presented || typeof presented !== 'string') return false;
  const { token } = await getExtensionToken();
  return timingSafeEqualStr(presented, token);
}
```

**Why a shared secret?** The rest of the OnBuzz local API is
deliberately unauthenticated, with wildcard CORS. That's fine for code
paths only the local UI calls. But the Quick Send endpoint is
trivially reachable by **any web page the user happens to visit** —
which is unacceptable when the LLM has tools. The token raises the
bar: a hostile page can't read the token because it's stored in the
extension's per-extension storage, not on any domain it can access.

**The token is never logged anywhere.** The file is 0600. Rotation is
"delete the file, restart OnBuzz, paste the new token into the
extension options."

### 5.2 `src/services/quickSendPolicy.js`

Hard-coded tool allowlist for the Quick Send agent.

```js
export const QUICK_SEND_ALLOWED_TOOLS = Object.freeze([
  'web',          // HTTP fetch / web read — follow links from the selection
  'pdf',          // read PDFs by URL
  'memory',       // agent's own state snapshots
  'skills',       // read-only library introspection
  'help',         // tool introspection metadata
  'user-prompt'   // ask the user for clarification — harmless
]);

export const RESTRICTED_TOOLSET_KEY = 'restrictedToolset';
export const QUICK_SEND_AGENT_NAME  = 'Quick Send';

export function buildQuickSendAgentConfig(preferredModel) {
  return {
    name: QUICK_SEND_AGENT_NAME,
    systemPrompt: [
      'You are the OnBuzz Quick Send agent.',
      '',
      'You receive snippets the user has highlighted on web pages via',
      'the OnBuzz browser extension...',
      '',
      'You are restricted to safe, read-only tools. You cannot run shell',
      'commands, write files, or affect any other agent. If a request',
      'asks you to do those things, refuse briefly and explain why.'
    ].join('\n'),
    model: preferredModel,
    capabilities: [...QUICK_SEND_ALLOWED_TOOLS],
    metadata: { [RESTRICTED_TOOLSET_KEY]: [...QUICK_SEND_ALLOWED_TOOLS] }
  };
}

export function diffQuickSendPolicy(agent) {
  // Returns the updates an existing Quick Send agent needs to come back
  // into compliance with the allowlist (capabilities + metadata.restrictedToolset).
  // Returns null if the agent is already conformant.
  // Preserves any unrelated metadata keys (icons, colours, etc.).
}
```

**The allowlist is hard-coded server-side.** The extension does not
get to choose. The policy is **re-asserted on every send** via
`diffQuickSendPolicy()` — so an admin who reconfigured the Quick Send
agent in the OnBuzz UI cannot accidentally relax the restrictions.

### 5.3 `src/core/messageProcessor.js` — runtime gate

`agent.capabilities` in this codebase is system-prompt-only; it
doesn't actually block tool dispatch at runtime. We added a tiny
runtime gate in `executeTools`:

```js
// In executeTools, before either sync or async dispatch fires:
if (Array.isArray(context.restrictedToolset)
    && !context.restrictedToolset.includes(command.toolId)) {
  this.logger.warn('Tool denied by restricted-toolset policy', {
    agentId: context.agentId, toolId: command.toolId,
    allowed: context.restrictedToolset
  });
  results.push({
    toolId: command.toolId,
    status: 'failed',
    error: `Tool '${command.toolId}' is not permitted for this agent. Allowed tools: ${context.restrictedToolset.join(', ')}`,
    timestamp: new Date().toISOString()
  });
  continue;
}
```

And the propagation, just above the `toolContext` build:

```js
const toolContext = {
  ...,
  restrictedToolset: Array.isArray(agent?.metadata?.restrictedToolset)
    ? agent.metadata.restrictedToolset
    : null,
};
```

**The gate is additive.** Agents without `metadata.restrictedToolset`
see zero behaviour change — only the Quick Send agent (and any future
agent that explicitly opts in) is subject to the new gate. Both sync
and async dispatch paths flow through the same `for` loop, so an
attempt to bypass via `isAsync: true` is blocked by the same check.

### 5.4 `src/interfaces/webServer.js` — the two endpoints

Imports + constants at the top:

```js
import { verifyExtensionToken } from '../services/extensionToken.js';
import {
  QUICK_SEND_AGENT_NAME, buildQuickSendAgentConfig, diffQuickSendPolicy
} from '../services/quickSendPolicy.js';

const EXTENSION_SESSION_PREFIX = 'extension-';
const QUICK_SEND_SESSION_ID    = `${EXTENSION_SESSION_PREFIX}quick-send`;
```

#### 5.4.1 `POST /api/chat/quick-send`

```
Headers: X-OnBuzz-Token: <token>
Body:    { selected_text, source_url?, page_title?, surrounding_text?, user_message? }
Returns: 200 { ok: true, agentId, conversationId, firstMessageIndex }
         401 invalid or missing token
         400 missing/oversized field (100 KB per field cap)
         500 agent create / send failure
```

Pipeline, in order:

1. **`verifyExtensionToken`** — 401 on any mismatch.
2. **Field validation** — `selected_text` required and non-empty;
   every text field capped at 100 KB using `Buffer.byteLength` (true
   UTF-8 byte count, not `.length`).
3. **Candidate-model picker** — reads BOTH the in-memory pool AND the
   persisted `agent-index.json` on disk:

   ```js
   const collectCandidates = async () => {
     // From the pool (in-memory snapshot, populated by RESUME_SESSION).
     const pool = await this.orchestrator.agentPool.listActiveAgents();
     const fromPool = pool
       .filter(a => a && a.name && a.name !== QUICK_SEND_AGENT_NAME && a.currentModel)
       .map(a => ({ name: a.name, model: a.currentModel, lastActivity: a.lastActivity, source: 'pool' }));

     // From disk (works even if no UI session has fired RESUME_SESSION).
     const index = await this.orchestrator.stateManager.loadAgentIndex(projectDir);
     const fromDisk = Object.entries(index || {})
       .filter(([id, v]) => id !== 'undefined' && v?.name && v.name !== QUICK_SEND_AGENT_NAME && v.model)
       .map(([, v]) => ({ name: v.name, model: v.model, lastActivity: v.lastActivity, source: 'disk' }));

     // De-dupe by name (pool wins — currentModel is more authoritative
     // than the index's snapshotted model), sort by lastActivity desc.
     const byName = new Map();
     for (const c of fromDisk) byName.set(c.name, c);
     for (const c of fromPool) byName.set(c.name, c);
     return Array.from(byName.values()).sort(byLastActivityDesc);
   };
   ```

   This is the fix for the "Quick Send was getting created with
   `anthropic-sonnet` when I only have Ollama" bug. The in-memory pool
   is empty when the user only uses the extension (no UI session has
   fired `RESUME_SESSION`); falling through to `system.defaultModel`
   pointed at Anthropic. Reading the persisted index makes the picker
   disk-aware.

4. **Find-or-create-or-heal Quick Send agent**:
   - **Not present** → pick the top candidate's model, build the agent
     config from `buildQuickSendAgentConfig()`, dispatch `CREATE_AGENT`.
   - **Present but `currentModel` doesn't match any candidate** →
     **heal** by sending `UPDATE_AGENT` with `preferredModel` /
     `currentModel` rewritten to the candidate's model. The same call
     re-asserts the policy via `diffQuickSendPolicy`.

5. **Compose the message** — the chat store doesn't render structured
   metadata, so we lay out the context as a plain-text header:

   ```
   Page title: <title>
   Source URL: <url>

   Selected text:
   <selected_text>

   Surrounding context:
   <surrounding_text>     (only if provided)

   User question: <user_message>   (only if provided)
   ```

6. **Snapshot `firstMessageIndex`** *before* sending. The side panel
   polls "messages since this index" so it sees only the current send
   plus its reply — never historic turns in the rolling conversation.

7. **`processRequest({ action: SEND_MESSAGE })`** through the
   orchestrator — same path as the main UI. Mode is hardcoded `'chat'`
   (one user turn, one assistant reply); AGENT mode would kick off the
   autonomous loop, wrong for paste-and-go.

8. Returns `{ ok: true, agentId, conversationId: 'full', firstMessageIndex }`.
   `conversationId: 'full'` is the well-known key for the rolling
   conversation — surfaced for forward compatibility if OnBuzz ever
   grows per-thread conversations.

#### 5.4.2 `GET /api/chat/quick-send/messages?agentId=&since=N`

```
Headers: X-OnBuzz-Token: <token>
Returns: 200 {
           ok, agentId, total,
           messages: [{ index, role, content, timestamp, type }],
           agentStatus, currentModel, unhealthy, errorHint
         }
         401 invalid token
         400 missing agentId
         404 Quick Send agent gone
```

Polled by the side panel at 1.5 s intervals. Notable behaviour:

- **Refuses to expose arbitrary agents** — only an agent named exactly
  `'Quick Send'` is accessible. Cheap safety guard.
- **Returns `unhealthy: true`** when the agent's status is paused /
  suspended, OR when a `[system-error]` user-role message has been
  injected by the scheduler after a failed AI call. The side panel
  uses this to fail fast instead of polling for 60 seconds.
- **Normalises content shape** —
  `typeof m.content === 'string' ? m.content : (m.content?.text || '')`
  so providers that return structured content don't break the JSON
  contract.

#### 5.4.3 `broadcastToSession` tweak

The OnBuzz WebSocket layer used to log
`🔄 No connections for session` and then **fan the message out to every
WS connection in the system** when no session-specific connection was
registered. For extension calls that's both noise and active
cross-talk — assistant messages produced for the Quick Send agent
would leak into the main UI's WS feed.

Added an early return for the extension prefix, ~5 lines:

```js
broadcastToSession(sessionId, message) {
  // The browser extension talks to the server over REST polling and
  // never opens a WebSocket. Sessions in the `extension-` namespace
  // therefore have zero connections BY DESIGN. Returning early keeps
  // the WS layer clean and silent for the extension's polling flow.
  if (typeof sessionId === 'string' && sessionId.startsWith(EXTENSION_SESSION_PREFIX)) {
    return;
  }
  // ... existing per-session-then-fallback logic
}
```

### 5.5 Tests — `messageProcessor.restrictedToolset.test.js`

14 Jest tests covering the gate's contract:

| Case | What it pins down |
|---|---|
| No `restrictedToolset` → tool runs | The gate is purely additive |
| `null` → tool runs | Defensive: null is "no policy" |
| Non-array → tool runs | Type-strict: only `Array.isArray` enables the gate |
| Allowed tool runs | Happy path |
| Blocked tool denied (sync) | Result has `status: 'failed'` and the error names the allowlist |
| Blocked tool denied (async) | `isAsync: true` does NOT bypass the gate |
| Empty allowlist denies everything | Boundary case |
| Mixed batch | Allowed completes, blocked fails — independent results |
| `buildQuickSendAgentConfig` shape | Allowlist appears in BOTH capabilities and `metadata.restrictedToolset` |
| Allowlist contents pinned | Adding a new tool requires a deliberate test update |
| Negative assertions | `terminal`, `filesystem`, `taskmanager`, `platformcontrol` NOT in the allowlist |
| `diffQuickSendPolicy` conformant | Returns `null` when in sync |
| `diffQuickSendPolicy` drifted | Proposes the allowlist when capabilities / metadata are missing |
| Preserves unrelated metadata | `icon`, `color` etc. survive the diff |

---

## 6. End-to-end flow narrative

When the user highlights a paragraph and right-clicks **Send to OnBuzz
agent**:

1. **`background.js`** receives `contextMenus.onClicked`. Validates a
   selection exists.
2. Calls **`chrome.sidePanel.open({ windowId })` synchronously** — the
   user-gesture token is still valid because no `await` ran first.
3. Fires `stashSelection({ selected_text, source_url, page_title })`
   asynchronously. The write to `chrome.storage.session` happens;
   afterwards a runtime message `'onbuzz/selection-staged'` notifies
   the panel.
4. **`sidepanel.html` loads**. `sidepanel.js`'s IIFE init reads
   `chrome.storage.session`, finds the staged selection (or not,
   depending on the race — the `onMessage` listener handles either
   ordering), calls `renderSelection(staged)`.
5. `renderSelection` populates the selection card (page title, host
   extracted via `URL`, RTL-aware quote with brand-yellow accent
   stripe), unhides action chips, shows the "● Selection attached"
   pill, sets the header sub-line to the host.
6. User clicks **"Summarize"** → action-chips listener fires →
   textarea filled with the chip's `data-prompt` → `handleSend()`.
7. `handleSend` stamps `myInvocation`, disables the form, appends a
   user bubble, appends a loading assistant bubble (mascot avatar
   bouncing, 3 staggered dots).
8. Composes a language hint (if `replyLanguage` is set) + the user
   message, then `postQuickSend` POSTs to the backend.
9. **`POST /api/chat/quick-send`** runs: token verified, fields
   validated, candidate models collected from pool + disk, Quick Send
   agent created (model = most-recently-active non-QS agent's model)
   or healed, policy re-asserted, message composed, dispatched through
   `orchestrator.processRequest({ SEND_MESSAGE })`. Returns
   `{ agentId, firstMessageIndex }`.
10. **`pollForReply`** starts. Every 1.5 s it `GET`s
    `/api/chat/quick-send/messages?agentId=…&since=N` and looks for an
    assistant role message with non-empty content. The loop also bails
    fast on `body.unhealthy = true`.
11. **Meanwhile, the OnBuzz scheduler is running the agent.** The
    agent's first AI call uses the picked model against the
    user-configured provider (Ollama, Anthropic, etc.). If the LLM
    response wants to call a tool, `executeTools` runs the
    restricted-toolset gate — if the tool isn't in
    `agent.metadata.restrictedToolset`, it's denied with
    `status: 'failed'` *before* sync or async dispatch.
12. Assistant reply lands in `agent.conversations.full.messages` via
    the scheduler's `addMessageToConversation`. The WS layer's
    `broadcastToSession` is called with the `extension-quick-send`
    session id — recognised by prefix and skipped (no fan-out, no
    warning).
13. **Next poll** sees the assistant message in `messages.slice(since)`.
    The poll function returns it.
14. **`handleSend` continuation** checks `isStale()` (still the latest
    invocation), removes the loading bubble, appends a real assistant
    bubble, hides the action-chips card (because the conversation now
    has a real reply), clears `activePollAbort`.
15. User can continue typing follow-ups in the same conversation. A
    fresh right-click selection invalidates the in-flight invocation
    via `invalidateInFlightSend`, clears the conversation, and
    re-shows the chips.

---

## 7. Security model — recap

- **Extension origin locked to localhost / 127.0.0.1** via
  `host_permissions`. The extension cannot reach any public-internet
  host.
- **Every extension-facing endpoint requires `X-OnBuzz-Token`** —
  generated automatically on first server boot, stored at
  `<userDataDir>/settings/extension-token.json` with mode 0600. The
  user copies it once into the extension's options page.
  `ONBUZZ_EXTENSION_TOKEN` env takes precedence for headless setups.
- **Constant-time token comparison** (`timingSafeEqualStr`) prevents
  timing-leak attacks.
- **Token never logged**, even at debug levels.
- **Quick Send agent runs with a hard-coded tool allowlist** of
  read-only safe tools. The allowlist is **re-asserted on every send**.
  The runtime gate denies blocked tools **before** dispatch (sync OR
  async), with the failure embedded in the conversation so the LLM
  understands and stops trying.
- **The extension never tells the backend which tools to allow.** The
  backend is the only place that knows.
- **No telemetry, no remote calls** — every byte of selection data
  stays on the user's machine.

---

## 8. The restricted tool policy — a closer look

Why it exists, in one sentence:

> The Quick Send agent receives arbitrary text the user highlighted on
> a web page. A maliciously-crafted selection could try to coax the LLM
> into calling destructive tools ("now run `rm -rf` to free up space…").

`agent.capabilities` in this codebase is system-prompt-only — it tells
the LLM what's available, but doesn't block dispatch. So we attach a
**separate, authoritative allowlist** to the agent via
`agent.metadata.restrictedToolset` and enforce it at
`messageProcessor.executeTools`. Both sync and async dispatch flow
through the same loop, so an attempt to bypass via `isAsync: true` is
blocked by the same check.

The allowlist is hand-picked from `src/utilities/toolConstants.js`:

| Tool | Status | Rationale |
|---|---|---|
| `web` | ✅ allowed | HTTP fetch / read pages by URL — needed to follow links from the selection |
| `pdf` | ✅ allowed | Read PDFs by URL |
| `memory` | ✅ allowed | Agent's own state snapshots |
| `skills` | ✅ allowed | Read-only library introspection |
| `help` | ✅ allowed | Tool introspection metadata |
| `user-prompt` | ✅ allowed | Ask the user for clarification — harmless |
| `terminal` | ❌ blocked | Shell execution |
| `filesystem`, `file-content-replace` | ❌ blocked | Write or modify files |
| `taskmanager`, `jobdone` | ❌ blocked | Affect other agents / autonomous loops |
| `agentcommunication` | ❌ blocked | Message other agents |
| `platformcontrol` | ❌ blocked | Create / delete agents, schedules, flows |
| `dependency-resolver` | ❌ blocked | Install packages |

Re-applying the policy on every send means an admin who reconfigured
the Quick Send agent in the UI cannot accidentally relax the
restrictions — the next quick-send resets the allowlist.

---

## 9. UX behaviours worth knowing

### 9.1 Quick action chips disappear after the first reply

The chips are most useful **before** sending — they're decision aids
("how should I send this?"). After the first reply, they crowd the
conversation. Tied to "first real assistant message":

```js
if (role === 'assistant' && !loading && els.actionChips) {
  els.actionChips.classList.add('hidden');
}
```

They reappear automatically when a fresh selection is staged (via
`renderSelection`) or after "Clear selection".

### 9.2 RTL bubbles flip the speaker corner

The bubble's `dir` attribute is set per message based on `detectDir()`
(Hebrew/Arabic vs Latin). CSS flips both the row's flex justification
AND the squared "speaker corner":

```css
.bubble.assistant            { border-bottom-left-radius:  4px; }
.bubble.assistant[dir="rtl"] { border-bottom-left-radius: 18px;
                               border-bottom-right-radius: 4px; }
```

A Hebrew reply correctly hugs the right side with the mascot avatar
on its right.

### 9.3 The stale-invocation guard

The bug it prevents: assistant reply renders, then a *"Timed out
waiting for the agent reply"* banner appears ~60 s later. Root cause:
a superseded `handleSend`'s `pollForReply` continues running because
its `setTimeout`-based sleep isn't abort-aware between iterations. When
it eventually throws the timeout error, the catch block previously
called `showError` unconditionally.

Fix: a monotonic `sendInvocationCounter` stamped on each `handleSend`
invocation. The catch and finally blocks both check `isStale()` and
exit silently if a newer invocation has taken over.

### 9.4 Language hint as content, not as a separate field

When the user picks a non-Auto reply language, the extension prepends
`[Reply in <Lang>.]` to the user message client-side. The backend
treats it as plain content. The LLM sees it as an instruction and
obeys. This keeps the wire format unchanged and avoids a backend
contract change.

### 9.5 Voice input locale follows the reply language

Picking Hebrew once gives you **both** Hebrew transcription
(`recognition.lang = 'he-IL'`) AND Hebrew replies (the language hint).
One choice, both behaviours.

---

## 10. Bug archaeology

Worth knowing because the fixes left fingerprints in the code:

| # | Symptom | Root cause | Fix |
|---|---|---|---|
| 1 | Side panel didn't auto-open from the context menu | `chrome.sidePanel.open()` is user-gesture-gated; the gesture token was consumed by `await stashSelection(...)` before the open call | Reordered: open synchronously first, stash + notify after (fire-and-forget) |
| 2 | Enter in textarea did nothing | Original keydown handler only matched Cmd/Ctrl+Enter | Plain Enter sends; Shift+Enter newlines; `isComposing` guard for IME |
| 3 | "Thinking…" forever, then a misleading timeout banner | Quick Send agent created with `anthropic-sonnet` (hardcoded fallback); user only had Ollama → AI call failed → agent paused → no assistant message → poll hit the 60 s timeout | Disk-aware model picker reads the persisted `agent-index.json` when the in-memory pool is empty; existing agents get healed on next send |
| 4 | Assistant reply appeared, then a "Timed out" banner appeared 60 s later | Stale `pollForReply` from a superseded `handleSend` invocation kept running; its `setTimeout` sleep is not abort-aware between iterations | Per-invocation `sendInvocationCounter`; `isStale()` check at the top of the catch + finally |
| 5 | `🔄 No connections for session` warnings on every reply + assistant messages from Quick Send leaking into the main UI's WS feed | Each quick-send minted a unique ephemeral `ext-…` sessionId; no WS connection ever joined any of them; broadcaster's fallback fanned the message out to every WS client | Stable `QUICK_SEND_SESSION_ID = 'extension-quick-send'`; `broadcastToSession` early-returns for the `extension-` prefix |
| 6 | Quick Send agent paused with no actionable feedback | `unhealthy` signal didn't exist | Poll endpoint surfaces `agentStatus`, `currentModel`, `unhealthy`, `errorHint`; side panel throws fast and renders an actionable banner |
| 7 | Quick actions chips stayed after the first assistant reply | No hide-after-reply hook | In `appendMessage`, hide `#actionChips` when `role === 'assistant' && !loading`; `renderSelection` re-shows on new selection |
| 8 | Assistant bubble's top corners looked clipped | `border: 1px solid transparent` sat outside the background fill, offsetting the visible corners | Removed transparent border; switched bubble radii to explicit longhand corners |

---

## 11. Known limitations and follow-ups

Carried over from `docs/BROWSER_EXTENSION.md`'s "Known limitations and
follow-ups" section — flagged here for the architectural reader:

- **Polling, not streaming.** The side panel polls every 1.5 s. A
  proper streaming UX (token-by-token render, instant tool-result
  feedback) needs a push channel. Viable paths:
  - Server-Sent Events from the new endpoint — straightforward; we
    already own the session.
  - Offscreen-document WebSocket bridge — more code, but unlocks the
    existing WS message bus.
- **Pool population on extension-only usage.** Worked around (the
  picker reads the on-disk index) but the underlying fact remains:
  agents only enter the in-memory pool when the web UI fires
  `RESUME_SESSION`. A tidier solution would be to auto-resume at
  server boot.
- **Two persisted Quick Send agents on disk** are possible because
  find-or-create runs against the in-memory pool. The disk-aware
  picker sees them via the index but agent-pool reuse still requires
  an instance loaded. A small follow-up could merge duplicates on
  first read. Not blocking.
- **Inline settings page** (state #6 in the design). Settings still
  opens `options.html`.
- **History icon** — present in the header but disabled. Not wired.
- **Copy / Regenerate** buttons under assistant bubbles. Skipped.
- **Voice output** — only voice input is wired.
- **Surrounding-text capture.** The endpoint accepts `surrounding_text`
  but `background.js` doesn't grab the surrounding paragraph (would
  need a content script + a CSP review).
- **Session map memory.** Switching to a stable `extension-quick-send`
  id stops the bloat from this endpoint, but the underlying
  orchestrator never expires `sessions` — that's a wider issue
  unrelated to the extension.

---

## 12. Files inventory (every artifact, in one list)

```
browser-extension/manifest.json                                       MV3 manifest
browser-extension/background.js                                       service worker
browser-extension/sidepanel.html                                      panel structure
browser-extension/sidepanel.css                                       palette + layout
browser-extension/sidepanel.js                                        controller
browser-extension/options.html                                        options UI
browser-extension/options.js                                          options persistence
browser-extension/assets/mascot.webp                                  brand mascot
browser-extension/assets/wordmark.webp                                "OnBuzz" wordmark
browser-extension/icons/icon-{16,32,48,128,256}.png                   extension icons

src/services/extensionToken.js                                        token resolver + verify
src/services/quickSendPolicy.js                                       allowlist + diff helpers
src/core/messageProcessor.js              (modified)                  runtime gate
src/interfaces/webServer.js               (modified)                  endpoints + WS tweak
src/core/__tests__/messageProcessor.restrictedToolset.test.js         14 tests, all pass

docs/BROWSER_EXTENSION.md                                             user-facing guide
docs/SEND_TO_ONBUZZ_IMPLEMENTATION.md                                 this file
```

Everything is local to the working tree — no commits have been pushed.
The diff is ready when you are.
