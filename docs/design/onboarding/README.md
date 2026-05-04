# Onboarding — first-run flow

Goal: a fresh user goes from launching OnBuzz to sending their first message
in under 60 seconds.

## When it shows

`useOnboarding` (web-ui/src/hooks/useOnboarding.js) decides whether to mount
the wizard. **One source of truth**: the `loxia-onboarding-complete` flag in
localStorage. The hook computes a single derived expression:

```js
shouldShow = initialized && !dismissed
          && !flag
          && noAgents
          && noProvider
```

- `flag` is read straight from localStorage on every render via
  `useSyncExternalStore` — no mirrored React state, so cross-tab and
  same-tab writes can never get out of sync.
- `noAgents` comes from `appStore.agents.length === 0`.
- `noProvider` comes from `loxia-settings.apiKeys` (none of openai /
  anthropic / gemini / xai have a non-empty value).
- `dismissed` is per-session only (resets on reload) — when the user hits
  the skip button.

Once the wizard finishes, `loxia-onboarding-complete = "true"` is the
authoritative source for "this user has been onboarded". Removing keys or
agents later will **not** re-trigger the wizard — the existing
`AttentionRequiredModal` handles those reminders.

The wizard is mounted in `App.jsx` and renders above all other UI. While it
is on screen, the existing `AttentionRequiredModal` is suppressed so the
two never stack.

## The three steps

### 1. Pick a provider

Tile picker for OpenAI, Anthropic, Google Gemini, xAI, and Ollama. Each
tile carries a short blurb and a cost hint:

- **Local & free** (green) — Ollama
- **Paid by token** (neutral) — all cloud providers

Provider metadata lives in `web-ui/src/components/onboarding/providers.js`.

### 2. Add key / connect

For cloud providers we collect an API key and offer a **Test connection**
button, plus a small **Skip for now** link that hands off to step 3
unverified. (Ollama already skips key entry by definition — the link is
not shown there to avoid double-skipping.) The button POSTs to the new
backend endpoint, which calls the provider's models endpoint server-side
and returns a uniform shape:

```
POST /api/providers/test
  body: { provider, apiKey?, host? }
  200 → { ok: true,  models: string[] }
       | { ok: false, message: string }
```

Implementation: `src/services/providerTester.js`. Routes used server-side:

| Provider  | Endpoint                                                          | Auth                                     |
| --------- | ----------------------------------------------------------------- | ---------------------------------------- |
| OpenAI    | `GET https://api.openai.com/v1/models`                            | `Authorization: Bearer <key>`            |
| Anthropic | `GET https://api.anthropic.com/v1/models`                         | `x-api-key` + `anthropic-version`        |
| Gemini    | `GET https://generativelanguage.googleapis.com/v1beta/models?key=` | query param                              |
| xAI       | `GET https://api.x.ai/v1/models`                                  | `Authorization: Bearer <key>`            |
| Ollama    | `GET <host>/api/tags`                                             | none                                     |

Why server-side?
- No CORS quirks to manage per provider (Anthropic in particular requires
  an opt-in header for browser calls).
- Keys never traverse the user's browser → `api.x.ai` etc. directly; they
  only ever go to the local backend.
- Network timeouts and friendly error messages are owned by one module.

The frontend uses an incrementing **request id** so a stale in-flight test
can never overwrite a fresh result if the user retypes their key fast.
Editing the key/host after a successful test re-disables Continue —
"verified" only counts for the exact value tested.

On success the key/host is persisted in two places:

1. `localStorage` (`loxia-settings` for cloud, `loxia-ollama-settings` for
   Ollama) — same shape as the rest of the app expects, so the existing
   "Provider key missing" issue goes away automatically.
2. The backend session via `api.setApiKeys` / `api.updateOllamaSettings` —
   so the AIService can use the key immediately without a reload.

Failures show an inline message (HTTP 401/403, 429, network error,
unreachable Ollama, etc.) and do not advance.

### 3. Create first agent

Creates a single agent named **General Assistant** with a short
"helpful assistant" system prompt and an empty capability set (matches the
existing `createAgent` defaults — the user can opt into tools later from
the agent edit modal).

Step 3 picks one of four sub-states based on `providerId`,
`providerModels`, `connectionSkipped`, and the live Ollama probe:

| `connectionSkipped` | Ollama state                | UI                                                           | Primary button                          |
| ------------------- | --------------------------- | ------------------------------------------------------------ | --------------------------------------- |
| false               | n/a (cloud key verified)    | Cloud model picker, balanced default pre-selected            | **Create agent and start chatting**     |
| false               | Ollama chosen, models OK    | Local model picker                                           | **Create agent and start chatting**     |
| false               | Ollama chosen, no models    | Pull guidance + "I installed a model" refresh                | disabled until refresh succeeds         |
| true                | Ollama reachable + models   | Cloud-skipped info banner, Ollama model picker               | **Create agent and start chatting**     |
| true                | Ollama reachable, no models | Amber panel with `ollama pull qwen2.5:1.5b` + refresh        | **Finish without an agent** (enabled)   |
| true                | Ollama unreachable          | Amber panel: "Ollama is not running…" + "Re-check Ollama"    | **Finish without an agent** (enabled)   |

The "skip → finish without an agent" exit completes onboarding (sets
`loxia-onboarding-complete = true`) without calling `createAgent`. The
user lands on the chat view; the existing `AttentionRequiredModal` then
surfaces the "Provider key missing" reminder, and the user can add a key
from Settings whenever they're ready.

Model resolution (when an agent IS being created):

- **Cloud** — picks a balanced default from the model list returned by step
  2's connection test, using `pickDefaultModel()` (substring match against
  per-provider hints, then provider default, then first available).
- **Ollama** — uses the locally-installed model list, defaulting to the
  first one found.

After creation (or finish-without-agent) the wizard navigates to `/` (the
chat view) and marks onboarding complete.

## Persistence summary

| localStorage key                | Owner                                | When set                                  |
| ------------------------------- | ------------------------------------ | ----------------------------------------- |
| `loxia-onboarding-complete`     | `useOnboarding`                      | step 3 success                            |
| `loxia-settings.apiKeys.<id>`   | `StepConnect` (cloud)                | step 2 success                            |
| `loxia-ollama-settings`         | `StepConnect` (Ollama)               | step 2 success                            |
| `loxia-provider-key-skipped`    | `utils/providerKeySkip.js` (shared)  | onboarding skip path **or** modal skip   |

Custom DOM events (`apikey-updated`, `settings-updated`,
`onboarding-completed`) keep the rest of the app in sync without prop
drilling — same pattern the existing `AttentionRequiredModal` uses.

## Files

```
web-ui/src/components/onboarding/
  OnboardingFlow.jsx       # 3-step wizard container (modal)
  StepProvider.jsx         # tile picker
  StepConnect.jsx          # key input + test connection (calls backend)
  StepAgent.jsx            # default agent creation + Ollama refresh
  providers.js             # provider catalogue + pickDefaultModel()

web-ui/src/hooks/useOnboarding.js   # first-run detection (single-source)
web-ui/src/services/api.js          # adds api.testProviderConnection()
web-ui/src/App.jsx                  # mounts OnboardingFlow, suppresses
                                    # AttentionRequiredModal while open

src/services/providerTester.js      # backend test logic (timeouts,
                                    # error mapping, model extraction)
src/interfaces/webServer.js         # POST /api/providers/test route
```

## Wireframe / screenshot notes

Screenshots aren't checked in yet. To capture them, with a clean
localStorage:

1. **Step 1** — Hero header ("Welcome to OnBuzz Community"), 3-pill
   progress, 5 provider tiles in a 2-column grid. Selected tile gets a
   filled checkmark + accent border.
2. **Step 2 (cloud)** — Single password-style input with show/hide eye,
   "Need a key? Open the …" link, "Test connection" secondary button, and
   a green/red banner once tested. Continue is disabled until the test
   passes.
3. **Step 2 (Ollama)** — Same layout but with a host text field instead of
   the key input.
4. **Step 3 (cloud)** — General Assistant card on top, model dropdown
   pre-selected with the balanced default, "Create agent and start
   chatting" primary button.
5. **Step 3 (Ollama, no models)** — Amber guidance banner with the
   `ollama pull qwen2.5:1.5b` snippet and an "I installed a model" refresh
   button; primary button disabled until a model is detected.

Capture each at 1280×800 light + dark themes for the design board.

## Manual test plan

Fresh-install path:

1. Clear `loxia-onboarding-complete`, `loxia-settings`,
   `loxia-ollama-settings` from devtools → Application → Local Storage.
   Reload.
2. Confirm the **Welcome to OnBuzz Community** modal appears (and the
   AttentionRequiredModal does not).
3. Pick **OpenAI**, paste a real key, click **Test connection** → success
   banner with model count. Continue.
4. Confirm step 3 has a model preselected (e.g. `gpt-4o-mini`). Click
   **Create agent and start chatting**. Wizard closes, you land on `/`,
   the General Assistant is the active agent, and a chat composer is
   ready.
5. Reload — wizard should not reappear, and "Provider key missing" should
   not appear either.

Failure paths:

- Bad cloud key → red banner reading "… rejected the key. Check the key
  and try again." Continue stays disabled.
- Network down → "We could not reach this provider. Check your network and
  try again."
- Ollama not running → "We could not reach Ollama. Make sure it is running
  on this machine."
- Ollama running but zero models → step 3 shows guidance banner with
  pull command and "I installed a model" refresh button; primary button
  disabled until refresh detects a model.

Edge cases:

- **Switch provider mid-flow** — go to step 1, pick OpenAI, advance to
  step 2 with a passing test. Hit Back, pick Anthropic. Step 2 wipes the
  prior key + test result; step 3's `providerModels` is also cleared so
  no stale OpenAI models leak in.
- **Edit key after success** — the green "Connection test passed" banner
  clears the moment the user types in the field, and Continue re-disables.
- **Spam the test button** — only the latest test's response is honoured;
  earlier responses (whether they would have passed or failed) are
  dropped via a request-id check.
- **Skip for now (cloud)** — sets `connectionSkipped = true` in the
  wizard. Step 3 falls back to Ollama if reachable + has models;
  otherwise shows a finish-without-agent exit so the path never
  dead-ends. Switching providers on step 1 clears `connectionSkipped`
  so each new provider gets a fresh chance. When the wizard finishes
  on the skip path it also writes `loxia-provider-key-skipped = true`
  via `utils/providerKeySkip.js` so the post-onboarding
  `AttentionRequiredModal` does not re-prompt for the same thing.

## Consistent skip across the app

Skipping is a single concept with one persistent flag
(`loxia-provider-key-skipped`) and one shared module
(`web-ui/src/utils/providerKeySkip.js`):

| Where the user skips                | What gets called          | Effect                                                        |
| ----------------------------------- | ------------------------- | ------------------------------------------------------------- |
| Onboarding step 2 → step 3 finishes | `skipProviderKey()`       | Sets the flag and dispatches `apikey-updated` so other UI recomputes. |
| AttentionRequiredModal — Skip btn   | `skipProviderKey()`       | Same flag, same event. Modal closes via `onResolve`.         |
| Adding a real key later             | `localStorage.apiKeys.x`  | Existing path — `checkApiKeyConfigured()` returns true and the modal stops bothering the user regardless of the flag. |

`useAttentionRequired` reads `isProviderKeySkipped()` when computing
issues — when the flag is set the API_KEY_MISSING issue is excluded
entirely, so the modal never re-opens for that reason.

Skip path:

- Click the X in the header. Wizard closes. AttentionRequiredModal may
  surface for any remaining issues (privacy consent, etc.). On next reload
  the wizard reappears (because completion was not persisted).
