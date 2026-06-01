# Hub dev server: startup.md + background agent

## Summary

The Vibe Coding Hub **Dev server** strip cell no longer toggles the preview panel. It drives a workspace-scoped dev-server lifecycle from **`{workspaceRoot}/startup.md`**, with setup/start delegated to sub-agents and long-running processes managed on the Node tool server.

## User flow

| Cell state | Primary click | Console |
|------------|---------------|---------|
| Server offline (`npm run dev` only) | disabled | hidden |
| **Set up** (no `startup.md`) | `generalPurpose` agent writes guide | — |
| **Stopped** | `shell` agent starts via `start_background_command` | — |
| **Starting** | disabled | stream logs |
| **Running** | `POST /api/workspace/dev-server/stop` | stream logs |
| **Error** | retry (start agent) | stream logs if run exists |

Console uses [`attachDevServerConsole`](../src/ui/terminal-panel.ts) — opens the terminal agent tab without auto-opening the panel on start.

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

## APIs

| Method | Path | Role |
|--------|------|------|
| GET | `/api/workspace/startup` | Guide presence + coarse status |
| GET | `/api/workspace/dev-server/status` | Poll-friendly status + health |
| POST | `/api/workspace/dev-server/start` | Start from guide (idempotent) |
| POST | `/api/workspace/dev-server/stop` | Stop managed process |

Client: [`src/config/startup-api.ts`](../src/config/startup-api.ts).

## Server

- [`server/dev-server/parse-startup.js`](../server/dev-server/parse-startup.js) — frontmatter parser
- [`server/dev-server/manager.js`](../server/dev-server/manager.js) — spawn/stop/health, `config.json` → `workspace.devServerByPath`
- [`server/terminal-runner.js`](../server/terminal-runner.js) — `createBackgroundRun` (detached, no 30s timeout)

## Tools

- `start_background_command` / `stop_background_command` — [`src/tools/definitions.ts`](../src/tools/definitions.ts), shell sub-agent allowlist in [`src/agents/defaults/sub-agents.json`](../src/agents/defaults/sub-agents.json)

## Tests

- `test/workspace/startup-parse.test.js`
- `test/workspace/dev-server-api.test.js`
- `test/ui/hub-dev-server.test.mts` (pure view model in [`src/ui/hub-dev-server-view.ts`](../src/ui/hub-dev-server-view.ts))

## Out of scope (v1)

- Auto-open preview to `healthUrl`
- Multiple concurrent dev processes per workspace
- Monorepo multiple `startup.md` files
