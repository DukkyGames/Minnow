# Hub dev server: startup.md + background agent

## Summary

The Vibe Coding Hub **Dev server** strip cell no longer toggles the preview panel. It drives a workspace-scoped dev-server lifecycle from **`{workspaceRoot}/startup.md`**, with setup/start delegated to sub-agents and long-running processes managed on the Node tool server.

## User flow

| Cell state | Primary click | Console |
|------------|---------------|---------|
| Server offline (`npm run dev` only) | disabled | hidden |
| **Set up** (no `startup.md`) | `generalPurpose` agent writes guide | — |
| **Stopped** | `POST /api/workspace/dev-server/start` (shell agent fallback if API fails) | — |
| **Starting** | disabled | background stream (panel may stay closed) |
| **Running** | `POST /api/workspace/dev-server/stop` | [`openDevServerConsole`](../src/ui/terminal-panel.ts) → **Dev server** tab |
| **Error** | retry via managed start (shell fallback on failure) | stream if run exists; Console → Dev server tab |

On hub **start**, logs attach **stream-only** via [`ensureDevServerStream`](../src/ui/terminal-panel.ts) into the **Dev server** terminal tab — the panel does **not** auto-open and output does **not** go to the Agent tab. **Console** opens the panel on the **Dev server** tab ([`openDevServerConsole`](../src/ui/terminal-panel.ts), not Agent). Hub teardown calls [`stopDevServerStream`](../src/ui/terminal-panel.ts).

## startup.md contract

Template: [`documentation/templates/startup.md`](../templates/startup.md)

```yaml
---
command: npm run dev
cwd: .
healthUrl: http://localhost:5173/
port: 5173
stop:
  command: npx kill-port 5173
---
```

## Hub settings (port + network)

Per workspace, persisted in `config.json` → `workspace.devServerSettingsByPath`:

| Field | Values | Default |
|-------|--------|---------|
| `port` | 1–65535 | `5173` (or `startup.md` `port` when unset) |
| `network` | `local` (this PC / `127.0.0.1`) · `lan` (`0.0.0.0` + Vite `--host`) | `local` |

The Vibe Hub **Dev server** cell exposes a port field and **This PC** / **Network** toggle (disabled while starting/running). Port edits debounce to `PUT /api/workspace/dev-server/settings` on `input`, flush immediately on `blur`, and **must flush before** `POST …/start` so a quick click after typing does not revert to `5173`. Settings merge into the effective guide at start time ([`server/dev-server/effective-guide.js`](../server/dev-server/effective-guide.js)): health probes stay on `127.0.0.1`, spawn env sets `PORT`/`HOST`, and common `npm run dev` / Vite commands get `--port` / `--host` when missing. `mergeConfigMeta` merges `workspace.devServerSettingsByPath` / `devServerByPath` so run-state writes do not drop saved port settings.

## APIs

| Method | Path | Role |
|--------|------|------|
| GET | `/api/workspace/startup` | Guide presence + coarse status |
| GET | `/api/workspace/dev-server/status` | Poll-friendly status + health + settings |
| GET | `/api/workspace/dev-server/settings` | Read port / network |
| PUT | `/api/workspace/dev-server/settings` | Save port / network |
| POST | `/api/workspace/dev-server/start` | Start from guide (idempotent) |
| POST | `/api/workspace/dev-server/stop` | Stop managed process |

Client: [`src/config/startup-api.ts`](../src/config/startup-api.ts).

## Server

- [`server/dev-server/parse-startup.js`](../server/dev-server/parse-startup.js) — frontmatter parser
- [`server/dev-server/manager.js`](../server/dev-server/manager.js) — spawn/stop/health, `config.json` → `workspace.devServerByPath`
- [`server/terminal-runner.js`](../server/terminal-runner.js) — `createBackgroundRun` (no 30s timeout; **`detached: true` only on non-Windows** — on win32, detached spawns a stray console window that `windowsHide` cannot suppress)

## Tools

- `start_background_command` / `stop_background_command` — [`src/tools/definitions.ts`](../src/tools/definitions.ts), shell sub-agent allowlist in [`src/agents/defaults/sub-agents.json`](../src/agents/defaults/sub-agents.json)

## Tests

- `test/workspace/startup-parse.test.js`
- `test/workspace/dev-server-api.test.js`
- `test/workspace/dev-server-manager.test.js`
- `test/workspace/effective-guide.test.js`
- `test/ui/hub-dev-server.test.mts` (pure view model in [`src/ui/hub-dev-server-view.ts`](../src/ui/hub-dev-server-view.ts))
- `test/ui/terminal-tabs-dev-server.test.mts` (Agent → Dev server tab order, `isDevServerTabId`)

## Out of scope (v1)

- Auto-open preview to `healthUrl`
- Multiple concurrent dev processes per workspace
- Monorepo multiple `startup.md` files
