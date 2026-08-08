# Apps overview

Minnow is one shell with seven **core** apps: always installed, always on, no toggles. Six are on the left app rail; **Settings** opens from the menubar gear. There is no app store.

They share one chat engine, one tool set, one session store, and one workspace folder at a time. **Code** is where you land after you pick a project; chat lives in its left rail, not as a separate app. Opening Research does not start a different assistant — it gives the same assistant a research workflow.

Cold start opens the **workspaces picker** (`#/workspaces`). Choose a folder (or continue without one) and you route into Code. The menubar **workspace** control opens the same picker anytime.

## The seven

| App | What it is for | How it opens |
|-----|----------------|--------------|
| **Code** | Editor, terminal, git, dev servers, preview — **and chat** beside your project | Fullscreen; default after a workspace |
| **Research** | Multi-round web and codebase research with a saved report library | Fullscreen |
| **Models** | Downloads, local serving, providers, routing, sampler, voice, usage | Fullscreen app |
| **Brain** | Your knowledge wiki, memories, ingest, lint, code index | Fullscreen app |
| **Issues** | Issue list and board with agent triage | Fullscreen |
| **Scheduler** | Recurring jobs on an interval or cron | Side panel |
| **Settings** | Everything configurable | Menubar gear (not on the app rail) |

**Scheduler** opens as a side panel over what you were doing so you can add a job without leaving Code. The other six rail apps take the main stage; **Settings** is always one click away in the menubar.

Move between surfaces with **Ctrl+Tab** / **Ctrl+Shift+Tab**, or the grid icon in the menubar.

## Code

The home surface for day-to-day work. Sessions in the chat rail on the left, composer in the middle, project files and editor on the right. File and git tools resolve under the **workspace root** you opened here.

Legacy links to `#/app/chat` rewrite to Code chat (`#/app/code/chat`). The legacy `#/desktop` hash also rewrites to the workspaces picker, not a separate chat app.

→ [Your first chat](../get-started/first-chat.md), [Working in chat](../chat/chatting.md), [Code app](code.md)

## Research

Ask a question; a research agent runs several rounds of searching, reading and synthesis behind a progress stepper, then writes a report. Scope it to the web, your codebase, or both. Save reports to a library and reopen or discuss them later.

Fetched page text is fenced as untrusted data before the model sees it.

→ [Research app](research.md)

## Models

Nine sections covering everything model-related: hardware-aware recommendations, downloaded artifacts, a Hugging Face library with local serving, voice models, providers, per-role routing, sampler defaults, thinking controls, and token usage with cost.

→ [Models app](models.md)

## Brain

Your own wiki in markdown, stored in your Minnow home. Graph view, page editing, an append-only log, a taxonomy schema, AI proposals awaiting review, memory entries, source ingest, a lint report, and a code-symbol index of your repositories.

The assistant reads and writes it with tools. This is where `save_memory` puts things.

→ [Brain app](brain.md)

## Issues

Linear-style tracking: list and board views, quick capture, types, statuses, priorities and labels you define. Agents file and triage issues through `issue_*` tools, and an issue can be sent straight to a chat, a background agent, or an orchestrate board.

→ [Issues app](issues.md)

## Scheduler

Interval or cron jobs that run a prompt in a chosen workspace with a chosen model through a headless runner. Run history, output and notifications are kept.

Jobs run **only while Minnow is running**. Hidden in the tray still counts; fully quit does not.

→ [Scheduler app](scheduler.md)

## Settings

Seven categories: General, Apps, Appearance, Models, Agents, Integrations, Advanced. Search with **Ctrl+K** / **Cmd+K** — results deep-link across apps, so a search for "memory" opens Brain.

→ [Settings app](settings.md)

## Beyond the app rail

These are real features that are not separate apps:

- **Orchestrate boards** — from the Orchestrate button in the Code sidebar rail. See [Orchestrate boards](../orchestrate/boards.md).
- **Super Plan** — the caret under Plan in the composer. See [Super Plan](../orchestrate/super-plan.md).
- **This manual** — the menubar **?**. Read-only, ships with the build, not an eighth app.

## Not in this release

Five apps exist in the codebase but are held behind a release gate. They do not appear in the rail, in Settings, in keyboard shortcuts, in routes, or in the model's tool list. Deep links to them resolve to `#/workspaces` when the app is hidden — the workspaces picker, not Code. You do not need to configure them, and their absence is not a fault:

| App | What it will be |
|-----|-----------------|
| **Compare** | Blind A/B preference testing across 2–6 models |
| **Benchmarking** | In-app throughput, latency and quality runs |
| **Experts** | A roster of specialist persona agents with their own sandboxes |
| **Calendar** | Local calendar with `.ics` import/export and encrypted CalDAV sync |
| **Email** | IMAP triage, AI digests, review-first automations, explicit-send SMTP |

Tools follow their app. The calendar and email tools are filtered out of both the model's tool list and the Settings catalog while those apps are gated — the model is never offered a capability you cannot reach.

## Related

- [How Minnow works](../concepts/how-minnow-works.md)
- [Keyboard shortcuts](../reference/keyboard-shortcuts.md)
- [Roadmap](../reference/roadmap.md)
