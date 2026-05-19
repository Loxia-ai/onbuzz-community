<div align="center">

# OnBuzz Community

**Run a fleet of autonomous AI agents on your own machine.**

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg?style=flat-square)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen.svg?style=flat-square)](https://nodejs.org)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg?style=flat-square)](./CONTRIBUTING.md)

### 🌐 **[onbuzz.loxia.ai](https://onbuzz.loxia.ai)** &nbsp;·&nbsp; 🎓 **[Training](https://onbuzz.loxia.ai/training)** &nbsp;·&nbsp; 🗺 **[Roadmap & task board](https://roadmap.onbuzz.loxia.ai/)**

**👉 New here? Start with the [official site](https://onbuzz.loxia.ai) and the [training program](https://onbuzz.loxia.ai/training).**
**👉 Want to contribute? Check the [public roadmap](https://roadmap.onbuzz.loxia.ai/) for open tasks.**

[Quick Start](#-quick-start) · [What it does](#-what-it-does) · [Why it's different](#-why-its-different) · [Use cases](#-example-use-cases) · [Contribute](#-contributing)

</div>

---

> ## 🎯 Where to go first
>
> | | |
> |---|---|
> | 🌐 **Official site** | **[onbuzz.loxia.ai](https://onbuzz.loxia.ai)** — downloads, news, showcase |
> | 🎓 **Training** | **[onbuzz.loxia.ai/training](https://onbuzz.loxia.ai/training)** — learn how to drive a fleet of agents end-to-end |
> | 🗺 **Roadmap & task board** | **[roadmap.onbuzz.loxia.ai](https://roadmap.onbuzz.loxia.ai/)** — what's planned, in flight, and open for contributors |
> | 📦 **Releases** | **[github.com/Loxia-ai/onbuzz-community/releases](https://github.com/Loxia-ai/onbuzz-community/releases)** — installers, binaries, and Electron desktop apps |
>
> **If you're trying OnBuzz for the first time**, go to **[onbuzz.loxia.ai/training](https://onbuzz.loxia.ai/training)**. The training walks you through your first agent, your first flow, and your first multi-agent collaboration in under 30 minutes.
>
> **If you want to contribute**, head to **[roadmap.onbuzz.loxia.ai](https://roadmap.onbuzz.loxia.ai/)** to find a task to claim, then read [CONTRIBUTING.md](./CONTRIBUTING.md) for the workflow.

---

## What it does

OnBuzz Community is an open-source platform for **running and orchestrating multiple AI agents locally**. Each agent has its own workspace, tools, and conversation history, and they can talk to each other to solve bigger problems together.

It's the same engine that powers Loxia's commercial Autopilot product, re-released under Apache-2.0 with **all server dependencies removed**. You bring your own provider keys; OnBuzz talks to OpenAI / Anthropic / Gemini / xAI / Ollama directly. Nothing flows through anyone else's servers.

It runs as a local app with two interfaces:
- A **web UI** in your browser (the default) — chat, agent management, flows, scheduled tasks.
- A **terminal UI** — the same thing in a TUI for keyboard-driven workflows.

---

## Why it's different

Most "AI assistant" tools are either a single chat window with a prompt, or a closed cloud product where your data lives on someone else's infrastructure. OnBuzz Community is built on three opinionated choices:

**1. Local-first and zero-cloud by design.**
There is no central backend. There is no telemetry. Your conversations, agents, attachments, and credentials live in `~/.local/share/onbuzz` (or your platform's equivalent). Disconnect your machine from the internet and Ollama-backed agents keep working.

**2. Multi-agent, not single-chat.**
Agents are first-class. Each has a name, a system prompt, a working directory, and a configurable subset of tools. A "Coder" agent and a "Reviewer" agent can collaborate on the same repo in parallel, send each other messages, hand off tasks, and you can watch the whole thing run.

**3. Bring your own keys, plug in any provider.**
Five providers ship out of the box — OpenAI, Anthropic, Gemini, xAI, and Ollama. You can also wire any OpenAI-compatible endpoint (OpenRouter, Together, Fireworks, Groq, vLLM, LiteLLM, Azure OpenAI, self-hosted vLLM…) with a base URL and a key. The model catalog is auto-discovered from each vendor's `/models` endpoint, so new releases show up automatically.

It also ships with **20+ built-in agent tools** for real software work:

| | |
|---|---|
| **Code & files** | terminal, filesystem, file tree, code search (seek), file content replace |
| **Code analysis** | import analyzer, dependency resolver, static analysis (ESLint/Prettier/TS/Stylelint), clone detection, code map |
| **Web** | Puppeteer-driven browser, web fetch, scrape, screenshot |
| **Documents** | PDF, DOCX, XLSX read/write |
| **Coordination** | task manager, agent-to-agent messaging, agent delays, job-done signaling |
| **Authoring** | persistent memory, skills (reusable agent recipes), user prompts, visual editor |
| **Integrations** | Discord / Telegram / WhatsApp bridges (BYO bot tokens, all optional) |
| **Scheduling** | cron-like recurring tasks and flow runs |

---

## 🚀 Quick start

> 💡 **Prefer a guided walkthrough?** The **[training program at onbuzz.loxia.ai/training](https://onbuzz.loxia.ai/training)** runs you through these steps with screen recordings, troubleshooting tips, and recipe templates. Recommended for first-time users.

### 1. Install

```bash
npm install -g onbuzz-community
```

Or grab a pre-built installer / binary from **[github.com/Loxia-ai/onbuzz-community/releases](https://github.com/Loxia-ai/onbuzz-community/releases)** (Windows, macOS, Linux — CLI, native installer, or Electron desktop app).

(Requires Node.js ≥ 20 if installing via npm.)

### 2. Add a provider key

Either:
- Run `onbuzz web`, open Settings, paste a key from any of: OpenAI / Anthropic / Gemini / xAI; **or**
- Install [Ollama](https://ollama.com) and `ollama pull llama3.1:8b` for fully-offline use (no key needed).

### 3. Start chatting

```bash
onbuzz web
```

Your browser opens, you create your first agent, send a message — done. From there you can spin up more agents, give them their own working directories, and let them collaborate.

> Prefer the terminal? `onbuzz plus-terminal` starts the server and a TUI together.

---

## 💡 Example use cases

People use OnBuzz Community for things like:

- **Coding tasks at scale** — give an agent a repo and a goal ("audit my dependencies for vulnerabilities and open PRs") and let it work autonomously while you do something else.
- **Research workflows** — multi-agent flows where one agent gathers sources, another summarizes, another fact-checks.
- **Document pipelines** — extract structured data from a folder of PDFs, generate Excel reports, write a DOCX summary.
- **Personal knowledge work** — long-running agents with persistent memory that learn your preferences and codebase over weeks.
- **Bot orchestration** — wire agents to Discord/Telegram/WhatsApp so your team or community can address them naturally.
- **Local privacy-first AI** — using Ollama, run everything on your laptop. Sensitive client work never leaves the machine.
- **Provider experimentation** — run the same prompt across GPT-5, Claude Opus, Gemini, Grok, and a local Llama in parallel. Compare cost, latency, quality.

---

## 🧱 Repository structure

```
onbuzz-community/
├── bin/                    CLI entry point (the `onbuzz` command)
├── config/                 Default model + benchmark manifests (override-friendly)
├── docs/                   Provider setup, architecture, contribution guides
├── electron/               Optional Electron desktop app shell
├── installer/              NSIS / PKG / DEB installer scripts
├── scripts/                Build + maintenance helpers
├── skills/                 Bundled example skills (e.g. web-game-dev)
├── src/
│   ├── core/               Orchestrator, agent pool, scheduler, flow executor
│   ├── interfaces/         HTTP/WebSocket server + terminal UI client
│   ├── services/
│   │   ├── providers/      LLM provider adapters (one per vendor)
│   │   ├── aiService.js    Dispatcher that routes to providers
│   │   └── …               Models, benchmarks, scheduling, memory, etc.
│   ├── tools/              Agent-facing tools (terminal, filesystem, web, …)
│   └── utilities/          Shared helpers
├── web-ui/                 React frontend (Vite-built)
└── .github/                CI workflows + issue templates
```

The high-level flow is: **Web/Terminal UI** → WebSocket → **Orchestrator** → **Agent Pool & Scheduler** → **Message Processor** → **AIService** → **Provider Registry** → vendor API.

---

## 🔧 Configuration

Most things just work. A few env vars are useful:

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `XAI_API_KEY` | Provider keys (or paste in Settings UI) |
| `OLLAMA_HOST` | Ollama daemon URL (default `http://127.0.0.1:11434`) |
| `LOXIA_PORT` / `LOXIA_HOST` | Web server port and host |
| `LOXIA_LOG_LEVEL` | `debug` / `info` / `warn` / `error` |
| `LOXIA_MODELS_PATH` | Override the default model manifest with a custom JSON file |
| `LOXIA_BENCHMARKS_PATH` | Override the routing-benchmark text |

User overrides also work without env vars: drop `~/.onbuzz/models.json` or `~/.onbuzz/benchmarks.json` and OnBuzz will pick them up.

For per-provider details (auth headers, special models, OpenAI-compatible custom endpoints), see [`docs/PROVIDERS.md`](./docs/PROVIDERS.md). For the built-in task, message, delay, and completion flow agents use to coordinate, see [`docs/AGENT_COORDINATION.md`](./docs/AGENT_COORDINATION.md).

---

## 🤝 Contributing

OnBuzz Community is open to contributions of every size — bug fixes, new tools, new provider adapters, docs, examples, or "I tried this and the install was confusing" feedback.

**The contribution path:**
1. **Find a task** on the **[public roadmap & task board](https://roadmap.onbuzz.loxia.ai/)**, or browse the [12-week dev program](./docs/COMMUNITY_PROGRAM.md).
2. **Claim it** by commenting on the linked issue.
3. **Read [CONTRIBUTING.md](./CONTRIBUTING.md)** for the full workflow — fork → branch → PR → review → squash-merge, with details on branch naming, Conventional Commits, rebasing, and code-review etiquette.

Looking for a first thing to work on? Our **[12-week community program](./docs/COMMUNITY_PROGRAM.md)** is a menu of 48 fully-specified tasks — each with context, a definition-of-done, deliverables, and pointers into the codebase. Daily tasks are sized for a single sitting; weekly capstones are larger pieces of work. Audience tracks span developers, designers, writers, QA, security, DevOps, data scientists, localizers, DevRel, accessibility advocates, visual designers, and domain experts.

Not a developer? Your domain knowledge is exactly what we need. **[`docs/RECIPES_BY_FIELD.md`](./docs/RECIPES_BY_FIELD.md)** has a deep menu of contribution ideas for teachers, clinicians, accountants, content creators, novelists, real estate agents, lawyers, restaurant owners, GMs, and many more — none of which require writing code.

If you find a security issue, please don't file a public issue — email `contact@loxia.ai` instead.

---

## 🔒 Privacy

- **Local-first** — your conversation history, agent state, attachments, and all generated artifacts stay on your machine.
- **No telemetry** — OnBuzz Community does not phone home. The only outbound network calls are to the LLM provider you configure.
- **Encrypted credentials** — API keys are stored AES-256-GCM-encrypted under your user-data directory, derived from a machine-specific identifier.
- **Easy reset** — delete the user-data directory to wipe all local state.

---

## 📄 License

[Apache License 2.0](./LICENSE) — see also [NOTICE](./NOTICE).

Copyright © 2025–2026 Loxia Labs LLC and OnBuzz Community contributors.

OnBuzz Community is forked from the proprietary Loxia Autopilot codebase. The commercial Autopilot product continues separately, with hosted models, a marketplace, and managed updates. If you want those things, see [autopilot.loxia.ai](https://autopilot.loxia.ai). If you want to run agents yourself, with your keys, on your hardware, with full source access — you're in the right place.

---

<div align="center">

### 🌐 **[onbuzz.loxia.ai](https://onbuzz.loxia.ai)** &nbsp;·&nbsp; 🎓 **[Training](https://onbuzz.loxia.ai/training)** &nbsp;·&nbsp; 🗺 **[Roadmap](https://roadmap.onbuzz.loxia.ai/)** &nbsp;·&nbsp; 📦 **[Releases](https://github.com/Loxia-ai/onbuzz-community/releases)**

**Made with care, shipped under Apache-2.0.**
[Discussions](https://github.com/Loxia-ai/onbuzz-community/discussions) · [Issues](https://github.com/Loxia-ai/onbuzz-community/issues) · [Provider docs](./docs/PROVIDERS.md)

</div>
