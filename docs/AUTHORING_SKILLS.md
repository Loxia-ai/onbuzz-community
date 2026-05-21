# Authoring Great Skills

This is the Week 10 reference for writing skill PRs that stay easy to review and practical to run.

## Why this exists

We now have a shared workflow: contributors add reusable agent recipes, not one-off prompts.

Current repo behavior:

- Each skill is a directory under `skills/`.
- `skill.md` is the required runtime file.
- Additional files are allowed and indexed, but runtime prompts are injected from `skill.md` only.
- Frontmatter and headings are parsed to build the skill list preview.

See `src/services/skillsService.js` and `src/interfaces/webServer.js` for behavior details.

## Current required shape vs. Week 10 target

### Required today

- `skill.md` (must exist)
  - file name and structure come from existing bundled skill `skills/web-game-dev/skill.md`
  - use frontmatter:
  - keep first non-heading paragraph meaningful (it becomes fallback description)
  - use clear `##` sections so `read-section` works well

Example anchor:

```md
---
name: web-game-dev
description: Step-by-step guidance for designing, optimizing and deploying modern browser-based games and game-like applications.
---

# Web Game Development

This skill helps the agent support developers in building...
```

### Target shape for Week 10 skill PRs

For consistency with `docs/COMMUNITY_PROGRAM.md`, each new skill PR should include:

- `README.md` — audience, usage, constraints, failure modes
- `SYSTEM_PROMPT.md` — role behavior, workflow, output shape, refusal policy
- `TOOL_CONFIG.json` — suggested tool flags/settings (JSON, reviewed manually)
- `EXAMPLE_CONVERSATION.md` — realistic transcript showing expected usage

- Example references: use `skills/web-game-dev/skill.md` as the current shipped anchor today.
  - As more skills land, add those examples to your local workflow and this doc.
- Add the four files as part of the PR so review isn’t blocked on missing supporting material.

## Anatomy of a good skill

### 1) README.md

Use plain contributor-facing language:

- Who is this for?
- What inputs does this skill expect?
- What will it produce?
- When should you not use it?
- Privacy and risk notes for sensitive domains.

Model this after the current example’s clarity (`skills/web-game-dev/skill.md`): explicit sections, practical bullets, concrete output expectations.

### 2) SYSTEM_PROMPT.md

Goal: behavior-level instructions, not slogan-level confidence.

- Start with role + boundary.
- Define the workflow in numbered or checklist steps.
- State the exact outputs (format, tone, constraints).
- Include what the agent must refuse or escalate.
- Keep it short where possible, specific where required.

Avoid:

- "You are an expert at..." as filler
- vague output promises without steps
- unsafe or high-risk instructions
- copying whole tool docs into the prompt

### 3) TOOL_CONFIG.json

Keep this as a concise recommendation map for what tools the recipe should start with:

- explicit tools to enable
- minimal tool settings per domain (e.g. readonly file patterns, allowed domains, timeout hints)
- rationale for each non-default setting

Keep keys simple and readable. The app doesn’t enforce a strict schema for this file yet; reviewer and maintainer should validate it manually.

### 4) EXAMPLE_CONVERSATION.md

Show the skill in action:

- 2–6 turns of realistic user/agent chat
- one success path, optionally one guardrail/path
- expected outputs in the same style as users will actually read
- no synthetic "perfect world" assumptions

## Privacy and safety notes

For regulated or personal domains, include explicit guardrails:

- no medical diagnosis/therapy replacement (healthcare recipes)
- no financial advice without explicit human judgment framing
- sensitive data should stay local when possible

If in doubt, mirror safety patterns from `docs/RECIPES_BY_FIELD.md` before draft.

## PR checklist (copy/paste)

Use this in your PR description.

- [ ] Skill folder is under `skills/<kebab-case-name>/` and follows required shape.
- [ ] `skill.md` uses frontmatter (`name`/`description`) and has consistent `##` sections.
- [ ] README covers audience, scope, outputs, and non-goals.
- [ ] `SYSTEM_PROMPT.md` has a refusal policy and explicit output constraints.
- [ ] `TOOL_CONFIG.json` is valid JSON and maps cleanly to chosen tool behavior.
- [ ] `EXAMPLE_CONVERSATION.md` is realistic and shows a failure/guardrail case if applicable.
- [ ] Sensitive-domain skills include safety text aligned with `docs/RECIPES_BY_FIELD.md`.
- [ ] PR includes local verification that the doc file set exists and matches the intended task in `docs/COMMUNITY_PROGRAM.md`.
