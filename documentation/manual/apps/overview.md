# Apps overview

Minnow is one desktop with eight apps on it. All eight are **core**: always installed, always on, no toggles. There is no app store.

They share one chat engine, one tool set, one session store and one workspace. Opening Code does not start a different assistant — it gives the same assistant an editor, a terminal and a git panel to work beside.

## The eight

| App | What it is for | How it opens |
|-----|----------------|--------------|
| **Chat** | The desktop itself: conversations, composer, notifications | The default surface |
| **Code** | Editor, terminal, git, dev servers, preview — chat beside your project | Fullscreen |
| **Research** | Multi-round web and codebase research with a saved report library | Desktop layout |
| **Models** | Downloads, local serving, providers, routing, sampler, voice, usage | Floating window |
| **Brain** | Your knowledge wiki, memories, ingest, lint, code index | Floating window |
| **Issues** | Issue list and board with agent triage | Fullscreen |
| **Scheduler** | Recurring jobs on an interval or cron | Side panel |
| **Settings** | Everything configurable | Floating window |

The presentation is not decoration. **Scheduler opens as a side panel** and deliberately does not steal focus, so you can add a job without leaving what you were doing. **Models, Brain and Settings are windows** you can stack and resize. **Code and Issues take the screen** because that is what they need.

Move between surfaces with **Ctrl+Tab** / **Ctrl+Shift+Tab**, or the grid icon in the menubar. **Alt+`** cycles floating windows.

## Chat

The home surface. Sessions in the left rail, composer in the middle, workspace panel on the right with Files, Browser and File preview for the desktop's working folder.

→ [Your first chat](../get-started/first-chat.md), [Working in chat](../chat/chatting.md)

## Code

The full development environment: file tree with real file operations, a CodeMirror editor with AI completion and language-server intelligence, xterm terminal tabs, a source-control panel, a dev-server manager, and a browser preview with DevTools.

File and git tools resolve under the **workspace root** you open here.

→ [Code app](code.md)

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

## Beyond the dock

These are real features that are not separate apps:

- **Orchestrate boards** — from the Orchestrate button in the Code sidebar rail. See [Orchestrate boards](../orchestrate/boards.md).
- **Super Plan** — the caret under Plan in the composer. See [Super Plan](../orchestrate/super-plan.md).
- **This manual** — the menubar **?**. Read-only, ships with the build, not a ninth app.

## Not in this release

Five apps exist in the codebase but are held behind a release gate. They do not appear in the dock, in Settings, in keyboard shortcuts, in routes, or in the model's tool list, and deep links to them bounce back to the desktop. You do not need to configure them, and their absence is not a fault:

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
