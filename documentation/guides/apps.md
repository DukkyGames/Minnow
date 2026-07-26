# MinnowOS apps

Minnow's desktop shell ("MinnowOS") presents focused apps on a desktop with a **dock** launcher and a **menubar** (model chip, notifications bell, clock). The desktop itself is the **chat** surface; other apps open as fullscreen surfaces, floating windows, or side panels. Routes use hashes like `#/desktop` and `#/app/<id>`.

Shell internals live in [`src/os/`](../../src/os/); the exhaustive reference is the "MinnowOS shell" section of [`../context.md`](../context.md).

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

## Compare

Blind A/B testing (`#/app/compare`). Pick **2–6 models**, choose **Parallel** or **Sequential**, and run a shared prompt. Identities stay hidden (aliases A/B/C… or 1/2/3…) until you vote (per-column, plus Tie / All bad). Win-rate history persists under `~/.minnow/compare/`.

## Bench

In-app benchmark battery for the active model with run history — complements the headless **eval harness** (`server/evals/`, `~/.minnow/evals/`). Plan: `documentation/plans/benchmark-system-implementation.md`.

## Research

Deep, multi-step web research. Enter a topic; a sub-agent gathers and synthesizes sources behind a progress stepper. Save reports to a **Library** (a floating window) and re-open or **discuss** them later. Extracted source text is wrapped in untrusted-data fences before reaching the model.

## Experts

The "Experts' Lab" — a roster of specialist sandbox chats. Pick a specialist for a focused thread, or open the Lab to manage/create experts. New chats open on the desktop chat surface.

## Brain

The knowledge surface backed by the **Brain wiki** (CORTEX) at `~/.minnow/brain/`: nested markdown pages with YAML frontmatter, hybrid keyword/vector retrieval, code-symbol indexing, ingest, and lint. Agent tools: `brain_search`, `brain_read_page`, `brain_list`, `brain_write_page`, `brain_append_log`, `brain_ingest_source`, plus code tools `repo_map`, `find_symbol`, `who_calls`, `read_symbol`, `explain_symbol`. `save_memory` writes facts here.

**Sections:** Graph (home), Edit, Log, Schema, Proposals, **Memories** (store toggles + entry CRUD), Ingest, Lint, Code, Settings (embeddings, synthesis cadence, code index). Legacy `#/settings/memory` opens **Memories**.

## Calendar

Local-first SQLite calendar (`~/.minnow/calendar/calendar.db`) in a window. Month/week views, `.ics` import/export, RRULE recurrence, and encrypted **CalDAV** sync (`tsdav`). Agent tool `manage_calendar`; upcoming-event reminders flow through the scheduler notification queue.

## Email

Agent-first email triage. **IMAP** read sync (with optional SMTP send), then AI digests, tags, summaries, and draft replies. A dashboard surfaces an attention queue and quick-reply chips; a three-pane view handles full mail management (read/unread, flag, archive, move, delete, bulk). Compose includes alt-draft chips, a selection-revise bubble, and a rich-text toolbar. **Send always requires explicit user confirmation** — no auto-send. Account passwords are encrypted; bodies are wrapped in untrusted-data fences before LLM triage. Tools: `list_mail`, `draft_reply`, `summarize_inbox`, `generate_reply_variants`, `email_action`.

## Scheduler

Local recurring agent jobs (`~/.minnow/scheduler.json`) as a side panel. Each job runs a prompt on an **interval** (60s minimum) or **cron** schedule, in a chosen workspace/model, via a headless `minnow run` subprocess. Run history and in-app reminders are persisted. **Jobs only run while Minnow is open** (`npm start` or the desktop shell).

## Settings

Full-page sections at `#/app/settings` (and legacy `#/settings/<section>` redirects): General (appearance, notifications), Tools, Modes, Skills, MCP, LSP, Sub-agents, Work agents, Rules, Prompting (profiles + diffing), Providers/Models, Webhooks, Audio, Health & diagnostics, and more. **Memory** settings live in the **Brain** app. A search box indexes settings (memory-related queries open Brain).

---

## Operating modes (composer)

Modes change the system prompt and tool policy ([`src/chat/modes/registry.ts`](../../src/chat/modes/registry.ts)):

| Mode | Behavior |
|------|----------|
| **General** | Everyday Q&A and brainstorming; all enabled tools with approval. |
| **Build** | Default development mode; broad tool access. |
| **Plan** | Analyze and plan with destructive tools denied (no shell, writes, deletes, moves, or git mutations). |
| **Orchestrate** | Coordinate multi-step work; board + plans under `documentation/plans/`. Opened from the top bar (not the composer strip). |
| **Debug** | Investigate issues; file/triage via the **Issues** app and `issue_*` tools. |
