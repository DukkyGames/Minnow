# MinnowOS apps

Minnow's desktop shell ("MinnowOS") presents focused apps on a desktop with a **dock** launcher and a **menubar** (model chip, notifications bell, clock). The desktop itself is the **chat** surface; other apps open as fullscreen surfaces, floating windows, or side panels. Routes use hashes like `#/desktop` and `#/app/<id>`.

Shell internals live in [`src/os/`](../../src/os/); the exhaustive reference is the "MinnowOS shell" section of [`../context.md`](../context.md).

## What ships

Eight apps, all **core** — always installed, always on, no user toggle:

| App | Route | Presentation |
|-----|-------|--------------|
| Chat | `#/desktop` | desktop |
| Code | `#/app/code` | fullscreen |
| Research | `#/app/research` | desktop |
| Models | `#/app/models` | window |
| Brain | `#/app/brain` | window |
| Issues | `#/app/issues` | fullscreen |
| Scheduler | `#/app/scheduler` | side panel |
| Settings | `#/app/settings` | window |

Because no *optional* app is released, the **Choose your apps** onboarding step and **Settings → Apps** show the core "Always included" line plus a **Coming soon** empty state — there is nothing to pick. See [Behind the release gate](#behind-the-release-gate) for what is held back and why.

## Desktop chat

The default surface. Type in the concierge composer to start a conversation, or use the left-edge **chat rail** to switch sessions. A **smart concierge** makes one structured LLM call on submit to route your request to the right app and seed it (with offline keyword-routing fallback). Choose a **mode** per message and watch the **context ring** beside Send.

## Code

The IDE-style surface: file tree, **CodeMirror** editor (with AI completion), CRUD, search, and drag-to-composer workspace references. Opens fullscreen and reparents the legacy chat/topbar into the app layer. File and git tools resolve under the open **workspace root**. Includes the integrated **terminal** (xterm.js PTY tabs).

The **browser preview** pane (desktop shell only) renders workspace HTML and localhost URLs in a real Chromium guest. Press **F12** (or **Ctrl+Shift+I** / **Cmd+Opt+I**, or the `</>` toolbar button) to toggle **DevTools** docked below the page — console, network, and element inspection for the previewed page, whether focus is in the preview or the surrounding app.

## Models

Everything about models in one place (`#/app/models/<section>`):

- **Recommend** — hardware-aware suggestions (probe via `/api/system/hardware`, fit scoring ported from Odysseus).
- **Installed** — downloaded artifacts under `~/.minnow/models/`.
- **Settings / Providers / Routing / Sampler / Thinking / Usage** — provider config, model routing, sampler presets, reasoning controls, token usage.
- **Voice** — local Whisper (STT) / Qwen3-TTS (TTS) downloads + provider settings.
- **Download** model files from Hugging Face and **Serve** them locally via `llama-server` (auto-registers a provider). Ollama / LM Studio register existing endpoints when reachable.

## Research

Deep, multi-step web research. Enter a topic; a sub-agent gathers and synthesizes sources behind a progress stepper. Save reports to a **Library** (a floating window) and re-open or **discuss** them later. Extracted source text is wrapped in untrusted-data fences before reaching the model.

## Brain

The knowledge surface backed by the **Brain wiki** (CORTEX) at `~/.minnow/brain/`: nested markdown pages with YAML frontmatter, hybrid keyword/vector retrieval, code-symbol indexing, ingest, and lint. Agent tools: `brain_search`, `brain_read_page`, `brain_list`, `brain_write_page`, `brain_append_log`, `brain_ingest_source`, plus code tools `repo_map`, `find_symbol`, `who_calls`, `read_symbol`, `explain_symbol`. `save_memory` writes facts here.

**Sections:** Graph (home), Edit, Log, Schema, Proposals, **Memories** (store toggles + entry CRUD), Ingest, Lint, Code, Settings (embeddings, synthesis cadence, code index). Legacy `#/settings/memory` opens **Memories**.

## Issues

Linear-style issue tracking (`#/app/issues`), fullscreen. List and board views, quick capture, taxonomy (status, priority, labels) in Settings, and `issue_*` agent tools so the model can file and triage its own findings. **Debug** mode routes here — it replaced the old bug tracker (MIN-261).

## Scheduler

Local recurring agent jobs (`~/.minnow/scheduler.json`) as a side panel. Each job runs a prompt on an **interval** (60s minimum) or **cron** schedule, in a chosen workspace/model, via a headless `minnow run` subprocess. Run history and in-app reminders are persisted. **Jobs only run while Minnow is open** (`npm start` or the desktop shell).

## Settings

Full-page sections at `#/app/settings` (and legacy `#/settings/<section>` redirects): General (appearance, notifications), Apps, Tools, Modes, Skills, **Skills Library**, MCP, LSP, Sub-agents, Work agents, Rules, Prompting (profiles + diffing), Providers/Models, Webhooks, Audio, Health & diagnostics, and more. **Memory** settings live in the **Brain** app. A search box indexes settings (memory-related queries open Brain).

---

## Behind the release gate

Each app carries a developer `releaseState` (`released` | `hidden`) alongside its `core` / `optional` availability ([`src/os/app-registry.ts`](../../src/os/app-registry.ts)). Hidden apps stay in the codebase and keep their tests, but are omitted from **onboarding, Settings, the dock, the menubar switcher, keyboard shortcuts, hash routes, notifications, and `launch_minnow_app`**. Deep links to a hidden app bounce back to the desktop.

Currently hidden (MIN-471):

| App | Status |
|-----|--------|
| **Compare** | Blind A/B across 2–6 models, win-rate history under `~/.minnow/compare/`. Working, not v1 scope. |
| **Bench** | In-app benchmark battery + run history; complements the headless eval harness (`server/evals/`). |
| **Experts** | The "Experts' Lab" roster of specialist sandbox chats. |
| **Calendar** | Local SQLite calendar, `.ics` import/export, RRULE, encrypted CalDAV sync. |
| **Email** | IMAP triage, AI digests, review-first automations, explicit-send SMTP. |

Tools follow their app. A catalog entry with an `appId` is filtered out of the model's tool list *and* the Settings → Tools page while that app is hidden or user-disabled (MIN-472) — today that is `manage_calendar` plus the seven email tools. Nothing offers the model a capability the user cannot reach.

**Removed, not gated:** the **Reef** mini-app runtime and its mode were deleted outright (MIN-473). A rebuilt studio surface is tracked separately (MIN-137).

---

## Operating modes

Modes change the system prompt and tool policy ([`src/chat/modes/registry.ts`](../../src/chat/modes/registry.ts)). Four appear in the composer strip:

| Mode | Behavior |
|------|----------|
| **General** | Everyday Q&A and brainstorming; all enabled tools with approval. |
| **Build** | Default development mode; broad tool access. |
| **Plan** | Analyze and plan with destructive tools denied (no shell, writes, deletes, moves, or git mutations). |
| **Debug** | Investigate issues; file/triage via the **Issues** app and `issue_*` tools. |

The rest are entered from elsewhere and never appear in the strip:

| Mode | Entered from |
|------|--------------|
| **Orchestrate** | The Orchestrate hub / top bar — board + plans under `documentation/plans/`. |
| **Super Plan** | The caret sub-menu under **Plan**, or the Orchestrate plan screen. |
| **Desktop** | The MinnowOS desktop chat surface. |
| **Email** | The Email assistant dock (ships with the hidden Email app). |
| **Onboarding** | First run only — the guide chat. |

**Reef** mode was removed in MIN-473.
