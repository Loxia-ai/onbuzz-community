# Contributing to OnBuzz Community

Thanks for considering it. OnBuzz Community lives or dies by its contributors, and we want it to be easy to land your first PR. This doc is short on purpose — read it once, then send code.

## Table of contents

- [How to start](#how-to-start)
- [How to submit a PR](#how-to-submit-a-pr)
- [What we're looking for](#what-were-looking-for)
- [Coding guidelines](#coding-guidelines)
- [Adding a new LLM provider](#adding-a-new-llm-provider)
- [Reporting security issues](#reporting-security-issues)

---

## How to start

```bash
git clone https://github.com/Loxia-ai/onbuzz-community.git
cd onbuzz-community
npm install --legacy-peer-deps
npm run build:web-ui          # only needed if you change the React UI
node bin/cli.js web           # boots the local server + opens the browser
```

You'll need **Node.js ≥ 20**. macOS, Linux, and Windows are all supported.

To run the test suite:

```bash
NODE_OPTIONS='--experimental-vm-modules' npm test
```

To run a single test file:

```bash
NODE_OPTIONS='--experimental-vm-modules' npx jest src/services/providers/__tests__/providers.contract.test.js
```

If something doesn't build or tests don't run, **that itself is worth filing as an issue** — the install and dev-loop should be smooth, and a stumble in your first 30 minutes is a real signal we want to fix.

### Architecture quick tour

So you know where things live before you start hunting:

| Path | What's there |
|---|---|
| `src/index.js` | Application entry — wires every component together. Read it first. |
| `src/core/` | Orchestrator, agent pool, scheduler, message processor, flow executor. The "brain". |
| `src/services/aiService.js` | Dispatcher that routes a chat request to the right provider. |
| `src/services/providers/` | One adapter per LLM vendor (`openaiProvider.js`, `anthropicProvider.js`, etc.) — see [`docs/PROVIDERS.md`](./docs/PROVIDERS.md). |
| `src/tools/` | Agent-facing tools. Each extends `BaseTool` and is registered in `src/index.js`. |
| `src/interfaces/webServer.js` | Express + WebSocket server backing the web and terminal UIs. |
| `web-ui/` | React frontend (Vite). |
| `config/` | Default JSON manifests (models, benchmarks). User-overridable. |
| `.github/workflows/` | CI: builds binaries + installers + Electron app on tag pushes. |

---

## How to submit a PR

We aim to keep this lightweight. Concretely:

1. **Open an issue first** for anything bigger than a one-liner. Saves you from writing code in a direction we'd ask to rework. Link to the issue in your PR description.
2. **One concern per PR.** A bug fix and a refactor are two PRs. Reviewers can land focused changes faster.
3. **Tests for new logic.** If you add a feature or fix a bug, add a test that would have failed before your change. Exception: pure UI layout / styling tweaks.
4. **Keep diffs small.** Sub-200-line PRs ship in days; 2000-line PRs ship in months. If your change must be big, split it into a stack.
5. **Check before you push.**
   ```bash
   NODE_OPTIONS='--experimental-vm-modules' npm test
   npm run lint
   npm run build:web-ui      # if you touched the UI
   ```
6. **Write a useful PR description.** Include:
   - What problem this solves (link the issue).
   - What you changed and why this approach.
   - How you tested it (commands you ran, behaviors you verified).
   - Anything you're unsure about — call it out.

We use **squash merges**, so your commit history within a PR doesn't need to be pristine. The PR title becomes the merge commit message — make it descriptive (`fix: anthropic provider drops temperature for opus-4-7+`, not `fix bug`).

---

## What we're looking for

We welcome contributions in any of these areas:

### 🛠 Provider adapters & LLM coverage
- New native providers (DeepSeek, Mistral, Cohere, Perplexity, etc.)
- Better classification of which models support which features (vision, tools, reasoning)
- Tighter handling of vendor-specific quirks (rate limits, parameter differences, deprecation)
- Support for vendor APIs we don't yet wrap (OpenAI Responses API for `gpt-5-pro`, Anthropic batch, Gemini Live, etc.)

### 🧰 Agent tools
- New tools that fit our charter: local-first, no required cloud service, useful to a real software workflow.
- Hardening existing tools (better error messages, edge case handling, more tests).
- Per-tool configurators (the React panels in `web-ui/src/components/toolConfig/`).

### 🎨 Web UI improvements
- Onboarding polish (the first 60 seconds matter most).
- Accessibility — keyboard navigation, screen reader labels, focus traps in modals.
- Dark mode and theme refinements.
- Better model picker, agent management, flow editor UX.

### 📚 Documentation & examples
- Provider setup guides for vendors we don't cover yet.
- "Build X in OnBuzz" tutorials — long-form examples are gold.
- Skill examples in the `skills/` directory.
- Diagrams of the architecture, scheduler behavior, etc.

### 🐛 Bug fixes
- Crash reports, regressions, broken edge cases — anything filed in the issue tracker.
- Tests that pin down behavior we currently rely on but don't verify.
- Performance issues you've actually measured (not premature optimization).

### 🤝 First-time contributors
We mark issues as **`good first issue`** when they're scoped tightly enough to land in a single sitting. See [`docs/GOOD_FIRST_ISSUES.md`](./docs/GOOD_FIRST_ISSUES.md) for the current curated list.

### What we're NOT looking for

To save you time, here's what we'll likely close:

- **Anything that adds a required cloud dependency.** OnBuzz Community is local-first by design. Optional integrations are fine; required server-side services are not.
- **Telemetry or analytics that phone home.** Even opt-in. The product promise is privacy.
- **Refactors without a stated motivation.** "I rewrote this to be cleaner" is hard to review. "I rewrote this because X bug class is impossible to express in the current shape" is reviewable.
- **Speculative abstractions.** Add the abstraction when the third user appears, not the first.

---

## Coding guidelines

These are loose. The code already exists; match its tone.

- **ES modules, no TypeScript.** JSDoc comments on public functions are appreciated.
- **Comments explain "why", not "what".** Identifier names already explain "what". Comments earn their keep when the reasoning is non-obvious.
- **Don't add error handling for impossible states.** Trust internal calls. Validate at boundaries (user input, network responses).
- **No emojis in code.** They're fine in user-facing strings if requested, but don't decorate identifiers.
- **Tests:** unit tests in `__tests__` directories next to the code they exercise. Integration / e2e tests use the `.e2e.test.js` suffix and live in the same place.

---

## Adding a new LLM provider

The fastest path to land a new provider is:

1. Read [`src/services/providers/baseProvider.js`](./src/services/providers/baseProvider.js) — that's the contract.
2. Pick a similar existing adapter as a starting point (`anthropicProvider.js` for non-OpenAI-compatible APIs, `xaiProvider.js` for OpenAI-compatible).
3. Implement at minimum: `id`, `matchesModel`, `sendMessage`, `sendMessageStream`. Optional: `listModels`, `isAvailable`, `_classifyModel`.
4. Translate the canonical request shape (system + messages + tools + options) to the vendor's API; translate streaming events back to canonical `{content, reasoning, usage, finishReason, toolCalls}`.
5. Register the new adapter in [`src/services/providers/index.js`](./src/services/providers/index.js).
6. Add contract tests to [`src/services/providers/__tests__/providers.contract.test.js`](./src/services/providers/__tests__/providers.contract.test.js).

[`docs/PROVIDERS.md`](./docs/PROVIDERS.md) goes deeper on per-vendor specifics.

---

## Reporting security issues

Please don't file a public GitHub issue for security vulnerabilities. Email **`contact@loxia.ai`** instead. We aim to acknowledge within two business days and ship a fix or workaround as quickly as the severity warrants.

---

## License

By contributing, you agree your contributions are licensed under [Apache-2.0](./LICENSE), the same license as the rest of the project.
