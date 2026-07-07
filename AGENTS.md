# AGENTS.md

Guidance for AI coding agents (Cursor, Claude Code, etc.) working in the Minnow repo.

## Overview

Minnow is a **Vite + TypeScript SPA** plus a **Node tool server** (`server.js`) and an **Electron desktop shell** (the "MinnowOS" window). It is a local-first AI workspace for LM Studio and other OpenAI-compatible providers.

- **Six operating modes** (four in the Code composer strip): General, Build, Plan (no-destructive guard), Orchestrate, Reef, Debug. Orchestrate is not in the composer picker — it opens from the sidebar hub. Reef remains available when the user selects it in the UI; chat agents are not prompted to suggest or hand off to Reef. Modes are defined in [`src/chat/modes/registry.ts`](src/chat/modes/registry.ts); prompts in [`src/chat/prompts/modes/`](src/chat/prompts/modes/).
- **~88 built-in tools** across web / utility / files / git / code / agents / browser / lsp ([`src/tools/definitions.ts`](src/tools/definitions.ts)).
- **Built-in slash skills** (~33): core helpers (`git-commit`, `code-review`, `ask-user`, …), `impeccable`, `caveman`, `ui-designer`, and **19 Matt Pocock productivity/engineering skills** (`ask-minnow`, `triage`, `implement`, `handoff`, … — see [`documentation/context.md`](documentation/context.md) § Skills → Matt Pocock). Sync: `npm run matt-pocock-skills:sync`.
- **MinnowOS apps:** Chat (desktop), Code, Models, Compare, Bench, Research, Experts, Brain, Calendar, Email, Scheduler, Settings ([`src/os/`](src/os/)).
- **Persistence** lives under `~/.minnow` when the tool server runs.

The **authoritative reference** is [`documentation/context.md`](documentation/context.md) — read it before touching unfamiliar subsystems. Setup/scripts: [`README.md`](README.md). Guides: [`documentation/guides/`](documentation/guides/).

## Running the app

- **`npm start`** is the recommended dev command — Vite + the Node tool server on port **9473** (or next free port if `PORT` is set) and **launches the Electron desktop shell by default**. `MINNOW_BROWSER=1` opens the system browser instead; `BROWSER=none` or `MINNOW_HEADLESS=1` suppresses auto-open. `npm run desktop` / `npm run electron:dev` are HMR-friendly Electron aliases.
- **`npm run dev`** is Vite-only (no tool server) — fine for pure UI work, but most tool-dependent features won't function.
- **Headless CLI:** `minnow run --prompt "…"` (or `npm run minnow:run -- --prompt "…"`) drives the same generations + server tools without the SPA. Requires `npm start` (or `--start-server`). See `minnow run --help`.
- Health checks: `curl http://localhost:9473/api/tools/ping`, `/api/config/ping`, `/api/memory/ping`, `/api/brain/ping` (substitute your `PORT` if overridden).
- **LM Studio headless daemon** (`llmster`): install with `curl -fsSL https://lmstudio.ai/install.sh | bash`; `lms daemon up && lms server start`; `lms get <model> -y`; `lms load <model> -y`. CLI at `~/.lmstudio/bin/lms`.

## Testing

- **`npm test`** runs the full suite (`node --test` + `tsx`, several hundred tests).
- **`npx tsc --noEmit`** for type checking (no separate ESLint config).
- Scoped suites: `npm run test:memory|brain|engine|lsp|mcp|browser|skills|attachments|research|benchmark|evals|calendar|email|webhooks|notifications|voice|servers|plugins|terminal-pty|ui-designer|scheduler`. See `package.json` for exact globs.
- Many TS/UI suites run under `tsx` with `--import ./test/test-loader.mjs` (the loader stubs `.css` and xterm). Some use `--experimental-test-module-mocks`.

## Building & packaging

- **`npm run build`** → `tsc && vite build` → `dist/`. The `prebuild` step generates `src/skills/builtin-manifest.json`.
- **`npm run package`** → build + `electron:build` + `electron-builder` (Windows NSIS → `release/`). `package:dir` produces an unpacked directory.

## Key gotchas

- `postinstall` runs `scripts/sync-impeccable-skill.mjs` (vendors the Impeccable skill) and `scripts/ensure-electron.mjs`. Both are expected and idempotent.
- **Browser-only tools** (`get_datetime`, `calculate`, `ask_question`, sub-agent/board tools, mode handoff, `browser_*`) run client-side; calling them via `POST /api/tools` returns "Not implemented".
- `browser_*` automation requires the Electron shell and an origin allowlist; hidden in a plain browser tab.
- The `[providers] fetch failed` log on startup is normal without LM Studio (provider discovery can't reach `localhost:1234`).
- **Streaming SSE** is parsed in [`src/api/sse-parse.ts`](src/api/sse-parse.ts) (event boundaries + glued JSON); non-streaming fallback uses `parseCompletionResponseBody` — do not call `Response.json()` on the generations shim. Some non–OpenAI providers (e.g. `llmster`) may still yield empty text; verify the provider's `chatCompletionsPath` is `/v1/chat/completions`.
- **Secrets are encrypted** at rest with `~/.minnow/.key`. Deleting/rotating the key makes existing encrypted secrets unrecoverable.
- **Path safety:** file/git tools resolve under the workspace root unless `TOOLS_ALLOW_ALL_PATHS=1`.
- **LAN access** is opt-in (`Settings → General → Network access` or `MINNOW_NETWORK=lan`); default is loopback-only — restart after toggling.
- **Plan mode** denies mutating file edits and git writes; allows `save_file`/`make_directory` under `documentation/plans/` only (see `tool-groups.ts` + `plan-write-guard.ts`). Shell/code-exec is allowed per the mode matrix (MIN-332).

## Conventions

- Match the surrounding code's style, naming, and comment density.
- Application CSS uses `--mn-*` tokens; hex/rgba literals live only in [`src/styles/tokens.css`](src/styles/tokens.css). See [`DESIGN.md`](DESIGN.md).
- Keep [`documentation/context.md`](documentation/context.md) updated when you ship a feature that changes architecture, APIs, or storage.
