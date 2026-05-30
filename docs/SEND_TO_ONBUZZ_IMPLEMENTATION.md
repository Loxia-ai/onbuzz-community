# Send to OnBuzz — Implementation Notes

How the **Send to OnBuzz agent** feature is wired end-to-end. For
install/use instructions see
[`BROWSER_EXTENSION.md`](./BROWSER_EXTENSION.md).

## Architecture in one paragraph

The browser extension is a thin client that, on right-click, opens
Chrome's Side Panel and POSTs the highlighted text to a single,
token-gated endpoint on the local OnBuzz server. The endpoint
authenticates, finds (or lazily creates) a regular pool agent named
**Quick Send**, and dispatches the message through the standard
orchestrator pipeline. The Side Panel then polls a second endpoint
for the assistant's reply. There is no special scheduler behaviour,
no thread store, and no policy layer — Quick Send is an ordinary
agent whose `capabilities` array is the only thing controlling which
tools the LLM can invoke.

## Flow

```
┌─────────────────────────────┐
│  Right-click selection      │
│  → "Send to OnBuzz agent"   │
└──────────────┬──────────────┘
               │
               ▼
┌─────────────────────────────┐
│  browser-extension/         │
│  background.js              │   1. chrome.sidePanel.open (sync)
│  (MV3 service worker)       │   2. stash selection in
└──────────────┬──────────────┘      chrome.storage.session
               │
               ▼
┌─────────────────────────────┐
│  sidepanel.html / .js / .css                                      │
│  - Reads stash, renders selection card + chat                     │
│  - POST /api/chat/quick-send                                      │
│      X-OnBuzz-Token: <token>                                      │
│      { selected_text, source_url?, page_title?,                  │
│        surrounding_text?, user_message? }                         │
│  - Polls GET /api/chat/quick-send/messages?agentId=&since=        │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  src/interfaces/webServer.js  (POST /api/chat/quick-send)        │
│                                                                  │
│  1. verifyExtensionToken (constant-time)                         │
│  2. Validate body — selected_text required, 100KB per field cap  │
│  3. agentPool.listActiveAgents → find agent named "Quick Send"   │
│  4. If absent: orchestrator.processRequest(CREATE_AGENT, seed)   │
│  5. composeQuickSendMessage → single plain-text user turn        │
│  6. orchestrator.processRequest(SEND_MESSAGE, mode='chat')       │
│  7. Return { ok, agentId, firstMessageIndex }                    │
└──────────────┬──────────────────────────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────────────────────────┐
│  Existing OnBuzz pipeline (NO Quick Send-specific code)          │
│    orchestrator → messageProcessor → agentScheduler →            │
│      aiService → executeTools (gated by agent.capabilities at    │
│      the function-schema layer)                                  │
│      → agent.conversations.full.messages                         │
└──────────────────────────────────────────────────────────────────┘
```

## Files

```
browser-extension/                       Chrome extension package
├── manifest.json                        MV3 + sidePanel + localhost host_permissions
├── background.js                        context menu, sidePanel.open, selection stash
├── sidepanel.html/.css/.js              chat UI + send/poll loop
├── options.html/.js                     server URL + token form
├── assets/, icons/                      brand mascot, wordmark, icon sizes
└── ...

src/services/extensionToken.js           token resolver, constant-time verify
src/interfaces/webServer.js              the two endpoints + agent seed + WS guard
                                         (no other backend code is Quick Send-aware)

docs/BROWSER_EXTENSION.md                user-facing guide
docs/SEND_TO_ONBUZZ_IMPLEMENTATION.md    this file
```

That's the entire Quick Send-aware surface area in the backend.

## Extension side

### `manifest.json`

Manifest V3. Three load-bearing fields:

- `host_permissions: ['http://localhost/*', 'http://127.0.0.1/*']` —
  the extension cannot reach any public-internet host.
- `permissions: ['contextMenus', 'storage', 'notifications', 'sidePanel']`.
- `minimum_chrome_version: 114` — `sidePanel` API floor.

### `background.js`

A stateless MV3 service worker with three responsibilities:

1. **Idempotent context menu registration.** `removeAll + create` on
   `onInstalled` and `onStartup` because the worker may be killed and
   re-woken at any time, and `create` throws on duplicate id.
2. **Gesture-preserving click handler.** `chrome.sidePanel.open()` is
   user-gesture-gated, and the gesture token is consumed by the first
   `await` in the handler. So the handler:
   - validates the selection synchronously,
   - calls `chrome.sidePanel.open({ windowId })` synchronously,
   - then fires `stashSelection(...)` fire-and-forget, which writes
     `chrome.storage.session` and sends a runtime
     `'onbuzz/selection-staged'` message for any already-open panel.

   If you `await stashSelection(...)` first, Chrome silently rejects
   the later `open()` because the gesture is gone.

3. **Toolbar icon convenience.** `setPanelBehavior({ openPanelOnActionClick: true })`.

### `sidepanel.js`

Single-page vanilla JS, no build step.

- `readStagedSelection()` reads the stash on panel open; the
  `'onbuzz/selection-staged'` listener handles selections arriving
  while the panel is already open.
- `renderSelection(sel)` is the single state router for the UI.
- `appendMessage({role, content, loading})` builds bubbles. Loading
  state shows three bouncing dots; the assistant's avatar bounces
  while thinking. `textContent` everywhere — never `innerHTML`.
- `handleSend()` calls `postQuickSend()` then `pollForReply()`. A
  per-invocation `sendInvocationCounter` + `isStale()` guard prevents
  a superseded poll's late timeout from overwriting a freshly-rendered
  reply. An `AbortController` aborts the in-flight fetch when a new
  selection or a Clear-Selection click arrives.
- `pollForReply()` polls every 1.5s for up to 60s. It hard-fails on
  401 / 404, retries up to 3 transient errors, and bails fast when
  the response carries `unhealthy: true`.
- Optional client-side features: reply-language picker (prepends
  `[Reply in <Lang>.]` to the user message), voice input (Web Speech
  API), quick-action chips (Summarize/Translate/etc. populate the
  textarea then `handleSend`).
- Per-message direction detection from text content (Hebrew/Arabic
  vs Latin), so an English follow-up after a Hebrew selection still
  lays out LTR.

### `options.html` / `options.js`

Two persisted fields in `chrome.storage.local`: `serverUrl` (default
`http://localhost:8080`, validated to http/https + trailing slash
stripped) and `token` (password input).

## Backend side

### `src/services/extensionToken.js`

Two-tier resolver:

1. `ONBUZZ_EXTENSION_TOKEN` env var.
2. `<userDataPaths.settings>/extension-token.json`, mode 0600,
   auto-generated on first call (`randomBytes(32).toString('hex')`).

`verifyExtensionToken(presented)` does a constant-time string compare
to avoid timing-leak attacks. The token is never logged.

### `src/interfaces/webServer.js`

All Quick Send-aware backend code lives here. Three small additions
on top of the standard endpoint file:

1. **Constants and helpers** (top of the file):
   - `QUICK_SEND_AGENT_NAME = 'Quick Send'` — what the extension's
     agent is called and how the endpoint looks it up.
   - `EXTENSION_SESSION_ID = 'extension-quick-send'` — the session id
     used for all extension dispatches. The WS broadcaster
     (`broadcastToSession`) early-returns for this exact id so the
     extension's polling-only flow doesn't trigger fan-out warnings.
   - `QUICK_SEND_DEFAULT_CAPABILITIES` — the seed capability list
     (`web`, `pdf`, `memory`, `skills`, `help`, `user-prompt`). After
     the agent is created the user owns this — the endpoint never
     touches it again.
   - `QUICK_SEND_SYSTEM_PROMPT` — the seed system prompt.
   - `buildQuickSendAgentSeed(model)` — returns the payload for a
     `CREATE_AGENT` orchestrator action.
   - `composeQuickSendMessage({...})` — builds the single plain-text
     user turn: page title + URL + selected text + optional question.

2. **`POST /api/chat/quick-send`**:

   ```
   verify token → validate body → find singleton "Quick Send" agent →
   create if absent (using seed + system.defaultModel) →
   snapshot firstMessageIndex →
   processRequest(SEND_MESSAGE, mode='chat') →
   return { ok, agentId, firstMessageIndex }
   ```

   Body shape: `{ selected_text, source_url?, page_title?,
   surrounding_text?, user_message? }`. Each text field is capped at
   100 KB (`Buffer.byteLength`, true UTF-8 bytes).

   The endpoint does not mutate the agent after creation — capabilities,
   model, and system prompt are managed by the user in the OnBuzz UI
   like any other agent.

3. **`GET /api/chat/quick-send/messages?agentId=&since=N`**:

   Refuses any agent not named exactly `Quick Send`. Returns
   `agent.conversations.full.messages.slice(since)` along with the
   fail-fast signals the side panel relies on:

   - `agentStatus` — raw status.
   - `unhealthy` — `true` when the agent is paused/suspended OR a
     `[system-error]` / `AI service error` user-role row has been
     injected by the scheduler after a failed AI call.
   - `errorHint` — the relevant line so the banner has something
     useful to show.

## Security model

- **Localhost only.** Extension `host_permissions` are pinned to
  `http://localhost/*` and `http://127.0.0.1/*`.
- **Token-gated.** Both endpoints require `X-OnBuzz-Token`. The token
  is stored in extension-scoped storage no web page can read.
- **Auto-generated 0600 file**, env override available, never logged.
  Rotate by deleting the file and restarting the server.
- **Capabilities filter dispatch at the schema layer.**
  `getToolSchemasForAgent(agent.capabilities)` in
  `src/core/agentScheduler.js` strips schemas the agent isn't allowed
  to call before the LLM ever sees the tool list. Removing a tool
  from the Quick Send agent's `capabilities` removes the LLM's
  ability to call it.
- **No runtime tool gate.** The previous implementation had a
  separate `restrictedToolset` runtime gate inside
  `messageProcessor.executeTools`; it was removed in this version. If
  a user (the local admin) ticks a tool back on in the Settings UI,
  the agent gets it. This is the standard OnBuzz trust model — any
  other agent in the system works the same way.

## Tradeoffs vs the previous source-grounded design

The earlier implementation kept per-selection thread isolation: each
new highlight archived prior turns and the source text lived on a
"source anchor" injected into the system prompt by a scheduler hook.
That gave clean cross-selection separation at the cost of a
substantial new subsystem (`quickSendThreadStore`, `quickSendHistoryPolicy`,
`quickSendPolicy`, the runtime tool gate, plus scheduler hooks). The
current implementation deletes all of it and accepts:

- **One rolling conversation.** Subsequent highlights append to the
  same `agent.conversations.full.messages` — the model sees prior
  selections in its context window. Users who want a clean break open
  the Quick Send agent in the OnBuzz UI and clear it.
- **Capabilities are the only enforcement.** The schema-layer filter
  is sufficient for the local-app threat model; the runtime gate is
  gone.
- **Model is fixed at create-time.** No disk-aware candidate picker;
  if `system.defaultModel` is unset, the endpoint returns 503 with an
  actionable hint.

In exchange the entire backend feature lives in ~220 lines of
`webServer.js` plus the small `extensionToken.js` helper. No new core
abstractions, no scheduler changes, no `messageProcessor` hooks.
