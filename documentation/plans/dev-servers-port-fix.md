# Fix Dev Servers port injection

## Problem

When you set **Port** on a Dev Server and start it, Minnow rewrote the command in [`server/dev-server/effective-guide.js`](../../server/dev-server/effective-guide.js) as if every `npm run dev` were Vite:

```text
npm run dev  →  npm run dev -- --port 3000
```

Projects whose script is `electron-vite dev` then crash with `CACError: Unknown option '--port'`. Spawn env only set `PORT` / `HOST` / `VITE_DEV_SERVER_HOST` — not `VITE_PORT` (board tasks already set `VITE_PORT` in [`server/workspace/board-task-ports.js`](../../server/workspace/board-task-ports.js)).

## Goal

- Port field means: **try to run this server on port N**.
- Never inject flags that break the underlying CLI.
- Auto-detect stack from command + resolved `package.json` script (no new Port-mode UI).

## Design

### 1. Resolve script body for every package-manager run

- Keep `expandPackageDevScript` for **concurrently** split-stacks (current behavior).
- `readPackageScriptBody(command, packageJsonDir)` returns the underlying script string for `npm|pnpm|yarn run <name>` whenever `package.json` is readable — used for **classification**, not always for rewriting the spawn command.

### 2. Detect stack, then choose injection strategy

`detectDevServerStack({ command, scriptBody })`:

| Stack | CLI injection | Env |
|--------|---------------|-----|
| `split-stack` (concurrently) | `--port` on **client** segments only | `PORT` = API port; `VITE_PORT` = UI port |
| `vite` (bare `vite`, not `electron-vite`) | `--port N` (+ `--host` on LAN) | `PORT`, `VITE_PORT`, `HOST` |
| `next` | `-p N` (skip if `-p` / `--port` already present) | `PORT`, `HOST` |
| `electron-vite` | **None** | `PORT`, `VITE_PORT`, `HOST` |
| `cra` / `react-scripts` | **None** | `PORT`, `HOST` |
| `unknown` | **None** | `PORT`, `VITE_PORT`, `HOST` |

**Rule:** `npm run dev` alone is not enough to classify as Vite.

Honest limitation (accepted): electron-vite only binds to Minnow's port if the project config reads `process.env.VITE_PORT` (or equivalent) under `renderer.server.port`. Minnow will no longer crash the start; forcing bind without config support is out of scope.

### 3. Align spawn env with board tasks

`buildDevServerSpawnEnv` always includes `VITE_PORT` = UI/client port.

## Implementation todos

- [x] Add `readPackageScriptBody` for npm/pnpm/yarn run commands (classification + keep concurrently expand)
- [x] Add `detectDevServerStack` + stack-specific CLI injection (vite / next / electron-vite / cra / unknown / split-stack)
- [x] Add `VITE_PORT` to `buildDevServerSpawnEnv`; wire stack through `resolveEffectiveGuide`
- [x] Extend effective-guide tests for electron-vite, next, bare vite, unknown, and `VITE_PORT` env
- [x] Update `documentation/context.md` + manual Dev servers note

## Out of scope

- New "Port mode" dropdown (can revisit if detection misses a stack).
- Patching or rewriting `electron.vite.config.*` to force `server.port`.
- Inferring the *actual* bound port from process listen tables for status (separate improvement).
