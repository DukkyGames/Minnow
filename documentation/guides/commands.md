# Command reference

Every npm script, the headless CLI, smoke/maintenance scripts, and environment variables. Source of truth: [`package.json`](../../package.json).

## Running & building

| Command | Description |
|---------|-------------|
| `npm start` | **Recommended.** `node server.js` → Vite + tool server + `~/.minnow` APIs + Electron desktop shell. |
| `npm run dev` | Vite only (UI/HMR). Most server features unavailable. |
| `npm run desktop` | Alias for `electron:dev`. |
| `npm run electron:dev` | `concurrently` Vite (HMR, `MINNOW_ELECTRON=1`) + Electron via `scripts/electron-dev.mjs`. |
| `npm run electron:build` | Compile the Electron main/preload (`electron/tsconfig.json`) + rename preload. |
| `npm run electron:prod` | Full build + Electron build, then run the packaged main against `dist/`. |
| `npm run build` | `tsc && vite build` → `dist/`. `prebuild` regenerates `src/skills/builtin-manifest.json`. |
| `npm run preview` | `vite preview` of the production build (no tool API). |
| `npm run package` | Build + Electron build + **electron-builder** installer → `release/pkg` (Windows NSIS + `latest.yml` auto-update feed metadata; never uploads — see [Getting started → Packaging](../getting-started.md#packaging-a-desktop-build)). |
| `npm run package:dir` | Same, unpacked directory (`--dir`). |
| `npm run package:clean` | Clean the `release/` output. |
| `npx tsc --noEmit` | Typecheck only. |

## Headless CLI (`minnow run`)

Drives one agent turn without the SPA. Requires the tool server (`npm start`) or pass `--start-server`. Entry: [`bin/minnow.mjs`](../../bin/minnow.mjs) → `src/headless/cli-main.ts`.

```bash
minnow run --workspace . --agent builder --mode build \
  --prompt "Summarize README.md" --json-out run.json

# or via npm
npm run minnow:run -- --prompt "Reply OK" --json
```

Flags (`minnow run --help` for the authoritative list):

| Flag | Purpose |
|------|---------|
| `--prompt <text>` / `--stdin` | The user message (or read from stdin). |
| `--workspace <dir>` | Workspace root for file/git tools. |
| `--agent <id>` | Work agent to use. |
| `--mode <id>` | `general` / `build` / `plan` / `orchestrate` / `debug`. |
| `--model <id>` / `--provider <id>` | Override model / provider. |
| `--profile <id>` | Prompt profile / setup bundle. |
| `--base-url <url>` | Server origin (default detected; e.g. `http://127.0.0.1:5173`). |
| `--start-server` | Start a tool server for the run. |
| `--server-timeout <ms>` | Server readiness timeout. |
| `--json` / `--json-out <file>` | Machine-readable result to stdout / file. |
| `--max-tool-turns <n>` | Cap tool-call iterations. |
| `--no-approval` / `--auto-reject-questions` | Non-interactive tool/question handling. |
| `--persist-chat` / `--chat-id <id>` / `--chat-name <name>` | Save the transcript into `~/.minnow/sessions`. |
| `--scheduler-run` | Marks a scheduler-originated run. |
| `--minnow-home <dir>` | Override `~/.minnow`. |
| `--quiet` | Suppress progress logs. |

UI-only tools (e.g. `ask_question`) fail with a clear error in headless mode unless you opt into unsafe automation (`MINNOW_I_UNDERSTAND_UNSAFE_AUTOMATION`).

## Tests

`npm test` runs the full suite via [`test/run-all.mjs`](../../test/run-all.mjs) — it discovers every `test/**/*.test.{js,mjs,mts,ts}` file and runs the correct runner/loader per path (see [`test/test-config.mjs`](../../test/test-config.mjs)). New test files are included automatically; `npm run test:check-coverage` fails CI when a file would be orphaned.

**Memory-safe defaults (local dev):** one test file per node process, worker concurrency `1`. Paths under `test/ui/`, `test/orchestrate/`, and `test/chat/orchestrate/` also pass `--test-isolation=process` so each `test()` runs in a fresh child process (happy-dom + board UI imports otherwise OOM typical workstations). Override when you have spare RAM, e.g. `MINNOW_TEST_CONCURRENCY=8 MINNOW_TEST_BATCH_SIZE=60 npm test`. CI stays at concurrency `1` on 4-core runners unless you raise `MINNOW_TEST_CONCURRENCY`.

**CI (MIN-383):** [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) runs on pull requests and pushes to `main`: `npm ci` → `test:check-coverage` → `npx tsc --noEmit` → `npm test` on `windows-latest` and `ubuntu-latest`. Require the **`ci`** status check on `main` before merge ([`.github/BRANCH_PROTECTION.md`](../../.github/BRANCH_PROTECTION.md)).

Scoped suites (each delegates to `node test/run-all.mjs --suite <name>`):

| Command | Area |
|---------|------|
| `npm run test:memory` | Memory store + API |
| `npm run test:brain` | Brain wiki / CORTEX |
| `npm run test:engine` | Retrieval engine |
| `npm run test:lsp` | LSP integration |
| `npm run test:mcp` | MCP servers |
| `npm run test:browser` | CDP / browser preview tools |
| `npm run test:skills` | Skills loader + clients |
| `npm run test:impeccable` / `test:skills-impeccable` | Impeccable skill + `/impeccable` |
| `npm run test:attachments` | Workspace refs + document readers |
| `npm run test:research` | Deep research |
| `npm run test:benchmark` | Benchmark app |
| `npm run test:evals` | Eval harness |
| `npm run test:calendar` | Calendar app + CalDAV/ICS |
| `npm run test:email` | Email app |
| `npm run test:webhooks` | Outgoing webhooks |
| `npm run test:notifications` | Notification inbox |
| `npm run test:servers` | Managed server processes |
| `npm run test:plugins` | Tool plugin scan/loader |
| `npm run test:terminal-pty` | Terminal PTY session (live server) |
| `npm run test:ui-designer` | UI Designer agent |
| `npm run test:settings` | Settings registry |
| `npm run test:check-coverage` | Orphan test detection (also in CI) |

Most TS/UI suites run under `tsx` with `--import ./test/test-loader.mjs` (stubs `.css` + xterm); some use `--experimental-test-module-mocks`.

## Skill maintenance

| Command | Description |
|---------|-------------|
| `npm run impeccable:sync` | Re-vendor Impeccable into `src/skills/impeccable/`. |
| `npm run impeccable:update` | Update upstream Impeccable, then re-sync. |
| `npm run impeccable:detect` | Anti-pattern scan of `src/` + `index.html` (exit `2` = issues found). |
| `npm run caveman:sync` | Refresh the upstream Caveman `SKILL.md`. |
| `npm run build:benchmark-packs` | Rebuild benchmark task packs into `public/benchmark-packs/`. |
| `npm run report:bundle-size` | Print production chunk sizes from `dist/assets` (run after `npm run build`). |
| `npm run report:bundle-size:ci` | Same as above; exits non-zero when entry chunk exceeds 1500 KB or data packs ship as JS. |

## Smoke scripts

Run with the server up (default port 5173 — substitute yours):

```bash
npx tsx scripts/sa16-smoke.mjs http://localhost:5173       # general/sub-agent smoke
node test/terminal-stream.test.mjs http://localhost:5173   # terminal stream API
npx tsx scripts/step16-memory-smoke.mjs http://localhost:5173
```

Other `scripts/*.mjs` cover stepwise feature smokes, Electron launch, token/CSS generation, and migrations — see the [`scripts/`](../../scripts/) folder.

## Environment variables

| Variable | Effect |
|----------|--------|
| `PORT` | Server/Vite port (default 5173, falls back to next free). |
| `MINNOW_HOME` | Override the `~/.minnow` data directory. |
| `MINNOW_BROWSER=1` | Open a system browser tab instead of the Electron shell. |
| `MINNOW_HEADLESS=1` / `BROWSER=none` | Don't auto-open any window. |
| `MINNOW_ELECTRON=1` | Internal flag set when running under Electron. |
| `TOOLS_ALLOW_ALL_PATHS=1` | Let file/git tools resolve outside the workspace root (use with care). |
| `MINNOW_OAUTH_REDIRECT_BASE` | Override the OAuth redirect base URL. |
| `MINNOW_NETWORK` | `local` (default) or `lan` — bind dev server to loopback vs all interfaces. Overrides `config.json` → `server.networkAccess`. Restart after changing Settings. On Windows, allow inbound TCP on the dev port in Firewall if LAN clients cannot connect. |
| `MINNOW_DEBUG` | Verbose server logging. |
| `MINNOW_I_UNDERSTAND_UNSAFE_AUTOMATION` | Allow UI-only tools in headless runs. |
| `MINNOW_PLUGIN_UNSAFE` | Allow unsigned/unsafe tool plugins. |
| `MINNOW_TTS_USE_COMPILE` | Opt into compiled TTS path. |
| `MINNOW_TEST` | Set during test runs. |
