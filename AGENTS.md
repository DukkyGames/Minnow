# AGENTS.md

## Cursor Cloud specific instructions

### Overview

Minnow is a Vite + TypeScript SPA chat client for LM Studio and other OpenAI-compatible local providers. It includes five composer modes (Build / Plan / Orchestrate / Research / Reef), 55 built-in tools, sub-agents, `~/.minnow` persistence when `npm start` runs, and a full settings page. See `README.md` for setup/scripts and `documentation/context.md` for architecture details. Gap audit: `documentation/plans/feature-audit-roadmap.md`.

### Running the app

- **`npm start`** is the recommended dev command — starts Vite + the Node tool server on port 5173 (or next free port). Set `BROWSER=none` to suppress auto-open.
- **`npm run dev`** starts Vite only (no tool server) — useful for pure UI work but most tool-dependent features won't function.
- The tool server exposes `/api/tools/ping`, `/api/config/ping`, `/api/memory/ping`, and other endpoints. Verify health with `curl http://localhost:5173/api/tools/ping`.
- **LM Studio headless daemon** (`llmster`) can be installed via `curl -fsSL https://lmstudio.ai/install.sh | bash`. Start with `lms daemon up && lms server start`. Download a model with `lms get <model-name> -y` and load it with `lms load <model-name> -y`. The CLI is at `~/.lmstudio/bin/lms` (add to PATH: `export PATH="$HOME/.lmstudio/bin:$PATH"`).
- **Known streaming issue**: The `llmster` headless daemon has a streaming SSE incompatibility with Minnow's browser-side parser — chat messages fail with a `ReadableStreamDefaultController` JSON parsing error. The server-side generation proxy works correctly (verified via curl). This does not affect the tool server APIs, tests, or builds — only live LLM chat in the browser UI.

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
