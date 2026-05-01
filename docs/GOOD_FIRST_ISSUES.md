# Good first issues

Real, scoped pieces of work for first-time contributors. Each one is small enough to land in a single sitting, with clear file pointers and acceptance criteria. Pick one, comment on the matching GitHub issue with "I'd like to take this", and we'll help you get it merged.

If you want something here turned into an actual filed issue (so you can be assigned to it), open a [contribution idea](https://github.com/Loxia-ai/onbuzz-community/issues/new?template=contribution_idea.yml) and we'll tag it `good first issue`.

---

## 🥇 Tier 1 — pick this if it's your first PR

### 1. Update CLI prompt: `loxia:no-agent>` → `onbuzz:no-agent>`

The readline CLI still prints the legacy `loxia:` prefix on the prompt. It's the last unconverted brand string. Change it everywhere it appears.

- **Files:** [`src/interfaces/cli.js`](../src/interfaces/cli.js), grep for `loxia:`
- **Acceptance:** running `node bin/cli.js` shows `onbuzz:no-agent>` and `onbuzz:<agent-name>>`. Tests still pass.
- **Estimated effort:** 15 minutes.

### 2. Migrate `localStorage` keys from `loxia-*` to `onbuzz-*`

The web UI still writes settings/consent/streaming-enabled state under `loxia-settings`, `loxia-analytics-consent`, `loxia-streaming-enabled`. New users see no problem; existing users carry forward stale prefixes. Do a one-time migration on app boot (read the old key, write the new, delete the old) and switch all reads/writes to the new prefix.

- **Files:** `web-ui/src/stores/appStore.js`, `web-ui/src/hooks/useConsent.js`, `web-ui/src/components/Settings.jsx`. Grep `loxia-` across `web-ui/src`.
- **Acceptance:** New installs use `onbuzz-*` keys exclusively. Upgrade path tested with a fixture localStorage object. The `loxia-*` keys are removed after migration.
- **Estimated effort:** 1–2 hours.

### 3. Strip the dead `ConsentDialog` Microsoft Clarity flow

We removed all telemetry from OnBuzz Community, but the consent dialog still asks the user to pick between "Decline / Basic / Full Analytics". Since there's no analytics anymore, this dialog should either be removed entirely or replaced with a simple license/welcome dialog that auto-resolves on first launch.

- **Files:** [`web-ui/src/components/ConsentDialog.jsx`](../web-ui/src/components/ConsentDialog.jsx), [`web-ui/src/hooks/useConsent.js`](../web-ui/src/hooks/useConsent.js), [`web-ui/src/utils/clarity.js`](../web-ui/src/utils/clarity.js)
- **Acceptance:** First-launch UX no longer asks about analytics. The `useAttentionRequired` hook's `PRIVACY_CONSENT` issue type is removed (or simplified to a no-op).
- **Estimated effort:** 1 hour.

---

## 🥈 Tier 2 — small features, well-scoped

### 4. Add a "Test connection" button per provider in Settings

Each provider key field in Settings has no way to verify the key works without creating an agent and sending a message. Add a small "Test" button that calls the provider's `isAvailable()` (which already does a lightweight check) and shows ✅ / ❌ next to the field.

- **Files:** [`web-ui/src/components/Settings.jsx`](../web-ui/src/components/Settings.jsx), [`src/interfaces/webServer.js`](../src/interfaces/webServer.js) (new endpoint, e.g. `POST /api/keys/test`).
- **Acceptance:** Click "Test" with a wrong key → red X with the provider's error message. Right key → green check. Loading spinner while in flight.
- **Estimated effort:** 2–3 hours.

### 5. Surface provider name in the agent model picker

When an agent's model is just listed by name (`gpt-4o`, `claude-opus-4-7`), it's not obvious which key it'll use. Add a small badge next to each model showing the provider id (`openai`, `anthropic`, `gemini`, `xai`, `ollama`).

- **Files:** [`web-ui/src/components/AgentCreationModal.jsx`](../web-ui/src/components/AgentCreationModal.jsx), [`web-ui/src/components/AgentEditModal.jsx`](../web-ui/src/components/AgentEditModal.jsx).
- **Acceptance:** Picker rows show `gpt-4o` ▸ small `OpenAI` chip. Filtering still works.
- **Estimated effort:** 1–2 hours.

### 6. Auto-refresh the model catalog when keys change

Right now adding a provider key in Settings doesn't immediately repopulate the model catalog — the user has to restart, or wait for the next refresh interval. The wiring is mostly there: `apiKeyManager` notifies aiService, aiService can call `modelsService.refresh()`. Add the call.

- **Files:** [`src/services/aiService.js`](../src/services/aiService.js) (the `setApiKeyManager` flow), [`src/interfaces/webServer.js`](../src/interfaces/webServer.js) `POST /api/keys` route already calls `modelsService.refresh()` — verify it actually refreshes and fix if not.
- **Acceptance:** Save a Gemini key → catalog endpoint immediately includes Gemini's live models without restarting the server.
- **Estimated effort:** 1 hour.

---

## 🥉 Tier 3 — meatier, but doable in a couple of evenings

### 7. Better Gemini rate-limit handling (queue + backoff)

Free-tier Gemini hits 429 fast. Today the request just times out at the AbortController. Add retry-with-exponential-backoff in [`geminiProvider.js`](../src/services/providers/geminiProvider.js) for 429s — respect `Retry-After` if present, cap retries at 3, give up cleanly if still rate-limited.

- **Files:** [`src/services/providers/geminiProvider.js`](../src/services/providers/geminiProvider.js).
- **Acceptance:** 429 responses are retried (test via mocked fetch). Logs show retry count + final outcome. No retry storm on persistent failures.
- **Estimated effort:** 3–4 hours including tests.

### 8. Native DeepSeek provider

DeepSeek's API is OpenAI-compatible. Today users can reach it via a custom endpoint, but it doesn't auto-classify chat models or appear cleanly in the picker. Add `src/services/providers/deepseekProvider.js` — extend `OpenAIProvider` with a different `baseUrl`, `id`, and `matchesModel` for `deepseek-*`.

- **Files:** new `src/services/providers/deepseekProvider.js`, register in [`src/services/providers/index.js`](../src/services/providers/index.js), update [`docs/PROVIDERS.md`](./PROVIDERS.md).
- **Acceptance:** Set a `DEEPSEEK_API_KEY`, model picker shows DeepSeek models, sending a message to `deepseek-chat` works end-to-end. Contract tests in `providers.contract.test.js`.
- **Estimated effort:** 4–6 hours.

### 9. Responses API support for `gpt-5-pro` / `o1-pro` / etc.

OpenAI's reasoning-pro models (`gpt-5-pro`, `o1-pro`, `o3-pro`, `gpt-5-codex`) are served exclusively by `/v1/responses`, not `/v1/chat/completions`. Today they're filtered out via `chat: false` in the classifier. A real fix is to add a Responses-API code path in `OpenAIProvider` and flip them back to `chat: true`.

- **Files:** [`src/services/providers/openaiProvider.js`](../src/services/providers/openaiProvider.js), tests.
- **Acceptance:** Sending to `gpt-5-pro` works (live test with a real key). Both streaming and non-streaming paths handled. The `_classifyOpenAIModel` no longer marks `*-pro` as responses-only.
- **Estimated effort:** 1–2 days. **This one needs a design comment first** — open a contribution idea before starting.

---

## How to claim one

1. Comment on the linked issue (or the corresponding [contribution idea](https://github.com/Loxia-ai/onbuzz-community/issues/new?template=contribution_idea.yml) if no issue exists yet) with "I'd like to take this".
2. We'll assign it to you so others know it's in progress.
3. If you get stuck or change your mind, no judgement — just leave a comment and we'll free it up for someone else.

If none of these fit and you want to suggest something different, file a [contribution idea](https://github.com/Loxia-ai/onbuzz-community/issues/new?template=contribution_idea.yml).
