# Send to OnBuzz — Chrome Extension (Side Panel)

A Manifest V3 Chrome extension that adds a **Send to OnBuzz agent**
right-click action and opens a Side Panel chat with your local OnBuzz
server. Highlight text on any web page, right-click, the Side Panel
pops open with the selection staged, you add an optional question and
hit **Send**, and the **Quick Send** agent answers — running under a
restricted tool policy.

## How it works (high level)

1. You highlight text on a page.
2. You right-click → **Send to OnBuzz agent**.
3. The extension's service worker stashes `{ selected_text, source_url,
   page_title }` in `chrome.storage.session` and opens the Side Panel.
4. The Side Panel reads the staged selection and shows it. You can add
   an optional question.
5. You click **Send**. The Side Panel POSTs to
   `http://localhost:8080/api/chat/quick-send` with the
   `X-OnBuzz-Token` header.
6. OnBuzz validates the token, finds or creates an agent named
   **Quick Send**, reapplies the restricted tool policy, and routes the
   message through the normal chat pipeline.
7. The Side Panel polls
   `GET /api/chat/quick-send/messages?agentId=...&since=N` until the
   assistant's reply lands, then renders it.

The extension is intentionally thin. It sends `selected_text`,
`source_url`, `page_title`, and an optional `user_message`. It does
**not** choose which tools the agent may use — the backend decides.

## Install

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome (or any Chromium browser that
   supports MV3 + `sidePanel`, i.e. Chrome 114+).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked** and pick the `browser-extension/` directory
   at the repo root.
5. The extension appears as **Send to OnBuzz**.

## Configure

OnBuzz generates a random extension token the first time the server
boots after this feature is installed. Copy that token into the
extension once.

1. Start OnBuzz (`npm start` from the repo root, or your usual
   launcher).
2. Find the token file. Its location depends on your OS:
   - **macOS**:
     `~/Library/Application Support/loxia-autopilot/settings/extension-token.json`
   - **Linux**:
     `~/.local/share/loxia-autopilot/settings/extension-token.json`
     (or `$XDG_DATA_HOME/loxia-autopilot/settings/extension-token.json`)
   - **Windows**:
     `%LOCALAPPDATA%\loxia-autopilot\settings\extension-token.json`
   - If you've set `LOXIA_DATA_DIR`, the file lives under
     `$LOXIA_DATA_DIR/settings/extension-token.json`.
3. Open the file and copy the `token` value (a long hex string).
4. In Chrome, right-click the extension icon → **Options**, or visit
   `chrome://extensions` → **Details → Extension options**.
5. Paste the token. The default server URL of `http://localhost:8080`
   matches OnBuzz's default; change it if you run on a different port.
6. Click **Save**.

### Using an environment variable instead

For headless / containerised setups, set `ONBUZZ_EXTENSION_TOKEN` in
the environment OnBuzz runs in:

```bash
export ONBUZZ_EXTENSION_TOKEN="$(openssl rand -hex 32)"
npm start
```

The env var takes precedence over the file. Paste the same value into
the extension's options page.

## Use

1. Make sure OnBuzz is running locally.
2. Open any web page and highlight some text.
3. Right-click → **Send to OnBuzz agent**.
4. The Side Panel slides in. The selection card shows the page title,
   source URL, and the selected text.
5. (Optional) type a question into the composer at the bottom — for
   example, "Summarise this in two bullet points."
6. Click **Send** (or ⌘/Ctrl+Enter).
7. The assistant's reply appears below the user message. You can keep
   the conversation going by typing more questions; the agent already
   has the page context from the first send.
8. To start fresh with a new selection, just highlight new text on a
   page and right-click again. The Side Panel resets.

The microphone icon is a placeholder for a future voice-input feature
— it's disabled in this release.

## Security model

- **Explicit user action only.** The extension never reads page text on
  its own. The context-menu entry only appears when text is selected,
  nothing is staged until you click it, and nothing is sent until you
  hit **Send** in the Side Panel.
- **Localhost only by default.** Manifest `host_permissions` are
  limited to `http://localhost/*` and `http://127.0.0.1/*`. The
  extension cannot reach any remote server.
- **Token-gated endpoint.** The rest of the OnBuzz local API is
  unauthenticated (intentional for a local-dev tool, with wildcard
  CORS). The quick-send endpoints require `X-OnBuzz-Token`, which a
  random web page does not have access to — the token is stored in
  the extension's per-extension storage. Treat the token like a
  password.
- **Rotate by deleting** `extension-token.json` (or unsetting the env
  var) and restarting OnBuzz; a new token is generated automatically.
  Re-paste it into the extension.
- **Restricted tool policy on the server.** See below.
- **Don't send anything you wouldn't paste manually.** The same
  caveats that apply to copy/paste into a chat apply here.

## Restricted tool policy (Quick Send agent)

The Quick Send agent is created (and re-asserted on every send) with a
hand-picked allowlist of safe, read-only tools. The backend — **not**
the extension — decides the allowlist. The list lives in
`src/services/quickSendPolicy.js` and currently allows:

- `web`     — HTTP fetch / web read (so the agent can follow links from
  the selection)
- `pdf`     — read PDFs referenced by URL
- `memory`  — agent self-state
- `skills`  — read-only library introspection
- `help`    — tool introspection metadata
- `user-prompt` — ask the user for clarification

Tools that are **not** in the allowlist are denied at dispatch time in
`messageProcessor.executeTools`. This includes (non-exhaustive):

- `terminal` — shell execution
- `filesystem`, `file-content-replace` — write or modify files
- `taskmanager`, `jobdone` — affect other agents or autonomous loops
- `agentcommunication` — message other agents
- `platformcontrol` — create/delete agents, schedules, flows
- `dependency-resolver` — install packages

The agent enforcement is real, not just a hint: the gate runs before
both synchronous and asynchronous tool dispatch, so even if the LLM
asks for a blocked tool the runtime refuses.

Re-applying the policy on every send means an admin who reconfigured
the Quick Send agent in the OnBuzz UI cannot accidentally relax the
restrictions — the next quick-send will reset the allowlist.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Side Panel: "Could not reach OnBuzz." | Server isn't running, wrong server URL, or network blocked. | Start OnBuzz; verify the URL in Options matches the port the server logs at startup (look for `Web server initialized … url: http://...`). |
| Side Panel: "OnBuzz rejected the extension token." | The token in the extension doesn't match what the server expects. | Re-copy the token from `extension-token.json` (or the env var) into Options. |
| Side Panel: "Extension token is not set." | First-run state — you haven't filled in Options yet. | Follow **Configure** above. |
| Notification: "No text selected." | The context menu fired without an active selection (rare). | Re-highlight the text and try again. |
| Side Panel: "Timed out waiting for the agent reply." | The agent's underlying model call is taking too long, or the configured default model has no provider key. | Complete the OnBuzz onboarding (Settings → Providers) so the default model has a key. The timeout is 60s — long replies on slow models can hit it. |
| Side Panel opens with an empty state. | The selection wasn't captured (very long pages with dynamic text sometimes confuse the context-menu API). | Re-highlight a smaller chunk and try again. |
| The agent refuses to run shell / file commands. | This is the **restricted tool policy** working as intended. | Use the regular OnBuzz UI for tasks that need those tools — Quick Send is deliberately limited. |

## File map (for reviewers)

- **Extension**: [`browser-extension/`](../browser-extension/)
  - `manifest.json` — MV3 + `sidePanel` + `contextMenus`/`storage`/`notifications`
  - `background.js` — service worker, context menu, staging, side-panel-open
  - `sidepanel.html`/`sidepanel.css`/`sidepanel.js` — the chat UI
  - `options.html`/`options.js` — server URL + token

- **Backend endpoint**:
  [`src/interfaces/webServer.js`](../src/interfaces/webServer.js)
  — `POST /api/chat/quick-send` and `GET /api/chat/quick-send/messages`.

- **Quick Send policy**:
  [`src/services/quickSendPolicy.js`](../src/services/quickSendPolicy.js)
  — allowlist + helpers to create/re-assert the policy on the agent.

- **Runtime gate**:
  [`src/core/messageProcessor.js`](../src/core/messageProcessor.js)
  — `executeTools` now denies tools not in
  `context.restrictedToolset` when one is present. The check is
  additive: agents without `metadata.restrictedToolset` see no
  behaviour change.

- **Token resolver**:
  [`src/services/extensionToken.js`](../src/services/extensionToken.js)
  — `ONBUZZ_EXTENSION_TOKEN` env first, otherwise reads or
  auto-generates `settings/extension-token.json` (mode 0600).
  Constant-time comparison on verify.

## Known limitations and follow-ups

- **One rolling conversation per agent.** OnBuzz today stores a single
  conversation under `agent.conversations.full`. The Side Panel
  filters by `firstMessageIndex` so it only shows messages from the
  current send; the server still keeps history.
- **No deep-linking yet.** Opening `http://localhost:8080/` in a tab
  does not auto-focus the Quick Send agent. Click it in the agent
  list to see the rolling conversation.
- **Microphone button is a placeholder.** It is disabled and present
  only so the UI structure is ready for a follow-up.
- **No streaming.** The Side Panel polls every 1.5 s. For a real
  streaming experience, swap polling for an offscreen-document
  WebSocket bridge in a follow-up PR.
- **The Quick Send agent uses the configured `system.defaultModel`**.
  If your default has no provider key, replies won't come back. The
  side panel surfaces a timeout in that case.
