# Apps overview

Minnow is one desktop shell with eight **core** apps. Each app is always installed and always on. There is no optional app store in the shipped product: onboarding and **Settings → Apps** show what is included plus a **Coming soon** placeholder for future optional apps.

Open apps from the **dock**. Presentation differs: some apps fill the screen, some open as floating windows, and Scheduler opens as a **side panel**.

## The eight apps

| App | What it is for | How it opens |
|-----|----------------|--------------|
| **Chat** | Desktop concierge: sessions, composer, notifications hub. | Default desktop surface (dock **Chat**). |
| **Code** | IDE-style workspace: tree, editor, terminal, git, preview, chat beside code. | Fullscreen from dock. |
| **Research** | Multi-step web research with a saved library. | Desktop layout from dock. |
| **Models** | Downloads, local serve, providers, routing, voice, usage. | Floating window. |
| **Brain** | Your markdown knowledge wiki, memory, ingest, and code index. | Floating window. |
| **Issues** | Issue list and board, quick capture, agent triage. | Fullscreen from dock. |
| **Scheduler** | Recurring agent jobs while Minnow runs. | Side panel from dock. |
| **Settings** | Appearance, tools, modes, skills, providers, diagnostics. | Floating window. |

**Official help** (this manual and developer docs) opens from the menubar **?** button. It is not a dock app and does not replace Brain.

## Chat (desktop)

The home surface. Use the left **chat rail** for sessions and search. The composer supports modes, slash skills, attachments, and the context ring. Sending a message may route you to another app through the smart concierge.

Detail: [Your first chat](../get-started/first-chat.md).

## Code

Fullscreen builder: file tree, CodeMirror editor with AI completion and LSP, integrated terminal, git, and optional browser preview for local HTML. File and git tools use the **workspace root** you pick in Code.

Detail: [Code app](code.md).

## Research

Enter a topic; a sub-agent gathers sources behind a progress UI. Save reports to a **Library** window and reopen or **discuss** them later.

Detail: [Research app](research.md).

## Models

One place for hardware fit scores, installed weights, provider URLs, routing, sampler and thinking presets, token usage, voice downloads, Hugging Face download, and local serve.

Detail: [Models app](models.md).

## Brain

Editable wiki at `~/.minnow/brain/`: pages, graph, memories, ingest, lint, and code-symbol tools. Memory-related Settings live here, not under generic Settings sections.

Detail: [Brain app](brain.md).

## Issues

Linear-style tracking with list and board views, taxonomy in Settings, and agent tools so Debug mode can file and update issues.

Detail: [Issues app](issues.md).

## Scheduler

Interval or cron jobs that run a prompt in a chosen workspace and model via a headless runner. **Jobs only run while Minnow is open.**

Detail: [Scheduler app](scheduler.md).

## Settings

Searchable full-page settings: General, appearance, notifications, apps list, tools and permissions, modes, skills, MCP, LSP, sub-agents, webhooks, audio, health diagnostics, and more.

Detail: [Settings app](settings.md).

## Beyond the dock (not separate apps)

- **Orchestrate** boards: plan-to-build kanban from the sidebar hub.
- **Super Plan**: extended planning under Plan.
- **Minnow wiki**: menubar **?** for read-only product help.

## Not in this release

Compare, Benchmarking, Experts, Calendar, and Email remain in development behind a release gate. They do not appear in the dock, routes, or agent tool surface for packaged users. You do not need to configure them.

## Related

- [Modes, skills, and context](../chat/modes-and-skills.md)
- [Roadmap](../reference/roadmap.md)
