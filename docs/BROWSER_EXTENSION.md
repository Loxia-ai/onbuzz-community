# Send to OnBuzz — Chrome Extension (Side Panel)

A Manifest V3 Chrome extension that adds a **Send to OnBuzz agent**
right-click action and opens a Side Panel chat with your local OnBuzz
server. Highlight text on any web page, right-click, the Side Panel
opens with the selection staged, type an optional question, hit
**Send**, and the **Quick Send** agent answers.

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
6. OnBuzz validates the token, looks up an agent named **Quick Send**
   in the pool (creating it once on first use), and routes the message
   through the normal chat pipeline.
7. The Side Panel polls
   `GET /api/chat/quick-send/messages?agentId=...&since=N` until the
   assistant's reply lands, then renders it.

The extension is intentionally thin. It sends `selected_text`,
`source_url`, `page_title`, and an optional `user_message`. It does
**not** choose anything about the agent — capabilities, model, and
system prompt all live on the agent itself.

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
6. Click **Send** (or press Enter).
7. The assistant's reply appears below the user message. You can keep
   the conversation going by typing more questions in the same panel.
8. To start fresh with a new selection, highlight new text and
   right-click again. The Side Panel resets the staged selection but
   the agent's conversation history is preserved on the server — open
   the **Quick Send** agent in the OnBuzz web UI to clear it.

## Security model

- **Explicit user action only.** The extension never reads page text on
  its own. The context-menu entry only appears when text is selected,
  nothing is staged until you click it, and nothing is sent until you
  hit **Send** in the Side Panel.
- **Localhost only.** Manifest `host_permissions` are limited to
  `http://localhost/*` and `http://127.0.0.1/*`. The extension cannot
  reach any remote server.
- **Token-gated endpoint.** The rest of the OnBuzz local API is
  unauthenticated (intentional for a local-dev tool, with wildcard
  CORS). The quick-send endpoints require `X-OnBuzz-Token`, which a
  random web page does not have access to — the token is stored in
  the extension's per-extension storage. Treat the token like a
  password.
- **Rotate by deleting** `extension-token.json` (or unsetting the env
  var) and restarting OnBuzz; a new token is generated automatically.
  Re-paste it into the extension.
- **Don't send anything you wouldn't paste manually.** The same
  caveats that apply to copy/paste into a chat apply here.

## The Quick Send agent

Quick Send is a regular OnBuzz agent. The endpoint creates it the
first time a quick-send arrives, using:

- **Name**: `Quick Send`
- **System prompt**: "You are the OnBuzz Quick Send agent…" (a short
  prompt describing the chat-with-a-highlight role)
- **Model**: `system.defaultModel` (the model you picked during
  OnBuzz onboarding)
- **Capabilities**: `web`, `pdf`, `memory`, `skills`, `help`,
  `user-prompt`

After creation, the agent is yours to edit in the OnBuzz UI like any
other: change the model, edit the system prompt, toggle capabilities,
rename it if you want (the extension only looks it up by the exact
name `Quick Send`, so don't rename it if you want quick-sends to keep
landing here).

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Side Panel: "Could not reach OnBuzz." | Server isn't running, wrong server URL, or network blocked. | Start OnBuzz; verify the URL in Options matches the port the server logs at startup (look for `Web server initialized … url: http://...`). |
| Side Panel: "OnBuzz rejected the extension token." | The token in the extension doesn't match what the server expects. | Re-copy the token from `extension-token.json` (or the env var) into Options. |
| Side Panel: "Extension token is not set." | First-run state — you haven't filled in Options yet. | Follow **Configure** above. |
| Endpoint returns 503 "No default model is configured." | Onboarding wasn't completed; no model is set as the default. | Open OnBuzz Settings → Providers and pick a model. |
| Notification: "No text selected." | The context menu fired without an active selection (rare). | Re-highlight the text and try again. |
| Side Panel: "Timed out waiting for the agent reply." | The underlying model call is taking too long, or its provider has no key. | Open the Quick Send agent in the OnBuzz UI and confirm its model has a working provider. The poll timeout is 60s. |
| Side Panel opens with an empty state. | The selection wasn't captured (very long pages with dynamic text sometimes confuse the context-menu API). | Re-highlight a smaller chunk and try again. |

## File map (for reviewers)

- **Extension**: [`browser-extension/`](../browser-extension/)
  - `manifest.json` — MV3 + `sidePanel` + `contextMenus`/`storage`/`notifications`
  - `background.js` — service worker, context menu, staging, side-panel-open
  - `sidepanel.html`/`sidepanel.css`/`sidepanel.js` — the chat UI
  - `options.html`/`options.js` — server URL + token

- **Backend endpoints**:
  [`src/interfaces/webServer.js`](../src/interfaces/webServer.js)
  — `POST /api/chat/quick-send` and `GET /api/chat/quick-send/messages`,
  along with the agent seed and the broadcaster early-return that
  silences the WebSocket layer for the extension's REST-only session.

- **Token resolver**:
  [`src/services/extensionToken.js`](../src/services/extensionToken.js)
  — `ONBUZZ_EXTENSION_TOKEN` env first, otherwise reads or
  auto-generates `settings/extension-token.json` (mode 0600).
  Constant-time comparison on verify.

## Known limitations

- **Single rolling conversation.** All quick-sends accumulate in the
  Quick Send agent's one conversation. To start fresh, open the agent
  in the OnBuzz UI and clear its history.
- **No streaming.** The Side Panel polls every 1.5 s.
- **Microphone, reply-language picker, and quick-action chips** are
  client-side helpers in the side panel — they shape the question
  that gets sent, but the backend doesn't know about them.
- **Quick Send agent model.** Created with `system.defaultModel`. If
  the default model later changes, the Quick Send agent keeps the
  model it was created with — change it manually in the OnBuzz UI.
