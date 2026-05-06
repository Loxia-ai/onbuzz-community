# OnBuzz Community Development Program

A 12-week structured program of fully-specified contribution tasks. Every task
has a description, a definition of done, and (where applicable) a list of
deliverables. Pick one, comment on its issue with "I'd like to take this", and
ship it.

---

## How tasks are structured

Every task in this document follows the same shape:

> **Track:** which audience this fits (developer / designer / writer / etc.)
> **Difficulty:** 🟢 easy / 🟡 moderate / 🔴 challenging — calibrated within the track
> **Time:** typical hours of focused work
>
> **Context.** Why this task exists. The current state of the world.
>
> **What to do.** Step-by-step or paragraph description of the work.
>
> **Definition of done.** Checkable acceptance criteria. The PR/contribution is
> mergeable when every item is true.
>
> **Deliverables.** Concrete artifacts the contributor produces (files, screenshots,
> recordings, documents).
>
> **Pointers.** File paths, related code, references to existing work.

If anything in a task is ambiguous to you, that's a doc bug — open the issue, ask,
and we'll either clarify here or rewrite the task.

---

## Audience tracks

Each task is labeled with one or more tracks so you can filter to your area:

| Track | What you'll typically do |
|---|---|
| **dev** — Developer (JS/Node, React) | Write features, fix bugs, refactor |
| **design** — Designer / UX | Wireframes, UI components, themes, onboarding flows |
| **writer** — Technical writer | Tutorials, guides, inline documentation |
| **qa** — QA / Test engineer | Tests, test infrastructure, coverage |
| **security** — Security researcher | Audits, hardening, vulnerability research |
| **devops** — DevOps / SRE | Docker, CI/CD, observability, performance profiling |
| **datasci** — Data scientist | Benchmarks, model evals, manifest curation |
| **i18n** — Localization | UI translations, locale-aware formatting |
| **devrel** — Community / DevRel | Demos, videos, social content, blog posts |
| **a11y** — Accessibility advocate | WCAG audits, keyboard nav, screen-reader fixes |
| **visual** — Visual designer | Logos, mascots, demo GIFs, screenshots |
| **domain** — Domain expert | Skills, recipes, prompt libraries for your profession |

Most tasks are single-track. Capstones are usually multi-track (a designer +
developer + writer working together).

---

## Recognition

- **Contributor list** — every PR-merged contributor on the README.
- **Track badges** — three landed tasks in a track ⇒ recognized contributor in that track on `CONTRIBUTORS.md`.
- **Monthly highlights** — three featured contributors per month in our changelog post.
- **Hall of fame** — capstone shippers and 10+ task veterans on the docs site.

No leaderboards, no points, no swag, no marketing-funnel mechanics.

---

# MONTH 1 — FOUNDATIONS

The goal of month 1 is **breadth of participation**. Tasks are calibrated so a
new contributor in any track can land their first PR.

---

## Week 1 — Onboarding & First Wins

The first 60 seconds determine whether a new user keeps using the product. This
week is about polishing that path, plus retiring the most visible legacy
brand-leftovers.

### Capstone — Redesign the first-run onboarding flow

> **Track:** design + dev + writer
> **Difficulty:** 🟡 moderate
> **Time:** 12–16 hours total across collaborators

**Context.** Today, a fresh user lands on the chat page, sees `Provider key
missing`, and has to figure out the rest themselves. There's no welcome screen,
no provider picker, no validation of the key they paste, and no first-agent
helper. We need a guided flow that ends with "you've sent your first message" in
under 60 seconds.

**What to do.**
1. **Designer:** wireframe a 3-step onboarding flow:
   - *Step 1:* "Pick a provider" — five tiles (OpenAI / Anthropic / Gemini / xAI / Ollama). Each tile has a one-line description and a cost framing ("local & free", "paid by the token", etc.).
   - *Step 2:* "Add your key" — provider-specific input field, "Test connection" button that hits the provider's `/v1/models` endpoint.
   - *Step 3:* "Create your first agent" — pre-filled with a sensible default (a "general assistant" agent on a balanced model).
   Sketch in Figma / Excalidraw / pen-and-paper. Post the wireframe to a draft PR or issue comment for feedback.
2. **Developer:** implement the flow as a sequence of modals (or as a dedicated `/onboarding` route — designer decides). The flow only fires on first launch (when no agents exist and no provider key is configured).
3. **Writer:** copy for every screen — the tile descriptions, the "test passed/failed" microcopy, the final "you're ready" screen. Tone: warm, brief, no exclamation marks.

**Definition of done.**
- [ ] On a fresh install (no `~/.local/share/onbuzz/` or platform equivalent), opening the web UI shows the onboarding flow within 1 second of load.
- [ ] All five providers are pickable. Picking Ollama skips the API-key step entirely (no key needed).
- [ ] "Test connection" actually pings the provider's `/v1/models` (or equivalent) and shows ✅ / ❌ with a meaningful error message on failure.
- [ ] "Create your first agent" creates a real, working agent and lands the user in the chat surface with that agent active.
- [ ] After completing the flow once, the user never sees it again on subsequent launches.
- [ ] The "Provider key missing" sidebar warning is removed from the post-onboarding state — that warning was an apology for the missing flow.
- [ ] No console errors. No broken back-button behavior.

**Deliverables.**
- 1 PR with the onboarding components and route wiring (developer)
- Wireframe images committed under `docs/design/onboarding/` (designer)
- Final copy committed alongside the components (writer)
- Before/after screenshots in the PR description showing the flow

**Pointers.** Today's "attention required" modal lives at `web-ui/src/components/AttentionRequiredModal.jsx` — the provider-key step there is the closest existing precedent. The agent creation modal is at `web-ui/src/components/AgentCreationModal.jsx`. App initialization is in `web-ui/src/App.jsx`.

---

### Daily — Rebrand the CLI prompt to `onbuzz:no-agent>`

> **Track:** dev
> **Difficulty:** 🟢 easy
> **Time:** 15–30 minutes

**Context.** When you run `node bin/cli.js`, the readline prompt still prints
the legacy `loxia:no-agent>` and `loxia:<agent-name>>`. It's the last
unconverted brand string in the runtime.

**What to do.** Find every place the CLI prompt is constructed and replace
`loxia:` with `onbuzz:`.

**Definition of done.**
- [ ] `node bin/cli.js` shows `onbuzz:no-agent>` at startup.
- [ ] Switching to an agent named `coder` shows `onbuzz:coder>`.
- [ ] No remaining `loxia:` strings in `src/interfaces/cli.js`.
- [ ] `npm test` still passes.

**Deliverables.** One PR. A before/after screenshot of the prompt is welcome but not required.

**Pointers.** Start with `grep -n "loxia:" src/interfaces/cli.js`. The prompt is built in the readline loop — usually a single template-string concatenation.

---

### Daily — Migrate `localStorage` keys from `loxia-*` to `onbuzz-*`

> **Track:** dev
> **Difficulty:** 🟡 moderate
> **Time:** 1–2 hours

**Context.** The web UI still writes settings, consent, and streaming-flag state under `loxia-settings`, `loxia-analytics-consent`, `loxia-streaming-enabled`. New users see no problem; users upgrading from a beta build carry forward stale prefixes.

**What to do.**
1. Add a one-time migration function that runs on app boot (in `appStore.js`'s initialize sequence): for each `loxia-*` key in localStorage, copy its value to the equivalent `onbuzz-*` key, then delete the original.
2. Switch all *new* reads/writes in the codebase to use the `onbuzz-*` prefix.
3. Run the migration only once per browser — guard with an `onbuzz-migration-v1` flag in localStorage.

**Definition of done.**
- [ ] Fresh installs use `onbuzz-*` keys exclusively from the first launch.
- [ ] Existing users with `loxia-settings` stored have it copied to `onbuzz-settings` on first boot of the new build, and the old `loxia-settings` is removed.
- [ ] No reads or writes to `loxia-*` keys remain in `web-ui/src/` (verify with `grep`).
- [ ] A unit test exercises the migration: pre-populate a fake localStorage with `loxia-settings`, run the migration, assert `onbuzz-settings` exists with the same value and `loxia-settings` is gone.

**Deliverables.** One PR. Verify the test passes.

**Pointers.** `grep -rn "loxia-" web-ui/src` will find every site. Likely files: `web-ui/src/stores/appStore.js`, `web-ui/src/hooks/useConsent.js`, `web-ui/src/components/Settings.jsx`.

---

### Daily — Record a 90-second "what is OnBuzz" demo GIF for the README

> **Track:** devrel + visual
> **Difficulty:** 🟢 easy
> **Time:** 1–2 hours

**Context.** The README opens with text. A short looping demo GIF at the top would do more for first-time visitors than three paragraphs of copy.

**What to do.**
1. Set up OnBuzz with a fast-responding model (Claude Haiku or Gemini Flash).
2. Record a screen capture showing: web UI opens → create an agent named "Researcher" → send "summarize the README of this repository" → watch it stream → final response. Keep it under 90 seconds.
3. Convert to an optimized GIF (≤ 5 MB). Tools: ScreenToGif (Windows), Kap (Mac), peek (Linux), or `ffmpeg + gifski` for any platform.
4. Commit to `docs/assets/demo.gif` and reference it at the top of `README.md`.

**Definition of done.**
- [ ] GIF exists at `docs/assets/demo.gif`, ≤ 5 MB.
- [ ] Loops cleanly without an obvious cut.
- [ ] Embedded near the top of the README, above or just below the title.
- [ ] No personal information visible in the recording (close other tabs, hide bookmarks, generic agent name).

**Deliverables.** One PR with the GIF + README change.

**Pointers.** Don't overthink quality — clean, readable, short. If the agent's response would be long, ask a question with a short answer.

---

## Week 2 — Documentation

Docs are the difference between "tried it once" and "uses it daily". Week 2
fills the most-requested gaps.

### Capstone — "Build X with OnBuzz" tutorial series (3 tutorials)

> **Track:** writer + dev
> **Difficulty:** 🟡 moderate
> **Time:** 12–18 hours total (4–6 hours per tutorial)

**Context.** New users repeatedly ask "what should I actually build with this?". One-line examples don't help; people need a complete, runnable, end-to-end tutorial that takes them from setup to "look what I made". Ship three, each targeting a different audience so we don't over-index on developers.

**What to do.** Write three tutorials, each ~1500 words, each with runnable code/configs:

1. **For developers — "Build a code-review agent for your repo".** The agent reads a `git diff`, summarizes changes, flags concerns, and writes a review comment. Uses the terminal, filesystem, and seek tools.
2. **For writers — "Build a research assistant that cites its sources".** The agent reads URLs you paste, takes notes with attribution, and writes summaries with footnoted citations. Uses the web tool.
3. **For domain users — "Build a meeting-prep assistant".** The agent takes meeting attendees + topic, drafts an agenda, prepares talking points, and after the meeting takes your bullet notes and produces a follow-up email. Mostly uses the chat, no special tools.

Each tutorial follows the same structure:
- "What you'll build" with a final-output screenshot
- Prerequisites (OnBuzz installed, provider key configured)
- Step-by-step walkthrough with screenshots at every stage
- Full system prompt as a code block (copy-pasteable)
- "Try it yourself" exercises at the end

**Definition of done.**
- [ ] Three markdown files under `docs/tutorials/`: `code-review-agent.md`, `research-assistant.md`, `meeting-prep-assistant.md`.
- [ ] Each tutorial walks a fresh user from "no agent" to "working agent" without any assumed knowledge beyond the README.
- [ ] System prompts are reproducible — pasting them into a fresh agent produces the behavior described.
- [ ] Each tutorial has at least 4 inline screenshots, stored under `docs/tutorials/img/`.
- [ ] Linked from the README's "Example use cases" section.

**Deliverables.**
- 3 markdown tutorials
- Screenshots in `docs/tutorials/img/`
- README updated to link them

**Pointers.** Use the tools the user already has. Don't introduce new product features inside a tutorial — that's a feature PR. Tutorials should work on the current stable release.

---

### Daily — Document each agent tool's parameters with examples

> **Track:** writer
> **Difficulty:** 🟡 moderate
> **Time:** 2–3 hours

**Context.** The agent tools (terminal, filesystem, web, seek, etc.) have parameter schemas defined in code (`src/tools/openaiFunctionSchemas.js`) and JSDoc in their tool files. There's no human-readable reference of what each tool accepts and produces. Users debugging "why didn't my agent do X?" have to read source.

**What to do.**
1. Read `src/tools/openaiFunctionSchemas.js` and the relevant `src/tools/<name>Tool.js` for each tool.
2. Pick **5 tools** to document in this task: `terminal`, `filesystem`, `web`, `seek`, and `taskmanager`. (Other tools become future tasks.)
3. For each, write a section in a new `docs/TOOL_REFERENCE.md` containing:
   - One-paragraph description of what the tool does
   - Parameters table (name, type, required/optional, description)
   - 2 example invocations (the JSON the LLM would emit)
   - Expected output shape
   - Common failure modes ("if you pass X, you get Y error")

**Definition of done.**
- [ ] `docs/TOOL_REFERENCE.md` exists with sections for all 5 tools listed above.
- [ ] Each section includes parameters, ≥2 examples, output shape, and ≥2 failure modes.
- [ ] No copy-pasted JSDoc — paraphrase into human English.
- [ ] Linked from `README.md` and `CONTRIBUTING.md`.

**Deliverables.** One markdown file (`docs/TOOL_REFERENCE.md`) + README/CONTRIBUTING updates.

**Pointers.** The schemas are in `src/tools/openaiFunctionSchemas.js`. Each tool's actual implementation in `src/tools/*.js` has the truth about edge cases.

---

### Daily — Add a "What this page covers" sidebar to one provider doc

> **Track:** writer
> **Difficulty:** 🟢 easy
> **Time:** 30–60 minutes

**Context.** [`docs/PROVIDERS.md`](./PROVIDERS.md) is dense. New readers have to scroll to figure out whether the page even covers their provider. A short "what's in here" callout at the top helps.

**What to do.** At the top of `docs/PROVIDERS.md`, add a callout box (markdown blockquote with bold headings) listing:
- Which providers are covered (OpenAI, Anthropic, Gemini, xAI, Ollama, custom OpenAI-compatible)
- What each section explains (auth setup, model coverage, vendor quirks)
- Where to file an issue if your provider isn't covered

**Definition of done.**
- [ ] Callout sits between the H1 title and the "How dispatch works" section.
- [ ] All 6 provider categories are named.
- [ ] Doc still renders cleanly in GitHub's markdown preview.

**Deliverables.** One small PR editing `docs/PROVIDERS.md`.

---

## Week 3 — Provider polish

A platform is only as good as the providers it speaks to fluently. Week 3
expands coverage, fixes vendor-specific quirks, and improves the catalog UX.

### Capstone — Add a sixth native provider (DeepSeek)

> **Track:** dev + writer
> **Difficulty:** 🟡 moderate
> **Time:** 6–10 hours

**Context.** Today we ship 5 native providers (OpenAI, Anthropic, Gemini, xAI,
Ollama). Users can reach DeepSeek via the OpenAI-compatible custom-endpoint
path, but it doesn't auto-classify chat models, doesn't appear cleanly in the
picker, and doesn't get vendor-specific defaults. A first-class adapter changes
that.

**What to do.**
1. Create `src/services/providers/deepseekProvider.js`. Extend `OpenAIProvider` (DeepSeek's API is OpenAI-compatible). Override:
   - `id` → `'deepseek'`
   - `displayName` → `'DeepSeek'`
   - `baseUrl` default → `https://api.deepseek.com`
   - `matchesModel` → matches `deepseek-*` model names
   - Override `_isOpenAIReasoningModel` to return `true` for `deepseek-r1*` and `deepseek-reasoner*` models
2. Register in `src/services/providers/index.js`'s `ProviderRegistry` constructor.
3. Add a `DEEPSEEK_API_KEY` env var mapping in `src/utilities/configManager.js`.
4. Add the four most-current DeepSeek chat models to `config/models.default.json`.
5. Add 4–5 contract tests in `src/services/providers/__tests__/providers.contract.test.js`: matcher coverage, reasoning-model classification, body shape with tools.
6. Add a "DeepSeek" section to `docs/PROVIDERS.md`: how to get a key, what models work, what reasoning constraints apply.
7. Add a DeepSeek key field to the Settings UI's provider list.

**Definition of done.**
- [ ] With a `DEEPSEEK_API_KEY` set (or pasted in Settings), `/api/llm/models?chat=true` returns DeepSeek models.
- [ ] Sending a chat to `deepseek-chat` succeeds end-to-end (round-trip tested live).
- [ ] Sending a chat to `deepseek-r1` (or current DeepSeek reasoning model) succeeds with no `temperature` parameter sent (reasoning constraint respected).
- [ ] `docs/PROVIDERS.md` has a DeepSeek section.
- [ ] All new contract tests pass.
- [ ] Settings UI shows a DeepSeek key field and saves correctly.

**Deliverables.**
- 1 PR with new provider, registry registration, manifest entries, tests
- `docs/PROVIDERS.md` updated
- Settings UI updated
- Live test evidence in the PR description (redacted screenshots/curl output)

**Pointers.** `src/services/providers/xaiProvider.js` is the closest existing precedent — it's exactly this pattern (extend OpenAI with different baseUrl + model matcher).

---

### Daily — "Test connection" button per provider in Settings

> **Track:** dev
> **Difficulty:** 🟡 moderate
> **Time:** 2–3 hours

**Context.** Today there's no way to verify a saved provider key works without creating an agent and trying. Wrong keys produce confusing errors during chat. A small "Test" button next to each provider key field would catch the problem at config time.

**What to do.**
1. Add a `POST /api/keys/test` endpoint in `src/interfaces/webServer.js`. Body: `{ provider: 'openai' }`. The handler resolves the provider from the registry, calls its `isAvailable()`, and returns `{ ok: true }` or `{ ok: false, error: '...' }`.
2. In `web-ui/src/components/Settings.jsx`, add a small "Test" button next to each provider key input. On click: POST to the new endpoint, show a spinner while in flight, then green ✅ or red ❌ next to the field with the error message on hover.
3. After 5 seconds the indicator fades to neutral so it doesn't sit there forever.

**Definition of done.**
- [ ] Endpoint returns `{ ok: true }` for a real key, `{ ok: false, error: <vendor's error message> }` for a wrong key.
- [ ] UI button sits next to each provider field (4 fields: openai/anthropic/gemini/xai). Ollama also gets one (uses `isAvailable()` which pings the daemon).
- [ ] Loading spinner during the in-flight test (≤2 seconds typically).
- [ ] Result indicator fades after 5 seconds.
- [ ] Hovering on a failed-test indicator shows the vendor's error message in a tooltip.
- [ ] No console errors when the test fails.

**Deliverables.** One PR. Screenshots of all three states (idle / loading / success / failure) in the PR description.

**Pointers.** Each provider already has `isAvailable()`. The Settings file is `web-ui/src/components/Settings.jsx`.

---

### Daily — Provider badge in the agent model picker

> **Track:** dev + design
> **Difficulty:** 🟢 easy
> **Time:** 1–2 hours

**Context.** When a user picks `gpt-4o` for an agent, it's not visually obvious which provider key will be used. Adding a small provider chip next to the model name removes that ambiguity.

**What to do.** In the agent creation and edit modals, render a small chip after each model name showing the provider id (`OpenAI`, `Anthropic`, `Gemini`, `xAI`, `Ollama`, custom endpoint name). Style: rounded pill, neutral background, 11px text, provider-specific accent border (subtle).

**Definition of done.**
- [ ] Every model row in `AgentCreationModal.jsx` and `AgentEditModal.jsx` shows the provider chip.
- [ ] Chip appears after the model display name, vertically centered.
- [ ] Picker filtering still works (typing "claude" finds Anthropic models, typing "OpenAI" finds OpenAI models — search runs against both name and provider).
- [ ] Light and dark mode both render legibly.

**Deliverables.** One PR. Before/after screenshots.

**Pointers.** Files: `web-ui/src/components/AgentCreationModal.jsx`, `web-ui/src/components/AgentEditModal.jsx`. Models come from `useModelsStore.getState().getModelsByCategory()`; each entry has a `provider` field.

---

## Week 4 — Tool robustness

Agent tools are the leverage point. When they fail loudly, agents fail loudly.
Week 4 hardens the most-used ones.

### Capstone — Sandbox the terminal tool with allow/deny lists

> **Track:** dev + security + design
> **Difficulty:** 🔴 challenging
> **Time:** 12–16 hours

**Context.** The terminal tool can run any shell command an agent emits. There's no per-agent restriction. An agent with a creative prompt-injection vulnerability can `rm -rf` or exfiltrate data. We need command-level allow/deny lists, with safe defaults out of the box.

**What to do.**
1. **Add a default deny-list** in `src/tools/terminalTool.js` that always blocks: `rm -rf /`, `rm -rf /*`, `dd if=/dev/zero`, `mkfs`, `chmod 777 /` and similar fully-destructive patterns. Use full-command-line regex matching, not just executable names.
2. **Add a per-agent configurator** at `web-ui/src/components/toolConfig/TerminalConfigurator.jsx` (extending the existing one) with:
   - "Allowlist mode" (only listed commands run) vs "Denylist mode" (listed commands are blocked, everything else runs)
   - Editable list of regex patterns
   - Live preview: paste a candidate command, see "would be allowed" / "would be blocked"
3. **Wire up the agent's `toolConfig.terminal.allowList` / `denyList`** at execution time. When the tool runs, it consults the agent's config.
4. **Surface blocks to the user.** When a command is blocked, the tool returns an error with the offending pattern: `"Blocked by deny-list pattern: rm -rf"`. The agent can see this and try a different approach.
5. **Tests** for the matcher: deny-list catches each canonical destructive pattern; allow-list mode rejects anything not listed; regex anchoring prevents partial matches from sneaking through (`echo rm -rf` shouldn't trigger the `rm -rf` rule because of the `echo` prefix).

**Definition of done.**
- [ ] On every install, an agent with default config cannot run `rm -rf /` (test this manually).
- [ ] Agent edit modal shows a "Terminal sandbox" panel with mode + pattern list + live preview.
- [ ] Edits to the patterns persist with the agent and apply on next command execution.
- [ ] Blocked commands produce a clear error in the agent's tool-result stream.
- [ ] At least 12 unit tests covering: default denylist hits, custom denylist hits, allowlist mode pass, allowlist mode block, regex anchoring, empty list = no restriction.
- [ ] `docs/TOOL_REFERENCE.md` (from week 2) gets a "Sandbox configuration" section.
- [ ] Security review note in the PR description: anything we *can't* protect against (e.g., agents running curl to fetch a malicious script and pipe it to bash) is called out explicitly.

**Deliverables.**
- 1 PR with the sandbox logic + configurator + tests
- Updated `docs/TOOL_REFERENCE.md`
- A short "what we protect against / what we don't" note in the PR description

**Pointers.** `src/tools/terminalTool.js` has the existing execution path. The configurator pattern lives at `web-ui/src/components/toolConfig/registry.js`. The terminal-config schema needs a new shape.

---

### Daily — Add `--dry-run` mode to the file-content-replace tool

> **Track:** dev
> **Difficulty:** 🟢 easy
> **Time:** 1–2 hours

**Context.** When an agent uses the file-content-replace tool, the change is immediate. There's no preview. Adding a `dryRun: true` parameter that returns "what would change" without writing makes agents safer to chain.

**What to do.**
1. Add a `dryRun` boolean parameter to the tool's parameter schema in `src/tools/openaiFunctionSchemas.js`.
2. In `src/tools/fileContentReplaceTool.js`, when `dryRun` is true: compute the diff, return `{ wouldChange: true, preview: <unified diff>, occurrences: <count> }` without writing.
3. Default behavior unchanged (`dryRun: false`).
4. Add 2 unit tests: dry-run on a file that would change → returns preview, doesn't write; dry-run on a file with no match → returns `{ wouldChange: false, occurrences: 0 }`.

**Definition of done.**
- [ ] `dryRun: true` never writes to disk.
- [ ] Response includes a unified-diff preview (use `diff` package or manual `--- old / +++ new` formatting).
- [ ] Schema documents the new parameter.
- [ ] Tests pass.

**Deliverables.** One PR.

**Pointers.** The tool is `src/tools/fileContentReplaceTool.js`. Existing tests at `src/tools/__tests__/fileContentReplaceTool.test.js`.

---

### Daily — Audit the puppeteer browser tool for SSRF on redirects

> **Track:** security
> **Difficulty:** 🟡 moderate
> **Time:** 3–4 hours

**Context.** The web tool has an `allowedDomains` configurator. The check happens on the URL the agent supplies. But if the agent navigates to `https://allowed-domain.example` and that page issues a 30x redirect to `https://evil-domain.internal:8080/admin`, does the tool follow it? If yes, that's an SSRF vector — an agent could enumerate the host's internal network.

**What to do.**
1. Read `src/tools/webTool.js` and trace what happens on redirects (Puppeteer's default is to follow them).
2. Write a small repro: set up a local HTTP server that returns a 302 to `http://127.0.0.1:1` (a port unlikely to exist). Confirm whether the allowlist check catches the redirect.
3. If it doesn't (likely), file a security issue with a clear PoC. Propose a fix: re-check the allowlist on every navigation event, or set Puppeteer's redirect handling to manual.
4. Optional bonus: open a PR with the fix.

**Definition of done.**
- [ ] A written repro that demonstrates whether the SSRF works.
- [ ] If it works: an issue filed with `security` label and a clear PoC. Optionally a PR with the fix.
- [ ] If it doesn't work: a written verification note (commit the test that proves the allowlist holds against redirects).

**Deliverables.** Either an issue + PR (if vulnerable) or a verification test (if not).

**Pointers.** `src/tools/webTool.js`. `WebConfigurator.jsx` for the allowlist UI. Puppeteer's `page.on('framenavigated')` event is the right hook for re-checking.

---

# MONTH 2 — DEPTH

By month 2, contributors are comfortable. Tasks get larger and span more files.
Capstones increasingly need cross-track collaboration.

---

## Week 5 — Cost & observability

Users running the platform on real workloads need to know what they're spending
and where. Today, we don't surface that information.

### Capstone — Cost & token-usage dashboard

> **Track:** dev + design + devops
> **Difficulty:** 🟡 moderate
> **Time:** 14–18 hours

**Context.** `aiService.trackUsage()` is called on every successful response, but the data goes nowhere — there's no aggregation, no UI, no export. Users can't answer questions like "how much have I spent this month?" or "which agent is using all my tokens?".

**What to do.**
1. **Server side.** Build a `usageService.js` that:
   - Persists token-usage records to a SQLite file under the user-data directory (one row per LLM call: timestamp, agentId, provider, model, prompt_tokens, completion_tokens, cost-USD).
   - Cost calculation uses the manifest's `pricing.input` / `pricing.output` for the model. If no pricing is in the manifest, log 0 and flag the model as "unpriced".
   - Exposes endpoints: `GET /api/usage/summary?since=...&until=...&groupBy=agent|model|provider|day`.
2. **Frontend.** New `/usage` route in the web UI:
   - Top: total cost, total tokens, agent count, time range picker (today / 7d / 30d / all).
   - Breakdown bar charts: cost per provider, cost per agent, cost per model.
   - Table: every call (paginated), sortable.
   - "Export CSV" button.
3. **Nav.** Add a "Usage" link in the sidebar between "Skills" and "Settings".

**Definition of done.**
- [ ] Every successful chat completion writes a row to the usage DB.
- [ ] `/usage` page loads in <500ms with up to 30 days of data.
- [ ] Time range picker actually filters (verify by sending a few messages, switching range to "today", confirming counts).
- [ ] CSV export contains every visible row with all fields.
- [ ] Models without pricing in the manifest show "unpriced" and don't break the totals.
- [ ] Nav entry exists and routes correctly.
- [ ] Loading state when DB is being queried.
- [ ] Empty state ("No usage yet — send your first message") on a fresh install.

**Deliverables.**
- 1 PR with usageService, endpoints, frontend page, nav, tests
- Screenshots of the page populated with usage data

**Pointers.** `aiService.trackUsage()` is the existing hook (currently a no-op pass-through). Manifest pricing is in `config/models.default.json`. SQLite via `better-sqlite3` (already in dependencies for some tools, double-check before adding).

---

### Daily — Prometheus `/metrics` endpoint

> **Track:** devops
> **Difficulty:** 🟡 moderate
> **Time:** 3–4 hours

**Context.** Users running OnBuzz on a server (e.g., as a team's shared agent host on a Tailnet) want standard observability. Prometheus is the lingua franca.

**What to do.**
1. Add the `prom-client` library.
2. Create `src/services/metricsService.js` exposing counters and histograms for: total chat requests (labeled by provider + model), request duration (histogram), errors (labeled by provider + error category), active agents (gauge).
3. Wire counters and histograms at appropriate sites in `aiService.js` and `webServer.js`.
4. Add `GET /metrics` endpoint that returns Prometheus text format. Default: enabled. Disable via `LOXIA_METRICS=false` env var.
5. Document at `docs/OBSERVABILITY.md`: how to scrape, sample Grafana dashboard JSON, what each metric means.

**Definition of done.**
- [ ] `curl http://localhost:8080/metrics` returns valid Prometheus text format.
- [ ] All four metric families are populated after sending a few messages.
- [ ] `LOXIA_METRICS=false` disables the endpoint (returns 404).
- [ ] `docs/OBSERVABILITY.md` exists with a sample scrape config and a "metrics meaning" table.

**Deliverables.** One PR + new docs file.

**Pointers.** Use `prom-client`'s default registry. Don't expose Node.js default metrics unless explicitly enabled (they're verbose) — let users opt in via a separate env var.

---

### Daily — Audit and update manifest pricing for current models

> **Track:** datasci + writer
> **Difficulty:** 🟡 moderate
> **Time:** 3–4 hours

**Context.** `config/models.default.json` has `pricing.input` and `pricing.output` fields, but they may be stale. The cost dashboard (capstone above) relies on them. Time for a curation pass.

**What to do.**
1. For each model in the manifest, look up the current public pricing on the vendor's pricing page.
2. Update `pricing.input` and `pricing.output` to match (USD per 1M tokens).
3. For models discovered live (OpenAI 134, Gemini 38, etc.) that aren't in the manifest, identify the top-20-by-likely-usage and add manifest entries with pricing. Don't try to cover all 134 — pick the popular ones.
4. Add a "Pricing as of [date]" comment at the top of the manifest so future maintainers know when it was audited.

**Definition of done.**
- [ ] All existing manifest entries have up-to-date pricing (link to the vendor pricing page in the PR description for each one).
- [ ] At least 15 additional popular models added to the manifest with pricing.
- [ ] Date-stamped audit comment at the top of the file.

**Deliverables.** One PR editing `config/models.default.json` + a "sources" section in the PR description with vendor pricing-page URLs.

**Pointers.** Vendors' public pricing pages: `openai.com/pricing`, `anthropic.com/pricing`, `ai.google.dev/pricing`, `x.ai/api`. Ollama models stay at `pricing: { input: 0, output: 0 }`.

---

## Week 6 — RAG & long-term memory

Most agent platforms now have a "give your agent a knowledge base" primitive.
We don't. This week ships one.

### Capstone — Knowledge-base primitive (RAG MVP)

> **Track:** dev + design + writer
> **Difficulty:** 🔴 challenging
> **Time:** 20–28 hours

**Context.** Today, an agent only knows what's in its system prompt and the immediate conversation. Users want to give an agent a folder of docs ("read my company wiki") or a few PDFs ("learn from these papers") and have the agent retrieve relevant context at query time. Other platforms have this; we don't.

**What to do.**
1. **Embeddings provider abstraction.** New `src/services/embeddingsService.js` with adapters for OpenAI's `text-embedding-3-small` and Gemini's `text-embedding-004`. Optional Ollama embeddings via `nomic-embed-text` for local-only setups.
2. **Vector store.** SQLite-backed (via `sqlite-vec` extension or a manual cosine-similarity table). Per-agent KB collection. Schema: `(agentId, docId, chunkId, embedding, text, metadata)`.
3. **Ingestion.** `POST /api/agents/:agentId/kb/ingest` accepts a file (txt/md/pdf), chunks it (target ~500 tokens, with 50-token overlap), embeds each chunk, persists.
4. **Retrieval.** New tool: `kbSearch`. The agent calls it with a query string; the tool runs cosine similarity, returns top-K chunks with scores. The agent decides what to do with them.
5. **UI.** In the agent edit modal, a new "Knowledge base" tab listing ingested files with delete buttons + a drag-and-drop ingestion area.
6. **Docs.** A new `docs/RAG.md` covering: when to use RAG vs. long context windows, how to configure embeddings provider, file-size limits, privacy implications.

**Definition of done.**
- [ ] User can drag a markdown file onto an agent's KB tab and see it ingest with a progress indicator.
- [ ] Asking the agent a question whose answer is in the KB causes the agent to call `kbSearch` and produce an answer that demonstrably uses the retrieved chunks (test by asking about something only in the KB).
- [ ] Deleting a file removes its chunks from the vector store.
- [ ] At least one provider's embeddings model works (OpenAI is the easiest first target).
- [ ] Tests for: chunking edge cases (empty, single line, very long line), retrieval correctness on a fixed corpus, ingestion idempotency (re-ingesting the same file replaces, doesn't duplicate).
- [ ] `docs/RAG.md` exists.

**Deliverables.**
- 1 PR (likely large — review-friendly commits welcome) with embeddings service, vector store, ingestion endpoint, kbSearch tool, UI tab, tests
- `docs/RAG.md`
- A "before/after" demo in the PR: the same question asked of an agent without the KB and with it.

**Pointers.** `sqlite-vec` is a small, well-maintained Loadable extension that gives SQLite vector search. Alternatively, write the cosine similarity in pure JS if the `sqlite-vec` install is fragile across platforms — a simple JS implementation is fast enough for ≤100k chunks.

---

### Daily — Ingestion edge-case tests

> **Track:** qa
> **Difficulty:** 🟡 moderate
> **Time:** 2–3 hours

**Context.** RAG ingestion fails on edge inputs (empty files, single-character files, files with only whitespace, files with extremely long lines, binary files mistakenly named `.txt`). These need explicit tests so the capstone's PR doesn't ship with hidden bugs.

**What to do.** After the capstone above lands (or in parallel by writing the tests against the spec), add tests covering:
- Empty file (0 bytes) → ingestion succeeds, produces 0 chunks
- Single-character file → 1 chunk
- File of all whitespace → 0 chunks (whitespace is filtered)
- File with one 50,000-char line → chunked at the configured boundary
- Binary file with `.txt` extension → ingestion fails fast with a clear error
- File with mixed line endings (CRLF + LF) → chunked correctly
- File at exactly the chunk boundary → produces the correct chunk count

**Definition of done.**
- [ ] 7 tests added in `src/services/__tests__/embeddingsService.test.js` (or wherever the capstone places its tests).
- [ ] All tests pass.
- [ ] Each test name describes the scenario in one short sentence.

**Deliverables.** One PR (or one commit appended to the capstone PR if you're collaborating directly).

**Pointers.** Wait for the capstone's chunking interface to stabilize, or coordinate with the capstone author on the chunking signature.

---

### Daily — "When to use RAG vs. long context" decision-tree doc

> **Track:** writer
> **Difficulty:** 🟢 easy
> **Time:** 1–2 hours

**Context.** RAG and long context windows solve overlapping problems. New users with 1 MB of docs don't know whether to dump it in the system prompt or use the KB. A short doc with a flowchart removes the guesswork.

**What to do.** Add a section to `docs/RAG.md` titled "When to use RAG vs. long context". Include a flowchart (mermaid syntax — GitHub renders it) with branches for: doc size, query frequency, freshness needs, privacy needs.

**Definition of done.**
- [ ] Section exists in `docs/RAG.md` (file may be created by the capstone task; coordinate or wait).
- [ ] Mermaid flowchart renders correctly on GitHub.
- [ ] At least 4 decision branches.
- [ ] One worked example per major branch ("a 50-page handbook" / "a daily-changing log file" / "PII you don't want in cloud requests").

**Deliverables.** One PR editing `docs/RAG.md`.

---

## Week 7 — Accessibility & internationalization

A platform that's local-first and BYOK is a platform for everyone — including
people who use screen readers and people whose first language isn't English.

### Capstone — WCAG 2.1 AA audit + remediation

> **Track:** a11y + dev
> **Difficulty:** 🟡 moderate (audit) + 🔴 challenging (remediation)
> **Time:** 16–24 hours

**Context.** No formal accessibility audit has been done. Likely issues: icon-only buttons missing labels, focus traps in modals, color contrast failures on the redteam/dracula themes, keyboard navigation gaps in the agent picker.

**What to do.**
1. **Audit (a11y track).** Run axe DevTools on every major page (Live Chat, My Squadron, Flows, Schedules, Skills, Widget Gallery, Settings) in light + dark + dracula + redteam themes. File one issue per finding labeled `a11y` with: page, theme, severity, WCAG criterion, screenshot.
2. **Manual keyboard-only pass.** Tab through every interactive element on every page. Note any missing focus indicators, non-reachable controls, illogical tab order, or focus traps. Add findings to issues from step 1.
3. **Screen reader pass.** Using NVDA (Windows), VoiceOver (Mac), or Orca (Linux), navigate the chat surface end to end. Note anything that's silent or misannounced.
4. **Remediation (dev track).** Fix as many findings as possible. Aim to close every "critical" and "serious" finding; "moderate" findings can roll to subsequent tasks.
5. **CI integration.** Add `axe-core/jest` to the test suite as a smoke check that catches regressions on the chat page and Settings page.

**Definition of done.**
- [ ] At least 15 distinct a11y issues filed during the audit.
- [ ] All `critical` and `serious` issues closed (their PRs merged).
- [ ] `axe-core` smoke test runs in CI on at least 2 pages.
- [ ] Light, dark, dracula, redteam themes each pass WCAG AA contrast for body text and primary buttons.
- [ ] Every icon-only button has an `aria-label` or `aria-labelledby`.
- [ ] No focus traps remain in any modal (Escape closes, Tab cycles, Shift+Tab reverses).

**Deliverables.**
- ≥15 issues filed (each with reproduction steps)
- ≥1 PR per closed issue (group small fixes)
- 1 PR adding axe-core to the test suite
- `docs/ACCESSIBILITY.md` describing our a11y commitments and how to test

**Pointers.** [axe DevTools browser extension](https://www.deque.com/axe/devtools/) is free and the standard tool. The chat surface is the highest-volume page; prioritize it. Modal a11y patterns: `aria-modal="true"`, focus trap on open, return focus on close.

---

### Daily — Stand up `i18next` with English + one second language

> **Track:** i18n + dev
> **Difficulty:** 🟡 moderate
> **Time:** 4–6 hours

**Context.** All UI strings today are inline English. The first non-English user has to fork the repo. Adding `i18next` and translating the 30 most-visible strings unlocks contributions from anyone fluent in another language.

**What to do.**
1. Install `i18next` + `react-i18next`. Wire the provider in `web-ui/src/main.jsx`.
2. Create `web-ui/src/i18n/` with `en.json` (the canonical strings) and one second-language file (`es.json` / `fr.json` / `he.json` / your choice — pick one you can verify).
3. Migrate the 30 most-visible UI strings to keys: nav labels, sidebar headers, the empty-state in chat, the buttons in the agent creation modal, the "Provider key missing" warning. Don't migrate every string — that's a future task.
4. Add a language picker in Settings. On change, switch the active locale.
5. Persist the chosen locale to `localStorage` so it sticks across sessions.

**Definition of done.**
- [ ] App loads in English by default. Switching the language picker swaps the visible strings.
- [ ] At least 30 distinct keys exist, used in real components (not just defined).
- [ ] Each key has a translation in both `en.json` and the second-language file.
- [ ] Choice persists across page refresh.
- [ ] No console warnings about "missing key" on the migrated strings.

**Deliverables.** One PR with `i18n/` setup, key migrations in components, language picker UI, two translation files.

**Pointers.** `i18next` docs are good. Keys should be hierarchical (`nav.chat`, `nav.agents`, `agentCreate.modelLabel`) — easier to translate in chunks.

---

### Daily — Color-contrast verification across all four themes

> **Track:** design + a11y
> **Difficulty:** 🟢 easy
> **Time:** 2–3 hours

**Context.** Themes look good aesthetically but haven't been verified against WCAG AA contrast (4.5:1 for body text, 3:1 for large text and UI components).

**What to do.** For each of the four themes (light, dark, dracula, redteam):
1. Open the app in that theme.
2. Use Chrome DevTools' contrast inspector (or a tool like https://webaim.org/resources/contrastchecker/) to check: body text vs. background, button text vs. button background, link text vs. background, sidebar text vs. sidebar background, sidebar-active vs. sidebar-active-bg, error/warning/success badges.
3. For every failure, file a small issue with: theme, element, current ratio, target ratio, and a screenshot. Optionally fix one or two by adjusting the theme color in `web-ui/src/config/brand.js`.

**Definition of done.**
- [ ] Audit results documented in a single issue per theme (4 issues total) with a checklist of every contrast pair.
- [ ] All failures called out with current/target ratios.
- [ ] At least 2 contrast issues fixed in PRs.

**Deliverables.** 4 issues + ≥2 PRs.

**Pointers.** `web-ui/src/config/brand.js` has the theme color definitions. Some failures may require adjusting only one or two values.

---

## Week 8 — Testing infrastructure

The unit test suite (~3850 tests) is solid. End-to-end coverage is not. This
week builds the e2e harness.

### Capstone — Playwright e2e harness with stub provider

> **Track:** qa + dev
> **Difficulty:** 🔴 challenging
> **Time:** 12–18 hours

**Context.** There's no automated test that boots the actual server, opens the actual UI in a browser, and exercises a real user flow. We rely on manual verification, which means UI regressions ship.

**What to do.**
1. Install Playwright. Add a `playwright.config.js` at the repo root.
2. Create a `stubProvider.js` adapter (in `src/services/providers/stubProvider.js`) that returns canned responses for tests. Plug it into `ProviderRegistry` as `provider: 'stub'`.
3. Write a CI-runnable e2e suite at `e2e/` covering:
   - Server boots, web UI loads, no console errors
   - User can create an agent (with stub provider) without errors
   - User can send a message and see the response stream
   - User can switch agents and the conversation persists per-agent
   - Settings page loads, can save a (fake) provider key
4. Wire into GitHub Actions: a new job `e2e` in `.github/workflows/build-binaries.yml` (or a new workflow) that runs Playwright on PRs.

**Definition of done.**
- [ ] `npx playwright test` runs from a clean checkout and passes on Mac, Linux, Windows runners.
- [ ] The stub provider lives at the documented path and is registered in the provider registry behind a flag.
- [ ] At least 5 e2e test scenarios pass.
- [ ] CI workflow executes the e2e suite on every PR.
- [ ] Documentation at `docs/TESTING.md` covers: how to run e2e locally, how to add a new test, how the stub provider works.

**Deliverables.**
- 1 PR with stubProvider, Playwright config, ≥5 e2e tests, CI integration, and `docs/TESTING.md`.

**Pointers.** Stub provider should be `chat: false` in the catalog so it doesn't appear in the picker for real users — only the tests can target it via `provider: 'stub'` in the request.

---

### Daily — Re-enable the React test project in jest.config.js

> **Track:** qa
> **Difficulty:** 🟢 easy
> **Time:** 30–60 minutes

**Context.** During the OSS conversion, the React test project was removed from `jest.config.js` because `jest-environment-jsdom` wasn't installed. There's existing component-level test infrastructure that's currently dead code.

**What to do.**
1. Add `jest-environment-jsdom` to `web-ui/package.json` devDependencies.
2. Restore the `react` project entry in `jest.config.js` with the same shape it had before (you can find it in git history of the deletion commit, or rebuild it from scratch — the moduleNameMapper for css/svg, the transform for jsx, the setupFilesAfterEnv for jest-dom).
3. Verify at least one existing React component test runs (e.g. one of the toolRenderer tests).

**Definition of done.**
- [ ] `npm test` (with no project filter) runs both unit and react projects and at least one react test passes.
- [ ] No regressions in the unit suite.

**Deliverables.** One PR.

**Pointers.** The deletion was in commit history; running `git log --diff-filter=D --name-only` will find the deletion event in older repos. For the orphan-commit OSS repo, just rebuild from the jest docs.

---

### Daily — Add coverage badge to the README

> **Track:** devops
> **Difficulty:** 🟢 easy
> **Time:** 1 hour

**Context.** Coverage isn't visible. New contributors don't know what's well-tested vs. fragile. A badge that updates from CI gives them a fast signal.

**What to do.**
1. Configure jest to emit lcov + json-summary via `--coverage`.
2. Add a CI step that uploads coverage to Codecov (or Coveralls — both have free tiers for OSS).
3. Add the corresponding badge to `README.md`.

**Definition of done.**
- [ ] Coverage runs on every CI build.
- [ ] Badge in README shows current coverage percentage and links to the report.
- [ ] No spurious "coverage decreased!" CI failures on small PRs (configure the threshold sensibly — initially set to "don't fail, just report").

**Deliverables.** CI workflow updated, README badge added, link works.

**Pointers.** Codecov's GitHub Action is `codecov/codecov-action@v4`. Coverage threshold tuning belongs to a future task.

---

# MONTH 3 — FRONTIER

Month 3 is for the ambitious work — features that bring us to parity with
leading platforms or do something genuinely novel.

---

## Week 9 — MCP (Model Context Protocol) integration

MCP is the emerging standard for connecting AI hosts to external
tools/resources. Claude Desktop, Cline, and Cursor all speak it. Speaking it
ourselves means agents in OnBuzz can use any MCP server users have already
configured.

### Capstone — MCP host support (consume MCP servers)

> **Track:** dev + writer + devrel
> **Difficulty:** 🔴 challenging
> **Time:** 24–32 hours

**Context.** MCP defines a way for AI hosts to talk to "MCP servers" that expose tools, resources, and prompts. Many ecosystem servers already exist (filesystem, GitHub, Slack, Postgres, etc.). Implementing the host side means OnBuzz agents can use any of them without us writing each tool.

**What to do.**
1. **Read the spec.** [modelcontextprotocol.io](https://modelcontextprotocol.io/specification). Specifically the JSON-RPC 2.0 transport, the `tools/list`, `tools/call`, `resources/list`, `resources/read` methods, and the `notifications/tools/list_changed` notification.
2. **Stdio transport.** Implement `src/services/mcpClient.js` as an MCP client that spawns a subprocess (the MCP server), pipes JSON-RPC over stdio, and handles request/response correlation.
3. **Server lifecycle.** Add config UI: "MCP Servers" tab in Settings. Each entry: name, command, args, env vars. Start/stop/restart buttons. Status indicator (connected / error / not running).
4. **Tool registration.** When an MCP server connects, query `tools/list` and register each tool in OnBuzz's `toolsRegistry` with a name like `mcp:<server-name>:<tool-name>`. When the LLM calls one, route the call back over the MCP transport.
5. **Persist** the configured servers across restarts.
6. **Document** at `docs/MCP.md`: setup walkthrough (using a known server like `@modelcontextprotocol/server-filesystem` as the example), troubleshooting, what's not supported yet (resources, prompts, sampling — those are future work).

**Definition of done.**
- [ ] A user can add an MCP server config in Settings → MCP Servers, click "Start", and see it transition to "connected".
- [ ] After connecting, the server's tools appear in the agent picker and an agent can use them.
- [ ] Disconnecting / restarting cleans up subprocesses (no orphan processes after the UI session ends).
- [ ] `docs/MCP.md` walks a fresh user through connecting `@modelcontextprotocol/server-filesystem` and using it from an agent.
- [ ] At least 8 unit tests covering: client message correlation, error responses, server crash handling, tool registration on connect, tool deregistration on disconnect.

**Deliverables.**
- 1 PR (will be large; review-friendly commit structure encouraged) with mcpClient, registry integration, UI panel, persistence, tests
- `docs/MCP.md`
- A 5-minute demo video showing OnBuzz using a public MCP server

**Pointers.** The spec ships a [TypeScript reference implementation](https://github.com/modelcontextprotocol/typescript-sdk) — read it for transport details. We don't need the SDK as a runtime dep (re-implementing is small), but it's a good reference.

---

### Daily — "Connect Claude Desktop's MCP servers to OnBuzz" tutorial

> **Track:** writer
> **Difficulty:** 🟢 easy (after the capstone is in)
> **Time:** 2–3 hours

**Context.** Many users already have MCP servers configured for Claude Desktop. Walking them through "you can use those same servers in OnBuzz" is a major adoption moment. After the capstone lands, a tutorial closes the loop.

**What to do.** Tutorial in `docs/tutorials/mcp-from-claude-desktop.md`:
1. Where Claude Desktop's MCP config lives on each OS.
2. How to copy/adapt those config blocks into OnBuzz.
3. Walk-through with a real public MCP server (filesystem, fetch, or sqlite).
4. Common pitfalls: env var differences, sandbox differences.

**Definition of done.**
- [ ] Tutorial exists at the documented path.
- [ ] Tested by following the tutorial yourself on a fresh setup; it works without troubleshooting.
- [ ] At least 3 inline screenshots.
- [ ] Linked from `docs/MCP.md`.

**Deliverables.** One PR.

**Pointers.** Wait until the capstone is merged.

---

### Daily — Chrome extension MVP: "Send to OnBuzz agent"

> **Track:** dev
> **Difficulty:** 🟡 moderate
> **Time:** 4–6 hours

**Context.** A common workflow: highlight text on a page, want to send it to an agent. Today: switch tab, paste, type. With a tiny Chrome extension: right-click → "Send to OnBuzz" and the highlighted text pre-fills a new chat with your default agent.

**What to do.**
1. Create `browser-extension/` directory at the repo root with a Manifest V3 Chrome extension.
2. Add a context-menu entry "Send to OnBuzz agent". On click: take the selected text, POST to `http://localhost:8080/api/chat/quick-send` with `{ text: <selection>, source_url: <page url> }`.
3. Add the `/api/chat/quick-send` endpoint to webServer that creates a new conversation in the user's "default" agent (or creates a "Quick Send" agent if none exists).
4. After the call, open a new tab to `http://localhost:8080/` so the user lands in the chat with the message already there.
5. Document at `docs/BROWSER_EXTENSION.md`: install instructions (load unpacked), what it does, security notes (it only talks to localhost).

**Definition of done.**
- [ ] Extension loads via "Load unpacked" in Chrome's developer-mode extensions page.
- [ ] Right-click on selected text shows "Send to OnBuzz agent".
- [ ] Clicking it sends the text to a running OnBuzz instance and opens the chat with the message visible.
- [ ] If the OnBuzz server isn't running, the extension shows a friendly error notification.
- [ ] Documentation explains install + use.

**Deliverables.**
- 1 PR with `browser-extension/` source + new endpoint + docs
- A 30-second demo GIF in the PR description

**Pointers.** Chrome's extension docs at developer.chrome.com. Manifest V3 service workers are the right pattern for context menus.

---

## Week 10 — Agent recipes & skills library expansion

The platform is only as useful as the recipes that exist for it. Week 10
massively expands the bundled skills set, with cross-domain coverage.

### Capstone — Ship 6 high-quality skills covering 6 different domains

> **Track:** domain + writer + dev
> **Difficulty:** 🟡 moderate
> **Time:** 4–6 hours per skill (24–36 hours total across collaborators)

**Context.** Today the only bundled skill is `web-game-dev`. Most users won't write their own from scratch — they'll fork an existing one. Six well-crafted skills covering distinct domains gives every user "something close to what I need" as a starting point.

**What to do.** Build 6 skills in `skills/`. Each is a standalone directory with: `README.md` (what it does, when to use), `SYSTEM_PROMPT.md` (the agent's system prompt), `TOOL_CONFIG.json` (suggested tool config), `EXAMPLE_CONVERSATION.md` (a realistic transcript). Pick at least one from each of these domain clusters:

1. **Code review** — reads `git diff`, summarizes changes, flags concerns, suggests improvements.
2. **Research with citations** — reads URLs, takes attributed notes, writes summaries with footnoted citations.
3. **Meeting prep + follow-up** — drafts agenda from attendees + topic; after meeting, takes bullet notes and produces a follow-up email.
4. **Document organizer** — given a folder of mixed files, suggests a hierarchical structure and renames.
5. **Personal-finance categorizer** — bank-export CSV in, categorized output with confidence scores. (Local-only via Ollama recommended; surface this in the skill's README.)
6. **TTRPG NPC generator** — short bio + manner of speaking + secret + plot hook, in the system the user specifies.

The Recipes-by-Field doc may inspire alternates. The point is *six high-quality, working examples*.

**Definition of done.**
- [ ] Six skill directories exist under `skills/` with the four required files each.
- [ ] Each skill's example conversation actually works when the system prompt is dropped into a fresh agent — verified by the skill author.
- [ ] Each skill's README answers: who is this for? when do I use it? what won't it do?
- [ ] All six skills appear in the Skills page in the web UI (the file-discovery loader picks them up automatically — verify it does).
- [ ] At least 2 of the 6 are authored by domain experts (not just developers padding for coverage).

**Deliverables.**
- 6 skill directories (one PR per skill is fine — easier to review and merge incrementally)
- A `skills/README.md` index page describing each shipped skill in 1–2 sentences

**Pointers.** Existing skill: `skills/web-game-dev/`. Match its file layout. The Recipes-by-Field doc has a deeper menu of recipe ideas if these six don't excite you.

---

### Daily — Skill picker UX in the agent creation modal

> **Track:** design + dev
> **Difficulty:** 🟡 moderate
> **Time:** 3–4 hours

**Context.** The skill picker today is buried at the bottom of the agent creation modal as a multi-select dropdown. With 6+ skills, that's not great UX. A card-based picker with skill descriptions raises discoverability.

**What to do.** Redesign the skill picker in `AgentCreationModal.jsx` (and `AgentEditModal.jsx`):
- Card grid (3 columns on desktop, 1 on mobile)
- Each card: skill name, 1-line description, tags (e.g., "code", "research", "domain:legal"), checkbox to enable
- Search input above the grid that filters by name + tags
- "Selected: 2" counter visible at all times

**Definition of done.**
- [ ] New skill picker renders correctly with the 6 shipped skills.
- [ ] Search filters cards live (no submit button).
- [ ] Picker works on mobile (single column, no horizontal scroll).
- [ ] Selected state persists when the user navigates away and back within the modal.

**Deliverables.** One PR. Before/after screenshots.

**Pointers.** `web-ui/src/components/AgentCreationModal.jsx`, `web-ui/src/components/AgentEditModal.jsx`. The skill data comes from `api.listSkills()`.

---

### Daily — "Anatomy of a great skill" doc

> **Track:** writer
> **Difficulty:** 🟢 easy
> **Time:** 2 hours

**Context.** Future skill PRs need to know what good looks like. A short style guide using the 6 shipped skills as exemplars makes review consistent and welcoming.

**What to do.** Add `docs/AUTHORING_SKILLS.md` covering:
- File layout (the 4 required files: README, SYSTEM_PROMPT, TOOL_CONFIG, EXAMPLE_CONVERSATION)
- What goes in each file (with concrete examples cherry-picked from the shipped skills)
- System-prompt do's and don'ts (no "you are an expert" filler; do specify behaviors and refusals)
- Privacy/safety guidance for sensitive domains (link to the Recipes-by-Field doc)
- The PR review checklist we use when merging skills

**Definition of done.**
- [ ] Doc exists at `docs/AUTHORING_SKILLS.md`.
- [ ] References the 6 shipped skills as examples.
- [ ] Includes a complete checklist usable as a copy-paste PR template.
- [ ] Linked from `CONTRIBUTING.md`.

**Deliverables.** One PR.

---

## Week 11 — Performance & scale

Up to now the focus has been correctness and breadth. Week 11 makes the
platform fast and resource-efficient under real workloads.

### Capstone — Concurrent-agent throughput profile + top-3 fixes

> **Track:** dev + devops
> **Difficulty:** 🔴 challenging
> **Time:** 14–20 hours

**Context.** A power user running 20 simultaneous agents reports things slow down dramatically. Nobody has profiled why. The capstone is: profile, identify, fix.

**What to do.**
1. **Build a load-test script** at `scripts/load-test.mjs` that boots OnBuzz, creates N agents (configurable), sends K messages per agent in parallel against the stubProvider (week 8) so we don't burn vendor credits.
2. **Profile.** Run the load test with `--inspect` and capture a CPU profile. Identify the top 3 hot functions or wait sites.
3. **File issues** — one per bottleneck, with the profile evidence and a hypothesis.
4. **Fix at least 2 of the 3.** Re-run the load test; document the before/after numbers.
5. **Document** at `docs/PERFORMANCE.md`: methodology, current envelope ("on a 2024 MacBook M3, OnBuzz handles N concurrent agents at K msg/sec with provider X"), how to reproduce.

**Definition of done.**
- [ ] Load-test script exists and runs.
- [ ] CPU profile captured and analyzed; top 3 bottlenecks identified.
- [ ] At least 2 fixes merged with measurable improvement.
- [ ] `docs/PERFORMANCE.md` documents the envelope with a reproducible benchmark.
- [ ] Before/after numbers in the PR description (each fix's PR).

**Deliverables.**
- `scripts/load-test.mjs`
- ≥3 issues filed (with profile evidence)
- ≥2 fix PRs with measurements
- `docs/PERFORMANCE.md`

**Pointers.** Node's built-in profiler (`node --prof`) is fine. Chrome DevTools' `--inspect` is friendlier. Likely hot spots: `agentScheduler` cycle iteration, `_formatMessagesForModel`, `messageProcessor` tool execution.

---

### Daily — Bundle-size budget for the web UI

> **Track:** devops + dev
> **Difficulty:** 🟡 moderate
> **Time:** 2–3 hours

**Context.** The web UI bundle is currently ~2.5 MB raw / ~700 KB gzipped. Growth without notice is how dashboards become slow. A CI guardrail catches it.

**What to do.**
1. Add `vite-plugin-bundle-visualizer` (or `rollup-plugin-visualizer`) to the web-ui build.
2. After build, emit a `web-ui/build/bundle-stats.json` summary.
3. Add a CI step: `node scripts/check-bundle-size.mjs` that fails if the main bundle exceeds the configured budget by more than 5%. Initial budget: current size + 50 KB headroom.
4. Document in `docs/PERFORMANCE.md` how to investigate growth (read the visualizer report).

**Definition of done.**
- [ ] Build emits the stats JSON.
- [ ] CI fails on a synthetic test (artificially bloating one source file) and passes on the current main.
- [ ] Documented in `docs/PERFORMANCE.md`.

**Deliverables.** One PR with the visualizer config + CI check + docs.

---

### Daily — Single-container Docker image + recipe

> **Track:** devops
> **Difficulty:** 🟡 moderate
> **Time:** 3–4 hours

**Context.** Some users want to run OnBuzz on a home server (Tailnet, Proxmox, etc.) rather than their laptop. A clean Dockerfile + docker-compose recipe makes that an out-of-the-box experience.

**What to do.**
1. Write a multi-stage Dockerfile:
   - Stage 1: `node:20-bookworm-slim` — install deps, build web-ui.
   - Stage 2: `node:20-bookworm-slim` — copy bundled `src/`, `web-ui/build/`, `package.json`, `node_modules/` (production-only). Expose port 8080. Default CMD: `node bin/cli.js web --host 0.0.0.0`.
2. Write a `docker-compose.example.yml` that:
   - Mounts a volume for the user-data directory (so settings/agents persist).
   - Optionally mounts a working directory for agents to read/write.
   - Sets env vars for provider keys via `.env`.
3. Document at `docs/DOCKER.md`: how to build, how to run with compose, persistence, security caveats (don't expose port 8080 to the public internet without a reverse proxy + auth — we're a single-user app today).
4. Add a CI step that builds the image (doesn't push) on every PR — catches Dockerfile breakages early.

**Definition of done.**
- [ ] `docker build -t onbuzz .` succeeds from a clean checkout.
- [ ] `docker compose up` starts the server, web UI accessible at `http://localhost:8080`.
- [ ] Setting a provider key, restarting the container, and confirming the key persists.
- [ ] Image size is reasonable (≤ 500 MB) — Puppeteer's bundled Chromium is the culprit if size balloons; use `PUPPETEER_SKIP_DOWNLOAD=true` and document that the web tool requires a separately-installed browser.
- [ ] CI builds the image on every PR.

**Deliverables.**
- `Dockerfile`
- `docker-compose.example.yml`
- `.dockerignore`
- `docs/DOCKER.md`
- CI workflow step

**Pointers.** Earlier in this codebase's history there was a `Dockerfile` — it was deleted during OSS cleanup because it referenced commercial-product internals. Start fresh.

---

## Week 12 — Showcase & launch

Three months in. Time to surface the work to a wider audience.

### Capstone — Public showcase: blog post + demo video + launch thread

> **Track:** devrel + writer + visual + dev
> **Difficulty:** 🟡 moderate
> **Time:** 16–24 hours total

**Context.** The work landed across 12 weeks should be visible to people who aren't already in the project. A combined launch (blog post + 3-minute demo + announcement thread) gets more attention than any one of them alone.

**What to do.**
1. **Blog post** (writer, ~6 hours):
   - Headline: something specific and concrete, not "Announcing OnBuzz Community". Try: "Three months of OnBuzz Community, by the contributors who built it."
   - Lede: the strongest single feature shipped (likely RAG, MCP, or sandboxed terminal). Show, don't tell.
   - Section per major capstone with credit to the contributors.
   - Closing: how to start using it today + how to contribute.
   - 1500–2500 words. Two passes for trimming.
2. **Demo video** (visual + dev, ~8 hours):
   - 3 minutes target length.
   - Cold open with the most visceral capability (e.g., one agent reviewing a real PR).
   - Cut between 4 features showing breadth.
   - Voice-over optional (subtitles required for accessibility).
   - Final card: the GitHub URL + Apache 2.0 + how to install.
3. **Launch thread** (devrel, ~2 hours): a multi-tweet thread on Twitter/Mastodon and a top-level post on HN/Reddit/relevant subreddits. Crosslink the blog and video.
4. **Contributors page** on the docs site (writer, ~4 hours): every contributor by name, with their merged tasks and any short bio they want to share.

**Definition of done.**
- [ ] Blog post published on the OnBuzz site (or as a `docs/blog/three-months-in.md` if no blog infra exists yet).
- [ ] Demo video published to YouTube + linked from the README.
- [ ] HN post submitted, Reddit post in r/LocalLLaMA + r/MachineLearning posted.
- [ ] `docs/CONTRIBUTORS.md` lists every merged contributor.
- [ ] All contributors offered a chance to review their attribution before publication.

**Deliverables.**
- 1 blog post
- 1 video
- ≥2 social posts
- `docs/CONTRIBUTORS.md`

**Pointers.** Don't make this a marketing exercise — it'll backfire on technical audiences. Show the work, credit the people, link the code.

---

### Daily — Pre-launch sweep for TODOs and skipped tests

> **Track:** dev
> **Difficulty:** 🟢 easy
> **Time:** 2–3 hours

**Context.** Before pushing the showcase live, comb the codebase for `TODO`, `FIXME`, `XXX`, `// 🚧`, and `xtest` / `it.skip` markers. Triage each: fix it now, file an issue, or remove if obsolete.

**What to do.**
1. `grep -rn "TODO\|FIXME\|XXX" src web-ui/src` and review each hit.
2. `grep -rn "xtest\|it\.skip\|describe\.skip" src web-ui/src` and review each skipped test.
3. For each finding, decide: fix now (≤30 min effort), file an issue, or delete (the comment is stale or the skipped test is obsolete).
4. Open one PR with the fixes + deletions, and cross-reference filed issues for the rest.

**Definition of done.**
- [ ] Every TODO/FIXME/skipped-test has been triaged.
- [ ] Issues filed for everything not fixed in this PR.
- [ ] PR description includes the triage summary (X fixed, Y filed as issues, Z deleted).

**Deliverables.** One PR + the issues filed.

---

### Daily — Final README polish for launch

> **Track:** writer
> **Difficulty:** 🟢 easy
> **Time:** 1–2 hours

**Context.** New visitors will land on the README from the launch announcement. It needs a final pass: no broken links, no dated screenshots, accurate feature list, working demo GIF.

**What to do.**
1. Read the README front-to-back. Flag any line that's stale, inaccurate, or unclear.
2. Verify every link works (use a markdown link checker).
3. Re-run the demo GIF capture if anything in the UI has visibly changed since week 1.
4. Update the feature list to reflect what shipped over 12 weeks (RAG, MCP, sandboxed terminal, cost dashboard, six skills, …).

**Definition of done.**
- [ ] Every link works.
- [ ] No outdated screenshots or GIFs.
- [ ] Feature list accurate.
- [ ] One trusted reviewer signs off ("read this and felt accurate and inviting").

**Deliverables.** One PR.

---

# How to claim a task

1. Find a task in this doc that fits.
2. Search the issue tracker — most tasks have a corresponding issue. Comment "I'd like to take this".
3. If there's no issue yet, file one using the [Contribution idea](https://github.com/Loxia-ai/onbuzz-community/issues/new?template=contribution_idea.yml) template, link to this doc, and mention which week/task.
4. We assign it to you. You have a soft deadline of 2 weeks; if you need more, just say so. If you change your mind, leave a comment to free it up — no judgment.

# How to propose a new task

The 48 tasks here are a starting menu, not the full universe. If you have an idea
that fits the platform, file a [Contribution idea](https://github.com/Loxia-ai/onbuzz-community/issues/new?template=contribution_idea.yml).

A good task proposal includes:
- The same shape as tasks in this doc (track, difficulty, time, context, definition of done, deliverables, pointers)
- A motivation: who benefits, what changes for them
- An honest scope: 4 hours? 4 days? The honest answer is the right answer

We'll either pull the proposal into the program (with a label and a link from this doc) or close it kindly with reasoning if it doesn't fit.
