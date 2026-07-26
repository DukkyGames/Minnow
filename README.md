# Minnow

**Your local AI workspace. Chat, code, orchestration, and knowledge — nothing else in the way.**

Minnow is a free, open-source desktop workspace built around the models you already run — [LM Studio](https://lmstudio.ai/), Ollama, llama.cpp, or any OpenAI-compatible API. Chat on a calm desktop shell, open a full **Code** workspace when it is time to build, spin up **Orchestrator boards** for multi-agent delivery, and grow a **Brain** wiki that your agents can actually use.

Everything stays on your machine. Your keys, your chats, your files, your models.

> **Free forever, for everyone.** Minnow is AGPL-licensed open source. No subscriptions, no usage gates, no cloud lock-in.

<p align="center">
  <strong>📸 Hero image placeholder</strong><br>
  <em>Suggested shot: MinnowOS desktop — underwater wallpaper, dock with Code / Models / Brain / Research tiles, concierge composer centered, menubar model chip visible. Wide 16:9 crop.</em>
</p>

---

## Why Minnow

Most AI tools pick one job: a chat box, a coding agent, or a note app. Minnow is the **one shop** for serious local AI work — deliberately kept to a small set of surfaces that are actually finished.

| Principle | What it means |
|-----------|---------------|
| **Local-first** | Models run where you choose. State lives under `~/.minnow` on your disk. |
| **Privacy by design** | Encrypted secrets at rest. Nothing phones home except the providers you configure. |
| **Open source** | Inspect it, fork it, self-host it. [AGPL-3.0-or-later](LICENSE). |
| **Agent-native** | ~100 built-in tools, sub-agents, skills, boards, and modes — not bolted on after the fact. |
| **Calm UX** | Instrumentation, not dashboards. Readable chat, compact metrics, task-focused chrome. |
| **Small on purpose** | Eight apps, all finished, all always on. Half-built surfaces stay behind a release gate instead of shipping. |

### What ships today

Minnow's surface is **stripped back to the build loop**: the desktop shell plus seven apps — **Code**, **Chat**, **Research**, **Models**, **Brain**, **Issues**, and **Scheduler** (plus Settings). All of them are always on; there is nothing optional to configure.

Experimental surfaces (Compare, Bench, Experts, Calendar, Email) still live in the repo but are **release-gated off** — they do not appear in the dock, onboarding, Settings, shortcuts, or agent tool catalogs, and the tools bound to them are hidden with them. The Reef mini-app runtime was removed entirely.

---

## Quick start

```bash
git clone https://github.com/DukkyGames/Minnow.git
cd Minnow
npm install
npm start
```

Load a model in LM Studio (or point Minnow at your provider), then open the desktop window. Full setup, commands, packaging, and troubleshooting: **[Getting started](documentation/getting-started.md)**. Packaged installs auto-update from [GitHub Releases](https://github.com/DukkyGames/Minnow/releases) — check status under Settings → General → App updates.

---

## Code workspace

The **Code** app is Minnow's centre of gravity — an IDE-style workspace wrapped in MinnowOS, not a separate tool. Everything else in the product exists to feed it.

<p align="center">
  <strong>📸 Code workspace image placeholder</strong><br>
  <em>Suggested shot: Code app fullscreen — file tree left, CodeMirror editor center with syntax highlighting, chat sidebar right, integrated terminal docked below. Show a real project file open.</em>
</p>

**What you get**

- **File tree + editor** — CodeMirror 6 with LSP diagnostics, go-to-definition, autocomplete, folding, and find/replace.
- **AI in the editor** — inline ghost-text completion, Quick Edit (Mod-K), and Intent mode for plain-language edits.
- **Chat beside your code** — workspace-scoped sessions, streaming markdown, tool calls with approval gates, context usage ring beside Send.
- **Integrated terminal** — xterm.js PTY tabs wired to the same workspace root as file/git tools.
- **Git-aware** — status, graph, commits; orchestrator boards can initialize repos and merge isolated worktrees when you ship in parallel.
- **Code map** — open Brain's symbol graph inside Code without leaving the app (repo map, find symbol, call graph).
- **Dev servers** — start, watch, and read logs for project dev servers from inside Code.
- **Four composer modes** — General, Build, Plan, Debug — plus **Orchestrate** from the hub and **Super Plan** as a Plan sub-mode. Each has tuned prompts and tool policy.

Open Code from the dock, pick a project folder, and the agent layer has the same filesystem, terminal, LSP, browser preview, and MCP tools you would expect from a dedicated coding agent — except it shares memory, Brain, and orchestration with the rest of Minnow.

---

## Orchestrator boards

Turn a plan into a kanban delivery line. **Orchestrator boards** are Minnow's headline feature for multi-step software work.

<p align="center">
  <strong>📸 Orchestrator board image placeholder</strong><br>
  <em>Suggested shot: Kanban board view — wave columns (Plan / Run / Test / Done), task cards with agent badges, autonomy control (Manual → Sequential → Auto → AFK), running-tasks strip at top. Show a board mid-run.</em>
</p>

**The flow**

1. **Write a plan** — save markdown under `documentation/plans/`, or use **Super Plan** (below).
2. **Open the Orchestrate hub** — sidebar footer or plan screen → **Start Orchestrator**.
3. **Board init** — the planner parses your plan into waves and tasks (`board_init`).
4. **Execute** — Builder and Tester work agents run in linked task chats; you drive manually or flip autonomy to Auto / AFK.
5. **Ship** — per-task git worktrees merge into an integration branch; finish dashboard helps commit, push, and open a PR.

**Autonomy modes**

| Mode | Behavior |
|------|----------|
| **Manual** | You start tasks, run tests, and move cards. |
| **Sequential** | One task at a time, auto-advanced. |
| **Auto** | Parallel tasks up to your concurrency cap, with test + merge loops. |
| **AFK** | Full auto-pilot — self-heal, stall nudges, no user prompts. |

Boards support worktree isolation (parallel builders on separate branches), structured `board_report` verdicts, merge/env fixers, timeline logging, and notifications when tasks complete or stall.

---

## Super Plan

**Super Plan** is the guided planning pipeline — from a vague idea to a review-ready build spec and implementation plan, without writing code in Plan mode.

<p align="center">
  <strong>📸 Super Plan image placeholder</strong><br>
  <em>Suggested shot: Plan progress stepper — seven nodes (Interview → Spec → Research → Draft → Review → Polish → Final) with the Research stage showing a live feed. Centered plan-screen overlay in Code.</em>
</p>

Super Plan runs as a sub-mode under **Plan** (caret menu in the composer) or from the Orchestrate plan screen (**Start planning**).

| Stage | What happens |
|-------|----------------|
| **Interview** | Structured grill questions sharpen scope (`ask_question` cards). |
| **Spec** | Build spec written to `documentation/plans/references/…` — you confirm before research. |
| **Research** | Web and/or codebase research with a live progress panel. |
| **Draft + Review** | Two review rounds via a dedicated plan-reviewer sub-agent. |
| **Polish** | Optional Impeccable pass when the plan touches UI. |
| **Final** | Plan saved under `documentation/plans/` — then **Start Orchestrator**, **Build**, or revise. |

Plan mode is non-destructive: writes are guarded to `documentation/plans/` only. Super Plan settings (review rounds, research scope, per-stage models) live in **Settings → Modes → Super Plan**.

---

## Skills & tools

Minnow ships a deep agent layer out of the box — no MCP required to be productive.

<p align="center">
  <strong>📸 Skills & tools image placeholder</strong><br>
  <em>Suggested shot: Composer with slash-skill picker open, or Settings → Tools showing categorized toggles (files, git, web, agents, browser, LSP). Optional inset: a tool-call card in chat.</em>
</p>

### Built-in tools (~100)

OpenAI-style function calling across:

- **Files & git** — read, write, search, move, commit, branch operations (workspace-scoped by default).
- **Code & LSP** — diagnostics, symbols, repo map, `find_symbol`, `who_calls`.
- **Web** — search (Brave, Tavily, DuckDuckGo, or local SearXNG), fetch, deep research.
- **Agents** — spawn sub-agents, orchestrate boards (`board_*`), issues (`issue_*`), mode handoff, work-agent routing.
- **Browser** — CDP automation in the Electron preview panel (origin-allowlisted).
- **Productivity** — memory, Brain wiki, scheduler hooks.
- **Plugins** — drop-in local tools under `~/.minnow/tools/` without MCP.

Per-tool permissions: **Full**, **Ask**, or **Off**. Path policy keeps file/git tools inside your workspace unless you opt out. Tools bound to an app (calendar, mail) are hidden while that app is gated off, so the model never sees a tool it cannot use.

### Bundled skills (15) + Skills Library

Invoke with `/` in the composer. Bundled:

- **Core** — `git-commit`, `code-review`, `ask-user`, `debug-error`, `explain-code`, `docs-update`, `refactor-safe`, `security-review`, `write-tests`, `browser-automation`, `git-setup`, `ui-designer`.
- **Impeccable** — UI design shape/critique/polish workflow (vendored on install, on by default).
- **Caveman** — ultra-compressed replies when token budget matters.

Everything else is opt-in from **Settings → Integrations → Skills Library** — curated third-party `SKILL.md` packs (Matt Pocock's 19 skills, Addy Osmani, Superpowers, last30days, Browserbase) installed per-skill from pinned GitHub commits. Nothing large is bundled by default.

Add your own `SKILL.md` packs under `~/.minnow/skills/`. Post-turn synthesis can propose new memories and skills into a review queue — nothing auto-saves without your OK.

### Sub-agents & work agents

- **Sub-agents** — background specialists (researcher, plan-reviewer, fixers, …) with concurrency limits, live cards, and persisted runs.
- **Work agents** — composer-selectable personas (Builder, Tester, Planner, …) with per-agent model, sampler, and context budget bindings.

---

## Brain

**Brain** is Minnow's local knowledge engine — a markdown wiki your agents read and write, backed by semantic search and a code index.

<p align="center">
  <strong>📸 Brain image placeholder</strong><br>
  <em>Suggested shot: Brain app Graph view — force-directed wiki graph on dark sage theme, inspector panel open on a page with wikilinks and tags. Optional second inset: Code section with repo map.</em>
</p>

Stored at `~/.minnow/brain/` (CORTEX layout):

| Capability | Details |
|------------|---------|
| **Wiki pages** | Nested markdown + YAML frontmatter, wikilinks, ingest, lint, proposals queue. |
| **Semantic recall** | Hybrid keyword + vector retrieval (local `@xenova/transformers` or provider embeddings). |
| **Code index** | LSP-powered symbol graph — `repo_map`, `find_symbol`, `who_calls`, `explain_symbol`. |
| **Memory** | `save_memory` and the Memories section are thin adapters over Brain facts. |
| **Archive policy** | Stale chat turns can offload into Brain archive pages to free context window. |
| **Capture** | One-click **Add to Brain** from chat sessions and research reports. |

Open Brain from the dock (`#/app/brain`) — Graph, Edit, Code, Memories, Ingest, Settings, and more. The same graph is available inside Code via the **Code map** sidebar button.

---

## The rest of MinnowOS

The desktop shell (**MinnowOS**) launches a short list of focused apps from the dock. Every one of them is core — always installed, always on:

| App | Role |
|-----|------|
| **Chat** | Default desktop surface — concierge composer, session rail, notifications. |
| **Code** | The build workspace (above). |
| **Research** | Multi-step web research, saved library, discuss panel. |
| **Models** | Hardware fit scoring, Hugging Face downloads, local serve, provider routing. |
| **Brain** | Wiki, memory, and code index (below). |
| **Issues** | Linear-style issue tracking — list, board, quick capture, `issue_*` tools. |
| **Scheduler** | Recurring agent jobs while Minnow is open. |
| **Settings** | Appearance, tools, modes, skills, providers, integrations. |

That is the whole surface. There is no optional-app picker to work through: onboarding shows the core line and moves on.

**Behind the release gate:** Compare, Bench, Experts, Calendar, and Email still exist in the source tree but ship hidden — no dock tile, no route, no notifications, no tools. They come back one at a time, when each is genuinely done.

Tour: [`documentation/guides/apps.md`](documentation/guides/apps.md).

---

## Privacy & local-first

- **Your data, your disk** — chats, config, Brain, models, and encrypted secrets under `~/.minnow`.
- **Your models** — LM Studio, Ollama, self-hosted llama.cpp, or cloud APIs you explicitly configure.
- **Encrypted at rest** — provider keys and account passwords use AES-256-GCM (`~/.minnow/.key`).
- **LAN opt-in** — default is loopback-only; enable network access in Settings if you need it.
- **No silent exfiltration** — web search uses the provider you pick; untrusted content is fenced before it reaches prompts.

---

## Open source & free forever

Minnow is **[AGPL-3.0-or-later](LICENSE)** free software. Use it, study it, share it, modify it. If you run a modified version as a network service, share your source under the same license.

We intend to keep Minnow **free for everyone, forever** — funded by community support, not paywalls.

---

## Community & support

Minnow is built and maintained by a solo developer. If it helps you:

- ⭐ Star the repo
- 💬 Join [Discord](https://discord.gg/U4FPzv9K4X)
- ❤️ [Sponsor on GitHub](https://github.com/sponsors/DukkyGames)

Contributions welcome — issues, PRs, docs, and skills.

---

## Documentation

| Doc | Purpose |
|-----|---------|
| [Getting started](documentation/getting-started.md) | Install, commands, config, troubleshooting |
| [Apps tour](documentation/guides/apps.md) | MinnowOS apps walkthrough |
| [context.md](documentation/context.md) | Authoritative architecture & API reference |
| [AGENTS.md](AGENTS.md) | Notes for AI agents working in this repo |
| [PRODUCT.md](PRODUCT.md) | Product tone & principles |
| [DESIGN.md](DESIGN.md) | Visual design system |

A fuller wiki is planned — guides in [`documentation/guides/`](documentation/guides/) are the home for task docs until then.
