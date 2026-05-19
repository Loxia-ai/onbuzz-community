# Contributing to OnBuzz Community

Thanks for being here. **Your first PR can land this week.** This doc is short on purpose — read it once, then send code.

> ## 🚦 Start here
>
> | | |
> |---|---|
> | 🗺 **Roadmap & task board** | **[roadmap.onbuzz.loxia.ai](https://roadmap.onbuzz.loxia.ai/)** — pick a task, claim it, ship it |
> | 🌐 **Project site** | **[onbuzz.loxia.ai](https://onbuzz.loxia.ai)** |
> | 🎓 **Training** | **[onbuzz.loxia.ai/training](https://onbuzz.loxia.ai/training)** — recommended for first-timers |
> | 🛠 **Tool reference** | **[docs/TOOL_REFERENCE.md](./docs/TOOL_REFERENCE.md)** — quick schema + parameter reference for core tools |
> | 📅 **12-week dev program** | [`docs/COMMUNITY_PROGRAM.md`](./docs/COMMUNITY_PROGRAM.md) — 48 ready-to-claim tasks |
> | 💬 **Discussions** | [github.com/Loxia-ai/onbuzz-community/discussions](https://github.com/Loxia-ai/onbuzz-community/discussions) |

## Contents

- [Run it locally](#run-it-locally)
- [The PR workflow](#the-pr-workflow)
- [Branches and commit messages](#branches-and-commit-messages)
- [Code review](#code-review)
- [Pre-flight checklist](#pre-flight-checklist)
- [What we're looking for](#what-were-looking-for)
- [Coding guidelines](#coding-guidelines)
- [Adding a new LLM provider](#adding-a-new-llm-provider)
- [Reporting security issues](#reporting-security-issues)

---

## Run it locally

```bash
git clone https://github.com/Loxia-ai/onbuzz-community.git
cd onbuzz-community
npm install --legacy-peer-deps
node bin/cli.js web        # boots the local server + opens the browser
```

Requires **Node.js ≥ 20**. macOS, Linux, Windows all supported.

```bash
NODE_OPTIONS='--experimental-vm-modules' npm test                 # full suite
NODE_OPTIONS='--experimental-vm-modules' npx jest <file>          # single file
npm run lint                                                       # ESLint
npm run build:web-ui                                               # if you touched the UI
```

If something doesn't build or tests don't run, **that's worth filing as an issue** — your first 30 minutes should be smooth.

### Where things live

| Path | What's there |
|---|---|
| `src/index.js` | Application entry — read it first |
| `src/core/` | Orchestrator, agent pool, scheduler, flow executor |
| `src/services/aiService.js` | Provider dispatcher |
| `src/services/providers/` | One adapter per LLM vendor — see [`docs/PROVIDERS.md`](./docs/PROVIDERS.md) |
| `src/tools/` | Agent-facing tools (each extends `BaseTool`) |
| `src/interfaces/webServer.js` | Express + WebSocket server |
| `web-ui/` | React frontend (Vite) |
| `config/` | Default JSON manifests (models, benchmarks) |

---

## The PR workflow

We use **GitHub Flow**: fork → feature branch → PR → review → squash-merge. `main` is always shippable. There is no `develop` branch.

### 1. Pick or claim a task

Browse **[roadmap.onbuzz.loxia.ai](https://roadmap.onbuzz.loxia.ai/)** for cards labeled **"Open for contributors"** or **"Help wanted"**, or pick a task from [`docs/COMMUNITY_PROGRAM.md`](./docs/COMMUNITY_PROGRAM.md). Comment on the linked issue to claim it.

Have your own idea? **One-liner fixes** (typo, broken link): just open the PR. **Anything bigger**: open an issue first using the [Contribution idea](https://github.com/Loxia-ai/onbuzz-community/issues/new?template=contribution_idea.yml) template — saves you from building in a direction we'd ask to rework.

### 2. Fork, branch, build

```bash
# Fork on GitHub, then:
git clone git@github.com:<you>/onbuzz-community.git
cd onbuzz-community
git remote add upstream https://github.com/Loxia-ai/onbuzz-community.git

git checkout -b feat/deepseek-provider     # see naming below
# ... make small, focused commits, with tests for new logic ...
```

**One concern per PR.** A fix and a refactor are two PRs.
**Tests for new logic.** Add a test that would have failed before your change.
**Keep diffs small.** Sub-200-line PRs ship in days; 2000-line PRs ship in months — split big work into a stack.

### 3. Stay current with `main` — rebase, don't merge

```bash
git fetch upstream
git rebase upstream/main
git push --force-with-lease    # NEVER plain --force
```

`--force-with-lease` refuses to overwrite work someone else pushed (e.g. a maintainer adding a fixup). Plain `--force` will silently nuke it.

### 4. Open the PR

Push your branch and open the PR against `Loxia-ai/onbuzz-community:main`. **Use Draft mode** while iterating; flip to Ready when you'd like a review.

A useful PR description has four lines:
- **Problem** — link the issue (`Closes #123`).
- **Approach** — what you changed and why.
- **How tested** — commands you ran, behaviors you verified.
- **Open questions** — things you're unsure about. Reviewers love specifics.

For UI changes: include before/after screenshots or a short recording.

### 5. Pass CI

Every PR runs tests + lint + builds. **Don't ask for review until CI is green.** A red CI is a hard blocker.

### 6. Address review, then merge

- Reply to each thread, even if just "Done".
- Push **fixup commits** instead of force-pushing — easier for reviewers to see what changed. We squash on merge anyway.
- Disagree politely if you think a comment is wrong; reviewers can be wrong.
- Click **"Re-request review"** after pushing changes (reviewers don't watch every push).
- A maintainer **squash-merges** when the PR is ready. The PR title becomes the commit message — make it [Conventional Commits](#branches-and-commit-messages)-shaped.

---

## Branches and commit messages

**Branch names**: `<type>/<short-kebab-summary>` — e.g. `feat/deepseek-provider`, `fix/anthropic-temperature-opus-4-7`.

**PR titles** follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <imperative summary>`.

| Prefix | When | Example PR title |
|---|---|---|
| `feat` | New user-visible capability | `feat(providers): add DeepSeek native adapter` |
| `fix` | Bug fix | `fix(anthropic): drop temperature for opus-4-7+` |
| `docs` | Docs only | `docs(providers): document gemma-* matcher` |
| `refactor` | Shape change, no behavior change | `refactor(scheduler): event-driven trigger` |
| `test` | Tests only | `test(providers): contract tests for streaming` |
| `chore` | Tooling, deps, CI | `chore(deps): upgrade vite to 7` |
| `perf` | Performance improvement | `perf(flow): cache resolved edge IDs` |

In-PR commits during development can be loose — they get squashed.

For **breaking changes**, add `!` and a footer:
```
feat(providers)!: rename matchesModel to matches

BREAKING CHANGE: Custom adapters must rename `matchesModel` to `matches`.
```

Use `Closes #123` to auto-close the issue, or `Refs #123` to just link.

---

## Code review

We aim for **kind, specific, fast**. Reviews are about the code, not the contributor.

**As a contributor:** push back if you think a reviewer is wrong — silent capitulation isn't useful. If you'll be slow to respond, post a "back to this Friday" note so the PR doesn't look abandoned.

**As a reviewer:** be specific. Label comments **must-fix**, **should-fix**, or **nit** so the contributor knows what blocks merge. Approve when it's good enough to ship — perfection blocks more contributors than it helps.

**Maintainer SLA:** first response on a new PR within **5 business days**, follow-ups within **3**. If we miss this, ping us in [Discussions](https://github.com/Loxia-ai/onbuzz-community/discussions) — that's on us.

---

## Pre-flight checklist

Before flipping the PR to Ready:

- [ ] Branch rebased on latest `upstream/main`
- [ ] `npm test`, `npm run lint`, `npm run build:web-ui` (if UI touched) all pass locally
- [ ] CI is green
- [ ] PR title is Conventional-Commits-shaped
- [ ] PR description: problem, approach, how-tested, open questions
- [ ] Issue linked (`Closes #N` or `Refs #N`)
- [ ] No drive-by formatting on untouched files
- [ ] Screenshots/recording for any UI change

---

## What we're looking for

### 🛠 Provider adapters & LLM coverage
- New native providers (DeepSeek, Mistral, Cohere, Perplexity, etc.)
- Better feature classification (vision, tools, reasoning support per model)
- Vendor-specific quirks: rate limits, parameter differences, deprecation
- APIs we don't yet wrap (OpenAI Responses API for `gpt-5-pro`, Anthropic batch, Gemini Live)

### 🧰 Agent tools
- New tools that fit the charter: local-first, no required cloud, useful to a real workflow
- Hardening existing tools (better errors, edge cases, more tests)
- Per-tool configurators in `web-ui/src/components/toolConfig/`

### 🎨 Web UI
- Onboarding polish (the first 60 seconds matter most)
- Accessibility — keyboard nav, screen reader labels, focus traps
- Dark mode and theme refinements
- Better model picker, agent management, flow editor

### 📚 Docs & examples
- Provider setup guides for vendors we don't cover yet
- "Build X in OnBuzz" tutorials — long-form examples are gold
- Skill examples in `skills/`
- Architecture diagrams

### 🐛 Bug fixes
- Anything in the issue tracker
- Tests that pin down behavior we rely on but don't verify
- Performance issues you've actually measured

### 🧰 Non-code contributions

If your background is teaching, healthcare, accounting, content creation, real estate, law, music, writing, office work, or any field that moves information for a living, your most valuable contribution is probably **not** JavaScript. It's an agent recipe that solves a workflow problem only someone in your field knows how to design.

We accept and actively want:
- **Skill PRs** — a reusable agent recipe in `skills/` (system prompt, suggested tools, example conversation). We'll help with the file format.
- **Prompt libraries** — `.md` files of system-prompt variations for one workflow.
- **Workflow case studies** — "I'm a [profession], here's how I use OnBuzz daily."
- **Video walkthroughs** — 3–10 minute screen recordings.
- **Translations** — UI, errors, docs into your native language.
- **Tool wishlists** — "this would help my field but doesn't exist yet."

See [`docs/RECIPES_BY_FIELD.md`](./docs/RECIPES_BY_FIELD.md) for a deep menu by profession (education, healthcare, accounting, books, music, real estate, legal, nonprofit, research, creative fields), with safety/privacy notes for sensitive domains.

### What we'll close

- **Required cloud dependencies.** Local-first is the product promise.
- **Telemetry that phones home.** Even opt-in.
- **Refactors without a stated motivation.** "I rewrote this to be cleaner" is hard to review.
- **Speculative abstractions.** Add the abstraction when the third user appears.

---

## Coding guidelines

Loose. Match the tone of the existing code.

- **ES modules, no TypeScript.** JSDoc on public functions is appreciated.
- **Comments explain "why", not "what".** Names already explain "what".
- **Don't add error handling for impossible states.** Trust internal calls; validate at boundaries (user input, network).
- **No emojis in code.** Fine in user-facing strings, not in identifiers.
- **Tests** live in `__tests__/` next to the code; integration tests use the `.e2e.test.js` suffix.

---

## Adding a new LLM provider

1. Read [`src/services/providers/baseProvider.js`](./src/services/providers/baseProvider.js) — that's the contract.
2. Copy a similar adapter (`anthropicProvider.js` for non-OpenAI-shaped APIs, `xaiProvider.js` for OpenAI-compatible).
3. Implement: `id`, `matchesModel`, `sendMessage`, `sendMessageStream`. Optional: `listModels`, `isAvailable`, `_classifyModel`.
4. Translate the canonical request (system + messages + tools + options) to the vendor's API; translate streaming events back to `{content, reasoning, usage, finishReason, toolCalls}`.
5. Register in [`src/services/providers/index.js`](./src/services/providers/index.js).
6. Add contract tests in [`src/services/providers/__tests__/providers.contract.test.js`](./src/services/providers/__tests__/providers.contract.test.js).

Deeper detail: [`docs/PROVIDERS.md`](./docs/PROVIDERS.md).

---

## Reporting security issues

**Don't file a public issue.** Email **`contact@loxia.ai`** instead. We aim to acknowledge within two business days.

---

## License

By contributing, you agree your contributions are licensed under [Apache-2.0](./LICENSE).
