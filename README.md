# Minnow

**A free and open source AI workspace. Chat, code, plan, orchestrate, and remember — in one place, on your own machine.**

[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0--or--later-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/HenriGrimm/Minnow?include_prereleases)](https://github.com/HenriGrimm/Minnow/releases)
[![Discord](https://img.shields.io/badge/discord-join-5865F2)](https://discord.gg/U4FPzv9K4X)
[![Sponsor](https://img.shields.io/badge/sponsor-%E2%9D%A4-db61a2)](https://github.com/sponsors/HenriGrimm)

Minnow runs on the models you already have: [LM Studio](https://lmstudio.ai/), Ollama, llama.cpp, or any OpenAI-compatible endpoint. Your keys, chats, files, and models stay on your disk. Nothing is sent anywhere you did not configure yourself.

> **The mission:** put a complete AI workspace in the hands of everyone who builds, as free and open source software.
>
> Minnow is [AGPL-3.0-or-later](LICENSE). Free to use, study, change, and share — for any purpose, forever. No accounts, no subscriptions, no usage gates, no cloud you have to trust.

![Minnow desktop](documentation/images/hero.png)

---

## Quick start

```bash
git clone https://github.com/HenriGrimm/Minnow.git
cd Minnow
npm install
npm start
```

Load a model in LM Studio (or point Minnow at your provider), and the desktop window opens on `http://localhost:9473`. Full walkthrough: **[Setup from source](documentation/contributor/setup-from-source.md)**.

Prefer an installer? Packaged builds for Windows, macOS, and Linux are on [Releases](https://github.com/HenriGrimm/Minnow/releases), and they update themselves.

---

## Why Minnow

Most local-AI tools give you a chat box next to a model. Minnow gives you the whole loop — think it through, build it, delegate it, and keep what you learned — on one desktop, sharing one chat engine, one tool set, one session store, and one workspace.

- **It is a workspace, not a chat window.** Eight apps on one shell: Chat, Code, Research, Models, Brain, Issues, Scheduler, Settings. All finished, all always on, no app store and nothing to unlock.
- **It builds, not just suggests.** 114 built-in tools — files, git, LSP, terminal, web, browser automation, sub-agents — with per-tool permissions you set to Full, Ask, or Off.
- **It delegates.** Orchestrator boards run a plan as a kanban delivery line with Builder and Tester agents in isolated git worktrees.
- **It remembers.** Brain is a markdown wiki your agents read and write, with semantic recall and a code index — not a context window that forgets you tomorrow.
- **It is yours.** Every prompt is an editable markdown file, every skill is a `SKILL.md`, every theme is a token set, and the whole thing is AGPL.

---

## The apps

### Code — the build workspace

File tree, CodeMirror with LSP and inline completion, terminal tabs, source control, dev servers, and browser preview — with chat sitting beside your project instead of in another window.

![Minnow Code app](documentation/images/app-code.png)

### Orchestrator boards — a plan becomes a delivery line

Turn a plan into waves of tasks, hand them to Builder and Tester agents in isolated git worktrees, and merge at the end. Drive it task by task or let it run.

![Orchestrator board](documentation/images/app-orchestrator.png)

### Super Plan — from idea to a buildable spec

Interview, spec, research, draft, review, polish, final. Super Plan walks an idea all the way to a reviewed plan in `documentation/plans/` without writing a line of code along the way.

![Super Plan pipeline](documentation/images/app-super-plan.png)

### Brain — knowledge that survives the session

A markdown wiki in your Minnow home: graph view, page editing, an append-only log, AI proposals awaiting review, memories, ingest, lint, and a code-symbol index of your repositories. The assistant reads and writes it with tools.

![Brain knowledge graph](documentation/images/app-brain.png)

### Models — run what your hardware can actually run

Hardware-fit scoring, Hugging Face downloads, local serving, providers, per-role routing, sampler and thinking defaults, and token usage with cost.

![Models app](documentation/images/app-models.png)

### Research — send an agent to dig

Multi-round searching, reading, and synthesis behind a progress stepper, scoped to the web, your codebase, or both. Reports save to a library you can reopen and discuss. Fetched page text is fenced as untrusted data before the model sees it.

![Research app](documentation/images/app-research.png)

### And the rest

<table>
<tr>
<td width="33%" valign="top">
<img src="documentation/images/app-chat.png" alt="Chat app"><br>
<b>Chat</b> — the desktop surface. Composer, session rail, workspace panel, notifications.
</td>
<td width="33%" valign="top">
<img src="documentation/images/app-issues.png" alt="Issues app"><br>
<b>Issues</b> — list and board tracking the agent can file, triage, and work through itself.
</td>
<td width="33%" valign="top">
<img src="documentation/images/app-scheduler.png" alt="Scheduler app"><br>
<b>Scheduler</b> — recurring agent jobs on an interval or cron, with run history.
</td>
</tr>
</table>

Full tour: **[Apps guide](documentation/guides/apps.md)**.

---

## Make it yours

Minnow is meant to be taken apart. Everything the app does, you can extend without asking anyone:

- **Skills** — drop a `SKILL.md` into `~/.minnow/skills/` and call it with `/` in the composer. Fifteen ship built in; install more from the Skills Library, or write your own.
- **Tools** — add local tools under `~/.minnow/tools/` with no MCP server required ([tool authoring](documentation/plugins/tool-authoring.md)), or connect any MCP server you like.
- **Agents** — define sub-agents and work agents with their own prompts, models, samplers, and context budgets.
- **Prompts and modes** — every system prompt in the app is a markdown file in the repo. Edit them.
- **Themes** — sixteen built in; the whole UI is `--mn-*` tokens in one file.

![Minnow themes](documentation/images/themes.png)

- **The whole thing** — it's AGPL. Fork it, strip it, rebuild it, ship it. Just keep it free for the next person.

---

## Privacy

- Chats, config, Brain, models, and secrets live under `~/.minnow` on your disk.
- Provider keys and passwords are encrypted at rest (AES-256-GCM).
- Network access is loopback-only until you opt in.
- Web search uses the provider you pick. There is no telemetry and no phone-home.

---

## Contributing

Minnow is built in the open by a small community and one maintainer. Issues, pull requests, docs fixes, skills, and themes are all welcome — a first-time contribution is as good as a feature.

- 💬 [Discord](https://discord.gg/U4FPzv9K4X)
- 🐛 [Issues](https://github.com/HenriGrimm/Minnow/issues)
- ❤️ [Sponsor](https://github.com/sponsors/HenriGrimm) — development is funded by the people who use it, which is what keeps it free for everyone else.

Working in the codebase? Start with [AGENTS.md](AGENTS.md) and [documentation/context.md](documentation/context.md).

---

## Documentation

| Doc | What's in it |
|-----|--------------|
| [Setup from source](documentation/contributor/setup-from-source.md) | Clone, install, providers, first run |
| [Apps](documentation/guides/apps.md) | Tour of the eight apps and the modes |
| [Commands](documentation/contributor/commands.md) | Every script, flag, and environment variable |
| [Configuration](documentation/guides/configuration.md) | `~/.minnow`, providers, secrets |
| [Architecture](documentation/contributor/architecture.md) | How the three processes fit together |
| [Troubleshooting](documentation/guides/troubleshooting.md) | When something won't start |

Full index: [documentation/](documentation/README.md).

---

**License:** [GNU AGPL-3.0-or-later](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](documentation/THIRD_PARTY_NOTICES.md).
