# Minnow

**A free and open source AI workspace. Chat, code, plan, orchestrate, and remember — in one place, on your own machine.**

Minnow runs on the models you already have: [LM Studio](https://lmstudio.ai/), Ollama, llama.cpp, or any OpenAI-compatible endpoint. Your keys, chats, files, and models stay on your disk. Nothing is sent anywhere you did not configure yourself.

> **The mission:** put a complete AI workspace in the hands of everyone who builds, as free and open source software.
>
> Minnow is [AGPL-3.0-or-later](LICENSE). Free to use, study, change, and share — for any purpose, forever. No accounts, no subscriptions, no usage gates, no cloud you have to trust.

![Minnow desktop](documentation/images/hero.png)

---

## Quick start

```bash
git clone https://github.com/DukkyGames/Minnow.git
cd Minnow
npm install
npm start
```

Load a model in LM Studio (or point Minnow at your provider), and the desktop window opens on `http://localhost:9473`. Full walkthrough: **[Setup guide](documentation/guides/setup.md)**.

Prefer an installer? Packaged builds are on [Releases](https://github.com/DukkyGames/Minnow/releases) and update themselves.

---

## What's in it

One desktop shell and eight apps. All of them ship finished and always on; there is no app store to shop in and nothing to unlock.

| App | What it's for |
|-----|---------------|
| **Chat** | The desktop surface. Composer, session rail, notifications. General Chat workspace |
| **Code** | The build workspace: file tree, CodeMirror + LSP, terminal, git, chat beside your code, inline completion. |
| **Research** | Multi-step web research with a saved library. |
| **Models** | Hardware-fit scoring, Hugging Face downloads, local serving, provider routing. |
| **Brain** | A markdown wiki your agents read and write, with semantic recall and a code index. |
| **Issues** | Issue tracking the agent can file and work through itself. |
| **Scheduler** | Recurring agent jobs. |
| **Settings** | Appearance, tools, modes, skills, providers, integrations. |

Underneath: **111 built-in tools** (files, git, LSP, web, browser automation, agents), sub-agents, work agents, **15 bundled skills**, MCP, and per-tool permissions you control.

Two things worth the tour on their own:

- **Orchestrator boards** turn a plan into a kanban delivery line — waves, Builder and Tester agents, isolated git worktrees, and a merge at the end. You run it by hand or let it drive.
- **Super Plan** walks an idea from interview to spec to research to a reviewed, buildable plan, without writing code along the way.

Tour of everything: **[Apps guide](documentation/guides/apps.md)**.

---

## Make it yours

Minnow is meant to be taken apart. Everything the app does, you can extend without asking anyone:

- **Skills** — drop a `SKILL.md` into `~/.minnow/skills/` and call it with `/` in the composer. Install more from the Skills Library, or write your own.
- **Tools** — add local tools under `~/.minnow/tools/` with no MCP server required ([tool authoring](documentation/plugins/tool-authoring.md)), or connect any MCP server you like.
- **Agents** — define sub-agents and work agents with their own prompts, models, samplers, and context budgets.
- **Prompts and modes** — every system prompt in the app is a markdown file in the repo. Edit them.
- **Themes** — sixteen built in; the whole UI is `--mn-*` tokens in one file.
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
- 🐛 [Issues](https://github.com/DukkyGames/Minnow/issues)
- ❤️ [Sponsor](https://github.com/sponsors/DukkyGames) — development is funded by the people who use it, which is what keeps it free for everyone else.

Working in the codebase? Start with [AGENTS.md](AGENTS.md) and [documentation/context.md](documentation/context.md).

---

## Documentation

| Doc | What's in it |
|-----|--------------|
| [Setup](documentation/guides/setup.md) | Install, providers, first run |
| [Apps](documentation/guides/apps.md) | Tour of the eight apps and the modes |
| [Commands](documentation/guides/commands.md) | Every script, flag, and environment variable |
| [Configuration](documentation/guides/configuration.md) | `~/.minnow`, providers, secrets |
| [Architecture](documentation/guides/architecture.md) | How the three processes fit together |
| [Troubleshooting](documentation/guides/troubleshooting.md) | When something won't start |

Full index: [documentation/](documentation/README.md).

---

Copyright (C) 2026 Henri Grimm.

**License:** [GNU AGPL-3.0-or-later](LICENSE). Third-party notices: [THIRD_PARTY_NOTICES.md](documentation/THIRD_PARTY_NOTICES.md).
