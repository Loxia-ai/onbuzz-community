# Onboarding — first-run flow

Goal: a fresh user goes from launching OnBuzz to sending their first message
in under 60 seconds.

## When it shows

`useOnboarding` (web-ui/src/hooks/useOnboarding.js) decides whether to mount
the wizard on every render. The wizard appears when **all** of these hold:

- `loxia-onboarding-complete` is **not** set in localStorage
- the session has zero agents (`appStore.agents.length === 0`)
- the user has **no** vendor key configured for any of openai, anthropic,
  gemini, xai (`loxia-settings.apiKeys`)

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
button that hits the provider's models endpoint directly from the browser:

| Provider  | Endpoint                                                          | Auth                                     |
| --------- | ----------------------------------------------------------------- | ---------------------------------------- |
| OpenAI    | `GET https://api.openai.com/v1/models`                            | `Authorization: Bearer <key>`            |
| Anthropic | `GET https://api.anthropic.com/v1/models`                         | `x-api-key`, plus the dangerous-direct-browser-access opt-in header |
| Gemini    | `GET https://generativelanguage.googleapis.com/v1beta/models?key=` | query param                              |
| xAI       | `GET https://api.x.ai/v1/models`                                  | `Authorization: Bearer <key>`            |

For Ollama we hit the local daemon at `<host>/api/tags` (default
`http://localhost:11434`). The host field is pre-filled and the
"connection test" lists installed models.

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

Model selection:

- **Cloud** — picks a balanced default from the model list returned by step
  2's connection test, using `pickDefaultModel()` (substring match against
  per-provider hints, then provider default, then first available).
- **Ollama** — uses the locally-installed model list. If none are present,
  the wizard refuses to create a broken agent and shows guidance to run
  `ollama pull <model>` (or the Settings → Ollama page).

After creation the wizard navigates to `/` (the chat view) and marks
onboarding complete.

## Persistence summary

| localStorage key                | Owner                    | When set                       |
| ------------------------------- | ------------------------ | ------------------------------ |
| `loxia-onboarding-complete`     | `useOnboarding`          | step 3 success                 |
| `loxia-settings.apiKeys.<id>`   | `StepConnect` (cloud)    | step 2 success                 |
| `loxia-ollama-settings`         | `StepConnect` (Ollama)   | step 2 success                 |

Custom DOM events (`apikey-updated`, `settings-updated`,
`onboarding-completed`) keep the rest of the app in sync without prop
drilling — same pattern the existing `AttentionRequiredModal` uses.

## Files

```
web-ui/src/components/onboarding/
  OnboardingFlow.jsx       # 3-step wizard container (modal)
  StepProvider.jsx         # tile picker
  StepConnect.jsx          # key input + test connection
  StepAgent.jsx            # default agent creation
  providers.js             # provider catalogue + browser test fns

web-ui/src/hooks/useOnboarding.js   # first-run detection + completion flag
web-ui/src/App.jsx                  # mounts OnboardingFlow, suppresses
                                    # AttentionRequiredModal while open
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
   `ollama pull llama3.1` snippet; primary button disabled.

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
- Ollama running but zero models → step 3 shows guidance banner; primary
  button disabled.

Skip path:

- Click the X in the header. Wizard closes. AttentionRequiredModal may
  surface for any remaining issues (privacy consent, etc.). On next reload
  the wizard reappears (because completion was not persisted).
