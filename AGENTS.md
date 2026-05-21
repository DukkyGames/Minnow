# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Minnow is a Vite + TypeScript SPA chat client for LM Studio. See `README.md` for setup/scripts and `documentation/context.md` for architecture details.

### Running the app

- **`npm start`** is the recommended dev command — starts Vite + the Node tool server on port 5173 (or next free port). Set `BROWSER=none` to suppress auto-open.
- **`npm run dev`** starts Vite only (no tool server) — useful for pure UI work but most tool-dependent features won't function.
- The tool server exposes `/api/tools/ping`, `/api/config/ping`, `/api/memory/ping`, and other endpoints. Verify health with `curl http://localhost:5173/api/tools/ping`.
- LM Studio is **not available** in Cloud Agent VMs, so the model dropdown will be empty and LLM chat will not function. All UI, tool server APIs, and tests work without it.

### Testing

- **`npm test`** runs the full suite (~500 tests via `node --test` and `tsx`). Expect 5 pre-existing failures in reef widget convention tests — these are known and unrelated to general functionality.
- **`npx tsc --noEmit`** for type checking (no separate ESLint config exists).
- Subset test commands: `npm run test:memory`, `npm run test:lsp`, `npm run test:mcp`, `npm run test:browser`, `npm run test:skills`, `npm run test:attachments`. See `package.json` scripts for the full list.

### Building

- **`npm run build`** runs `tsc && vite build` and outputs to `dist/`. The `prebuild` step generates `src/skills/builtin-manifest.json`.

### Key gotchas

- The `postinstall` script runs `node scripts/sync-impeccable-skill.mjs` to vendor the Impeccable UI skill into `src/skills/impeccable/`. This is expected and idempotent.
- `get_datetime` and `calculate` are **browser-only** tools — calling them via the `/api/tools` POST endpoint returns "Not implemented" since they run client-side in the browser.
- The `[providers] fetch failed` log on startup is normal in environments without LM Studio — it simply means the provider discovery couldn't reach `localhost:1234`.
