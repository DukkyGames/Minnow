# Step 17 — LSP Server Integration

**Type:** IMPLEMENTATION BUILD PLAN (no feature code in this document)  
**Roadmap:** [`documentation/plans/to-fix-step-order.md`](../to-fix-step-order.md) — Step 17  
**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) item **26** (LSP Servers)  
**Depends on:** **Step 02** (`~/.minnow` data layer + config API) — **required**  
**Helpful (not blocking):** Step 11 (file tree / viewer — natural trigger for `textDocument/didOpen`)  
**UI deferred to:** **Step 20** (master LSP toggle, per-server enable/disable, custom server editor, top-bar quick toggles)  
**Can parallel with:** Step 16, Step 18 (after Step 02)

---

## 1. Goal

Give the LLM **language-aware feedback** by integrating **Language Server Protocol (LSP)** servers in the Node dev server (`npm start`). Minnow should:

1. Ship an **OpenCode-compatible** built-in server catalog in-repo (`src/lsp/defaults.json`).
2. Persist user overrides in **`~/.minnow/lsp.json`** (seeded on first run, merged on upgrade).
3. Run a **process manager** in [`server.js`](../../../server.js) that spawns stdio LSP children, tracks diagnostics, and exposes HTTP APIs.
4. Expose **agent tools** (server-required) so the model can fetch diagnostics for a file/path.
5. Expose a **config data model + API** so Step 20 can render toggles without rework.

**Out of scope for Step 17**

- Full settings UI (Step 20).
- Auto-download / build of LSP binaries (OpenCode’s `OPENCODE_DISABLE_LSP_DOWNLOAD` pattern is **not** replicated in v1; document manual install).
- LSP features beyond diagnostics v1: `definition`, `references`, `hover`, `rename` (design hooks only).
- Running LSP under `npm run dev` (Vite-only) — degrade gracefully; tools return a clear “start with npm start” string.
- Wiring diagnostics into the file viewer UI (Step 11+) — optional hook only.

---

## 2. References (read before coding)

| Resource | Use |
|----------|-----|
| [OpenCode LSP docs — built-ins & custom servers](https://opencode.ai/docs/lsp/#custom-lsp-servers) | Config shape, built-in table, `disabled` / `command` / `extensions` / `env` / `initialization` |
| [OpenCode `packages/opencode/src/lsp`](https://github.com/anomalyco/opencode/tree/dev/packages/opencode/src/lsp) | `client.ts`, `launch.ts`, `server.ts`, `diagnostic.ts`, `language.ts` |
| [`documentation/context.md`](../../context.md) | Tools API, `server.js` patterns, project layout |
| Step 02 plan | `GET/PUT /api/config/*`, `~/.minnow/lsp/` layout |
| Step 20 plan | LSP settings section + `minnow.lsp` or merged `config.json` flags |

**OpenCode patterns to adopt (simplified for Minnow)**

- **Extension → server** matching; multiple servers may match one extension (run all enabled matches or first-wins — document choice; recommend **all enabled matchers** like OpenCode for eslint + typescript).
- **Project root** per server: walk upward for lockfiles (`package-lock.json`, `pnpm-lock.yaml`, …) or use `PROJECT_ROOT` from [`server.js`](../../../server.js).
- **Diagnostics:** subscribe to `textDocument/publishDiagnostics`; debounce ~150ms; optional `textDocument/diagnostic` pull when supported.
- **Initialize** with 45s timeout; stdio via `vscode-jsonrpc` `StreamMessageReader` / `StreamMessageWriter`.

---

## 3. Architecture

```mermaid
flowchart TB
  subgraph browser [Browser SPA]
    ToolsLoop[src/tools/loop.ts]
    Client[src/tools/client.ts]
    ConfigStub[src/lsp/config-client.ts]
  end

  subgraph node [server.js npm start]
    LspMW[/api/lsp/* middleware]
    LspMgr[LspManager]
    ProcMap[Process map per serverId]
    Defaults[src/lsp/defaults.json]
    UserCfg[~/.minnow/lsp.json]
  end

  subgraph child [Child processes]
    TS[typescript-language-server]
    Py[pyright langserver]
    Custom[custom --stdio]
    Fake[test/fixtures/fake-lsp.mjs]
  end

  ToolsLoop --> Client
  Client -->|POST /api/tools| LspMW
  ConfigStub -->|GET PUT /api/config/lsp| LspMW
  LspMW --> LspMgr
  LspMgr --> Defaults
  LspMgr --> UserCfg
  LspMgr --> ProcMap
  ProcMap --> TS
  ProcMap --> Py
  ProcMap --> Custom
  ProcMap --> Fake
```

### 3.1 Module layout (target)

```
src/lsp/
  defaults.json          # Full OpenCode built-in catalog + Minnow default enablement
  types.ts               # LspServerEntry, LspConfig, Diagnostic types
  merge-config.ts        # mergeDefaults(user) — pure, unit-testable
  format-diagnostics.ts  # LSP Diagnostic[] → LLM string
  config-client.ts       # fetch/put helpers for browser (Step 20 consumes)

server/
  lsp/
    manager.js           # LspManager class (or server/lsp-manager.js)
    client.js            # JSON-RPC connection per server
    stdio-transport.js   # Content-Length framing if not using vscode-jsonrpc only
    match-server.js      # extension + requirement checks
    project-root.js      # NearestRoot helpers

test/
  lsp/
    merge-config.test.mjs
    fake-lsp.integration.test.mjs
  fixtures/
    fake-lsp.mjs         # Minimal stdio LSP for tests
    sample-lsp.json      # Static user config fixture
```

**Note:** Implementer may colocate under `server/lsp/` or top-level `src/lsp/` for TS types only; **runtime LSP must live in Node** (not browser). Keep `server.js` thin: `import { createLspMiddleware } from './server/lsp/middleware.js'`.

---

## 4. Configuration

### 4.1 Repo defaults — `src/lsp/defaults.json`

Structure (OpenCode-compatible top-level `lsp` key):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "lsp": {
    "typescript": {
      "disabled": false,
      "command": ["typescript-language-server", "--stdio"],
      "extensions": [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".mts", ".cts"],
      "requirements": { "package": "typescript" }
    },
    "pyright": {
      "disabled": false,
      "extensions": [".py", ".pyi"],
      "requirements": { "package": "pyright" }
    }
  }
}
```

**Tasks for catalog authoring**

- [ ] Transcribe the **full** built-in table from [OpenCode LSP docs](https://opencode.ai/docs/lsp/#custom-lsp-servers) (astro, bash, clangd, csharp, … zls) into `defaults.json`.
- [ ] Add Minnow-specific metadata (not sent to LSP):
  - `requirements`: `{ "command": "go" }`, `{ "package": "eslint" }`, `{ "binary": "rust-analyzer" }`, etc.
  - `rootPatterns`: optional `["package-lock.json", "deno.json"]` for root detection.
  - `defaultEnabled`: boolean — **subset enabled on first seed** (see §4.3).
- [ ] Do **not** commit secrets; document Intelephense license path in README only.

### 4.2 User config — `~/.minnow/lsp.json`

Same `lsp` object shape. User entries **override** repo defaults by server id. Custom servers are arbitrary keys:

```json
{
  "lsp": {
    "typescript": { "disabled": true },
    "my-company-lsp": {
      "command": ["my-lsp", "--stdio"],
      "extensions": [".foo"],
      "env": { "FOO": "1" },
      "initialization": { "preferences": {} }
    }
  },
  "enabled": true
}
```

**Global master switch**

- `enabled: false` — manager does not spawn servers; tools return `"LSP is disabled in settings."`
- Step 20 maps this to “Language servers” master toggle.

### 4.3 Default-enabled subset (first seed)

On first `~/.minnow` init (Step 02), write `lsp.json` with **sensible defaults for this repo**:

| Server id | Default on | Reason |
|-----------|------------|--------|
| `typescript` | yes | Minnow is TS/Vite |
| `eslint` | yes if `eslint` in project | Lint signal for agent |
| `pyright` | yes if `.py` work expected | optional off by default |
| `rust`, `gopls`, `lua-ls`, `yaml-ls`, `bash` | off | enable when detected / user opts in |
| Framework (`vue`, `svelte`, `astro`) | off | enable when project files exist |

All other built-ins: **`disabled: true`** in seeded user file (still documented in defaults.json for one-click enable in Step 20).

### 4.4 Merge rules (`merge-config.ts`)

| Rule | Behavior |
|------|----------|
| Base | `defaults.json` → `lsp` map |
| User file | Deep-merge per server id |
| `disabled: true` | Server excluded from spawn list |
| User `command` / `extensions` | Replaces default for that id |
| Unknown id in user file | Treated as custom server |
| Upgrade | Re-read defaults; add **new** server ids from repo without wiping user `disabled` |

---

## 5. Process manager (`server.js`)

### 5.1 `LspManager` responsibilities

| Responsibility | Detail |
|----------------|--------|
| **Lifecycle** | `ensureServer(serverId, filePath)` → spawn if needed, `initialize`, `initialized` |
| **Per-server process** | Map `serverId → { process, connection, root, capabilities, diagnosticsCache }` |
| **Shutdown** | On process exit, remove from map; on server SIGINT, kill children |
| **Concurrency** | Serialize initialize per `serverId`; allow parallel different servers |
| **Workspace** | `rootUri` = `file://` project root from `project-root.js` |
| **Document sync** | On diagnostic request: `didOpen` → wait for `publishDiagnostics` (debounced) → return formatted string |
| **Requirements** | Before spawn: `which(command[0])`, `require('typescript')` resolve, etc. — return human-readable skip reason |

### 5.2 Spawn command resolution

Priority:

1. User `command` from merged config.
2. Else built-in `command` from defaults.
3. Else built-in **spawn recipe** in code (port minimal recipes from OpenCode `server.ts` only for `typescript`, `eslint`, `pyright` in v1; others return `"Install {binary} or set lsp.{id}.command in ~/.minnow/lsp.json"`).

**Environment:** merge `process.env` + per-server `env`.

**Windows:** use `shell: false`; resolve `.cmd` for npm bins when needed.

### 5.3 HTTP routes (new middleware)

Mount **before** Vite handler (same pattern as `/api/tools`):

| Route | Method | Body / query | Response |
|-------|--------|--------------|----------|
| `/api/lsp/status` | GET | — | `{ enabled, servers: [{ id, running, pid?, lastError? }] }` |
| `/api/lsp/diagnostics` | POST | `{ path: string }` | `{ result: string }` or `{ diagnostics: Diagnostic[] }` — prefer `result` string for tool parity |
| `/api/lsp/notify` | POST | `{ path, event: "open" \| "change" \| "close" }` | `{ ok: true }` — for Step 11 file viewer |
| `/api/config/lsp` | GET | — | merged config (defaults + user) |
| `/api/config/lsp` | PUT | partial `lsp.json` | saved user file |

**CORS / OPTIONS:** mirror [`createToolsMiddleware`](../../../server.js).

**Path safety:** resolve `path` with existing `resolveSafePath()` relative to `PROJECT_ROOT`.

### 5.4 Integration with existing tools middleware

Option A (recommended): add tools `get_lsp_diagnostics` / `list_lsp_servers` to `SERVER_TOOL_HANDLERS` in `server.js` that delegate to `LspManager` (consistent with other tools).

Option B: separate `/api/lsp/*` only — client must call different URL (more churn in `client.ts`).

**Choose A** for [`executeServerTool`](../../../server.js) consistency.

---

## 6. LSP client (JSON-RPC)

### 6.1 Dependencies (add to `package.json`)

| Package | Purpose |
|---------|---------|
| `vscode-jsonrpc` | stdio message connection |
| `vscode-languageserver-types` | `Diagnostic`, `Range` types |

Keep optional: do not add full `vscode-languageclient` unless needed.

### 6.2 Minimal protocol sequence

1. Spawn child: `stdin/stdout` piped; stderr logged to `~/.minnow/logs/lsp/{serverId}.log`.
2. `initialize` → `initialized`.
3. `textDocument/didOpen` with `TextDocumentItem`.
4. Wait for `textDocument/publishDiagnostics` **or** timeout (5s test / 10s prod).
5. Optionally `shutdown` / `exit` on idle TTL (v1: keep process alive for session; optional 30m idle kill).

### 6.3 Diagnostic formatting (`format-diagnostics.ts`)

Static, LLM-friendly text (deterministic tests):

```
src/main.ts
  [Error] L12:5 — ';' expected. (ts)
  [Warning] L3:1 — 'foo' is declared but never used. (ts)
```

- Sort by line, then character.
- Cap at **50** diagnostics per call; append `… and N more` if truncated.
- Empty: `No LSP diagnostics for src/main.ts.`

---

## 7. Agent tools

Add to [`src/tools/definitions.ts`](../../../src/tools/definitions.ts) (new category **`lsp`** or under **`code`**):

| Tool name | serverRequired | Description |
|-----------|----------------|-------------|
| `get_lsp_diagnostics` | true | Returns formatted diagnostics for a project-relative file path |
| `list_lsp_servers` | true | Returns JSON list of configured servers, running state, last error |

**Parameters `get_lsp_diagnostics`**

```json
{
  "path": { "type": "string", "description": "Relative file path" }
}
```

**Handler behavior**

1. If global LSP disabled → `Error: LSP is disabled. Enable in settings (npm start required).`
2. Match enabled servers for extension.
3. For each matcher, `ensureServer` + sync document + collect diagnostics.
4. Concatenate with server id headers.

**Tool config (Step 17 data model only)**

Extend `minnow.tools` or new `~/.minnow/config.json` field:

```json
{
  "lsp": {
    "masterEnabled": true,
    "toolsEnabled": {
      "get_lsp_diagnostics": true,
      "list_lsp_servers": true
    }
  }
}
```

Wire `getEnabledToolDefinitions()` to respect `toolsEnabled` when Step 02 config API exists. Until then, default **on** when server ping succeeds.

---

## 8. Browser client hooks (minimal — Step 20 completes UI)

### 8.1 `src/lsp/config-client.ts`

- `fetchLspConfig(): Promise<LspConfig>`
- `saveLspConfig(partial): Promise<void>`
- `fetchLspStatus(): Promise<LspStatus>`

Used later by settings; Step 17 may only use from tests or dev console.

### 8.2 Step 20 contract (implement data model now)

Document in `types.ts`:

```typescript
export interface LspSettingsViewModel {
  masterEnabled: boolean;
  servers: Array<{
    id: string;
    label: string;
    disabled: boolean;
    running: boolean;
    extensions: string[];
    isCustom: boolean;
  }>;
}
```

`GET /api/config/lsp` returns enough to render toggles **without** parsing raw JSON in the UI.

---

## 9. File open hooks (Step 11 integration)

When Step 11 lands, file viewer calls:

```typescript
await fetch('/api/lsp/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path: 'src/main.ts', event: 'open' }),
});
```

Step 17: implement endpoint; **no viewer required for acceptance**.

---

## 10. Fake LSP stdio test server

**File:** `test/fixtures/fake-lsp.mjs`

Minimal JSON-RPC 2.0 over LSP framing (Content-Length headers):

- Handles `initialize` → returns capabilities with `textDocumentSync: 1`.
- Handles `initialized` (no response).
- On `textDocument/didOpen` for `file://.../sample.ts`, emit `textDocument/publishDiagnostics` with **static** diagnostics (fixed line/message).
- Handles `shutdown` / `exit`.

Register in `defaults.json` under test-only id `fake` **or** inject via test `lsp.json` fixture:

```json
{
  "lsp": {
    "fake": {
      "command": ["node", "test/fixtures/fake-lsp.mjs"],
      "extensions": [".fake"],
      "disabled": false
    }
  }
}
```

**Integration test** (`test/lsp/fake-lsp.integration.test.mjs`):

1. Set `MINNOW_HOME` to temp dir.
2. Copy fixture `lsp.json`.
3. Start middleware / call manager directly (export `createLspManagerForTest`).
4. POST diagnostics for `test/sample.fake`.
5. Assert static substring in result (no dynamic dates).

---

## 11. Unit tests (deterministic)

| Test file | Cases |
|-----------|--------|
| `test/lsp/merge-config.test.mjs` | user `disabled` wins; custom server preserved; new defaults merged |
| `test/lsp/match-server.test.mjs` | `.ts` → typescript; disabled skipped |
| `test/lsp/format-diagnostics.test.mjs` | static input → static expected string |
| `test/lsp/fake-lsp.integration.test.mjs` | end-to-end stdio |

**Run command** (add to Step 02 `npm test` or document):

```bash
node --test test/lsp/*.test.mjs
```

---

## 12. Documentation updates

- [ ] [`documentation/context.md`](../../context.md) — new section **LSP** (config paths, APIs, tools, env vars).
- [ ] [`README.md`](../../../README.md) — prerequisites (`typescript-language-server`, `pyright`, etc.), `~/.minnow/lsp.json` example.
- [ ] `documentation/plans/verification/step-17.md` — commands for verifier (implementer creates).

**Env vars**

| Variable | Default | Purpose |
|----------|---------|---------|
| `MINNOW_HOME` | `~/.minnow` | Override home for tests |
| `MINNOW_LSP_ENABLED` | `true` | Kill-switch for CI |
| `MINNOW_LSP_IDLE_MS` | optional | Process idle shutdown |

---

## 13. Acceptance criteria

| # | Criterion |
|---|-----------|
| AC-1 | `src/lsp/defaults.json` contains full OpenCode built-in catalog + Minnow `defaultEnabled` metadata |
| AC-2 | First-run seeds `~/.minnow/lsp.json`; merge preserves user disables across upgrades |
| AC-3 | `npm start` spawns fake LSP in tests; real `typescript` spawn optional (mocked in CI) |
| AC-4 | `get_lsp_diagnostics` returns formatted static diagnostics for fake server |
| AC-5 | `list_lsp_servers` reports running/stopped and respects `disabled` |
| AC-6 | Master `enabled: false` prevents spawns; tools return clear message |
| AC-7 | `GET/PUT /api/config/lsp` works when Step 02 config middleware exists |
| AC-8 | `npm run dev` — tools fail gracefully (server not available or LSP stub message) |
| AC-9 | `documentation/context.md` updated |
| AC-10 | All `node --test test/lsp/*.test.mjs` pass in clean CI |

---

## 14. Implementation todos

### Phase 0 — Prerequisites

- [ ] **T0.1** Confirm Step 02 delivers `MINNOW_HOME`, `GET/PUT /api/config/*`, and `~/.minnow/lsp/` path — or implement minimal config I/O in Step 17 if Step 02 is incomplete (document dependency).
- [ ] **T0.2** Add `vscode-jsonrpc` + `vscode-languageserver-types` to `package.json`.
- [ ] **T0.3** Create `documentation/plans/verification/step-17.md` stub with test commands.

### Phase 1 — Config layer

- [ ] **T1.1** Create `src/lsp/types.ts` (`LspServerEntry`, `LspConfig`, `MergedLspConfig`).
- [ ] **T1.2** Author `src/lsp/defaults.json` (full OpenCode table + metadata).
- [ ] **T1.3** Implement `src/lsp/merge-config.ts` with unit tests.
- [ ] **T1.4** Implement server-side loader: read defaults from repo + user from `~/.minnow/lsp.json`.
- [ ] **T1.5** Seed `lsp.json` on first home init (hook Step 02 migration).

### Phase 2 — LSP runtime (Node)

- [ ] **T2.1** Implement `server/lsp/project-root.js` (nearest lockfile / `PROJECT_ROOT`).
- [ ] **T2.2** Implement `server/lsp/match-server.js` (extension + requirements).
- [ ] **T2.3** Implement `server/lsp/client.js` (JSON-RPC connection, initialize, didOpen, publishDiagnostics listener).
- [ ] **T2.4** Implement `server/lsp/manager.js` (process map, spawn, shutdown, diagnostic cache).
- [ ] **T2.5** Wire `createLspMiddleware()` into `server.js` (`/api/lsp/*`, `/api/config/lsp`).
- [ ] **T2.6** Add stderr logging to `~/.minnow/logs/lsp/{id}.log`.

### Phase 3 — Diagnostics formatting & tools

- [ ] **T3.1** Implement `src/lsp/format-diagnostics.ts` + unit tests.
- [ ] **T3.2** Add `get_lsp_diagnostics` and `list_lsp_servers` to `SERVER_TOOL_HANDLERS`.
- [ ] **T3.3** Add tool definitions to `src/tools/definitions.ts` (`serverRequired: true`, category `lsp`).
- [ ] **T3.4** Ensure `getEnabledToolDefinitions()` includes LSP tools when config allows.
- [ ] **T3.5** Implement `src/lsp/config-client.ts` (browser fetch helpers).

### Phase 4 — Built-in spawn recipes (incremental)

- [ ] **T4.1** `typescript` — resolve `typescript-language-server` + project `typescript` (OpenCode recipe).
- [ ] **T4.2** `eslint` — `node` + vscode-eslint server path or skip with message.
- [ ] **T4.3** `pyright` — `pyright-langserver --stdio` when package present.
- [ ] **T4.4** Document remaining servers as config-only (user supplies `command`).

### Phase 5 — Test fixtures

- [ ] **T5.1** Implement `test/fixtures/fake-lsp.mjs` (stdio, static diagnostics).
- [ ] **T5.2** Add `test/fixtures/sample-lsp.json` and `test/fixtures/sample.fake` file.
- [ ] **T5.3** Export `createLspManagerForTest({ homeDir })` for integration tests.
- [ ] **T5.4** Write `test/lsp/fake-lsp.integration.test.mjs` (static expected strings).
- [ ] **T5.5** Add `node --test test/lsp/*.test.mjs` to `package.json` `test` script (or `test:lsp`).

### Phase 6 — Integration & docs

- [ ] **T6.1** Manual smoke: `npm start` → enable fake or typescript → call `POST /api/tools` with `get_lsp_diagnostics`.
- [ ] **T6.2** Update `documentation/context.md` (LSP section, new tools, paths).
- [ ] **T6.3** Update `README.md` (install notes, config example).
- [ ] **T6.4** Expose `LspSettingsViewModel` shape for Step 20 in API response.
- [ ] **T6.5** Implement `/api/lsp/notify` for future file viewer (Step 11).

### Phase 7 — Verifier handoff

- [ ] **T7.1** Fill `documentation/plans/verification/step-17.md` with exact commands and expected output.
- [ ] **T7.2** Verifier runs `node --test test/lsp/*.test.mjs` on clean temp `MINNOW_HOME`.
- [ ] **T7.3** Verifier confirms PASS/FAIL per §13 acceptance criteria.

---

## 15. Sub-agent implementer prompt (copy-paste)

```
You are implementing Step 17 — LSP server integration for Minnow.

Read first:
- documentation/plans/Build out/step-17-lsp-integration.md (this plan)
- documentation/context.md
- documentation/plans/to-fix-step-order.md (Step 17 section)
- server.js, src/tools/definitions.ts, src/tools/client.ts

Depends on Step 02 (~/.minnow + /api/config). If missing, implement minimal config read/write for lsp.json only.

Deliver:
- src/lsp/defaults.json (full OpenCode catalog)
- ~/.minnow/lsp.json seed + merge-config
- server/lsp/* manager + JSON-RPC client
- server.js middleware + tool handlers get_lsp_diagnostics, list_lsp_servers
- test/fixtures/fake-lsp.mjs + node --test suite
- documentation/context.md update

Do NOT build Step 20 settings UI. Expose GET/PUT /api/config/lsp and status for future UI.

Run: node --test test/lsp/*.test.mjs
Update documentation/plans/verification/step-17.md with commands.
```

---

## 16. Sub-agent verifier prompt (copy-paste)

```
You are the verifier for Step 17 — LSP integration. Do not implement features.

Read acceptance criteria in documentation/plans/Build out/step-17-lsp-integration.md §13.
Run commands from documentation/plans/verification/step-17.md.

Required:
1. node --test test/lsp/*.test.mjs (MINNOW_HOME=temp dir)
2. Confirm fake-lsp integration returns static expected diagnostics
3. Confirm merge-config tests pass
4. Confirm context.md documents LSP paths and tools

Optional manual (if typescript-language-server installed):
- POST /api/tools { "name": "get_lsp_diagnostics", "args": { "path": "src/main.ts" } }

Report PASS/FAIL per criterion with log excerpts.
```

---

## 17. Risk register

| Risk | Mitigation |
|------|------------|
| OpenCode spawn recipes are large | v1: typescript + eslint + pyright code recipes; rest config-only |
| LSP binaries not installed | Clear tool messages; `list_lsp_servers` shows `lastError` |
| Windows stdio / `.cmd` | Test on win32 in CI or document manual QA |
| Multiple servers per file | Concatenate diagnostics with server id header |
| Memory leaks from zombie LSP | Kill on parent exit; optional idle TTL |
| Step 02 delay | Minimal `lsp.json` read/write in Step 17 behind flag |

---

*Plan version: 1.0 — 2026-05-19*
