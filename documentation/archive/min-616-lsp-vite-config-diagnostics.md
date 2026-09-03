# MIN-616 — LSP diagnostics miss Vite configs

## Problem

When a builder agent scaffolds a Vite app, `get_lsp_diagnostics` on `vite.config.ts` reports a stale **Cannot find name 'process'**. `tsc --noEmit` with the same tsconfig is clean. The board report called this an LSP cache artifact.

Typical sequence:

1. Agent writes `vite.config.ts` using `process.env.VITE_PORT` (required by the orchestrator).
2. `get_lsp_diagnostics` runs before `npm install` / `@types/node` / `tsconfig.node.json` exist → real error.
3. Agent installs types or adds `tsconfig.node.json`.
4. A second `get_lsp_diagnostics` on the **unchanged** file still returns the old error.
5. After a tsserver restart, diagnostics are clean.

## Root cause

Two layers stay stale when the **file bytes** do not change:

1. **Agent snapshot cache** in [`server/lsp/manager.js`](../../server/lsp/manager.js) keys only on `sha256(file text)`. Installing `@types/node` or adding `tsconfig.node.json` is a cache hit.
2. **tsserver** does not re-associate an already-open `vite.config.ts` with the Node project / new `@types/node` until the language server process is restarted. `didChange` is not enough.

`tsc --noEmit` on `tsconfig.app.json` / a solution-style root (`"files": []`) never typechecks `vite.config.ts`, so it stays green while LSP is still looking at an inferred project from step 2.

## Plan

| Step | Action | Status |
|------|--------|--------|
| 1 | Reproduce with a Vite-style fixture: error without `@types/node`, still error after install (same bytes), clean after tsserver restart. | done |
| 2 | Fingerprint tsconfig/jsconfig/package.json + `@types/node` from the file up to the workspace root ([`server/lsp/project-fingerprint.js`](../../server/lsp/project-fingerprint.js)). | done |
| 3 | Include that fingerprint in the agent diagnostic snapshot key. | done |
| 4 | When the fingerprint changes, drop agent-scope TypeScript sync/snapshots and restart that tsserver so the next `didOpen` sees `tsconfig.node.json` and Node types. | done |
| 5 | Integration test: Vite `vite.config.ts` + `tsconfig.node.json`; error → install `@types/node` → clean, matching `tsc -p tsconfig.node.json`. | done |
| 6 | Unit tests for fingerprint (config add / types add). Update [`documentation/context.md`](../context.md). | done |

## Out of scope

- Changing builder prompts to avoid `process.env` in Vite configs (board isolation still requires `VITE_PORT`).
- Editor-scope tsserver restart on every `npm install` (agent tool path is the reported failure).
- Teaching tsserver to watch `node_modules/@types` without a process bounce.
