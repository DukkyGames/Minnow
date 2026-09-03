# MIN-562 — Models stay loaded after restart

## Problem

When a user loads a model through **Models → My Models** (llama.cpp / MLX / etc.) and then restarts Minnow, the **Local Server** UI and chat binding can still show the model as **Ready / loaded**, but inference returns **HTTP 400** because no process is actually serving that model.

## Root cause

1. **Persisted serve index** — Active serves are stored in `~/.minnow/models/serves.json` ([`server/models/serve.js`](../server/models/serve.js)). Rows are written with `status: 'running'` (or `'starting'` during async load).

2. **Child processes do not survive restart** — llama.cpp serves are spawned via the terminal runner; MLX uses the managed `mlx-lm` server. After Minnow exits, those processes are gone unless an external runtime (Ollama / LM Studio) is still up.

3. **Shutdown did not always persist `stopped`** — `shutdownAllModelServes()` is async but was fired without `await` on SIGTERM in `server.js`, and **packaged Electron** tears down the in-process HTTP server without calling `shutdownAllModelServes()` at all ([`electron/main.ts`](../electron/main.ts)). A normal quit often left `serves.json` unchanged.

4. **No startup reconciliation** — Unlike download jobs ([`reconcileInterruptedJobs`](../server/models/download.js)), serves were loaded from disk and returned to the UI as-is.

## Plan (implemented)

| Step | Action |
|------|--------|
| 1 | On first `loadServes()`, **reconcile** any `running` / `starting` row: probe terminal `runId` (llama.cpp) and HTTP health (`/health`, `/v1/models`). If not live, mark `running` → `stopped`, `starting` → `error` with `INTERRUPTED_SERVE_ERROR`, clear `runId`/`pid`, disable shared providers when no serves remain. |
| 2 | **Await** `shutdownAllModelServes()` on SIGINT/SIGTERM in `server.js`. |
| 3 | Call **`shutdownAllModelServes()`** from Electron `shutdownRuntime()` before closing the in-process server. |
| 4 | Add **`test/models/serve-reconcile.test.mjs`** mirroring the download restart test. |

## Out of scope (follow-ups)

- **Auto-resume** — Optionally re-spawn the last llama.cpp serve on boot (product decision; would need UX for “Restoring model…”).
- **Client-side health badge** — Periodic health poll in the Models store for long-lived sessions without server restart.
- **Provider `selectedModel` cleanup** — If chat still points at `minnow-library` after reconcile, picker may need a one-shot “model unavailable” nudge (separate issue if it persists after server fix).

## Verification

1. Load a GGUF via Models → Local Server shows **Ready**.
2. Quit Minnow completely (Electron or `npm start` stack).
3. Reopen → Local Server shows **Stopped** (not Ready); chat does not 400 on a fresh load.
4. `npm run test:models` — `serve-reconcile.test.mjs` passes.
