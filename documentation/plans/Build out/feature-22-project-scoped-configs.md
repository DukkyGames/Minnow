# Feature #22 — Project-scoped everything

**Roadmap:** [`documentation/plans/feature-audit-roadmap.md`](../feature-audit-roadmap.md) item **#22**  
**Architecture:** [`documentation/context.md`](../../context.md) — Persistence (`~/.minnow`), workspace root, session workspace scoping  
**Sequencing:** **Foundational** — complete **before** #13 prompt profiles, #16 agent packs, #17 tool plugins, and #18 headless `--workspace` (roadmap § Suggested sequencing).

---

## Todos

```yaml
todos:
  - id: f22-0-spec
    content: "Lock resolver contract (layers, merge rules, write targets, secrets policy) in server/config/layers.md"
    status: pending
  - id: f22-1-resolver-core
    content: "Implement server/config/layers.js — getConfigLayers(), resolveConfigPath(), invalidate on workspace change"
    status: pending
  - id: f22-2-store-json
    content: "Wire readResource/writeResource + paths.js whitelist through layered resolver for flat JSON keys"
    status: pending
  - id: f22-3-prompts-skills
    content: "Extend buildPromptRegistry + skills scan — project > user > builtin merge"
    status: pending
  - id: f22-4-agents-mcp-lsp
    content: "Layer work-agents, sub-agents, mcp.json/mcp/, lsp.json loaders"
    status: pending
  - id: f22-5-memory-providers
    content: "Project memory/ + provider profiles; secrets remain user-only"
    status: pending
  - id: f22-6-scaffold-git
    content: "Scaffold .minnow/ on init; ship .minnow/.gitignore template; file-tree already skips .minnow"
    status: pending
  - id: f22-7-client-ui
    content: "Settings hints (scope badge), write scope API, workspace switch cache bust"
    status: pending
  - id: f22-8-tests
    content: "test/config/layers-*.test.js + per-loader integration; MINNOW_HOME + temp workspace fixtures"
    status: pending
  - id: f22-9-docs
    content: "Update documentation/context.md persistence + project .minnow layout"
    status: pending
```

---

## Summary

Minnow already **scopes chats by workspace folder** (`Chat.workspacePath`, `lastActiveChatIdByWorkspace` in `sessions/state.json`). Agent bindings, prompts, tools, MCP, LSP, memory, and most settings still load from a **single global** `~/.minnow/` tree. Feature #22 adds a **project layer**: `<workspace>/.minnow/` overrides user overrides, which override **built-in repo defaults**, with one shared resolver used by every config loader.

---

## Current state

| Area | Behavior today | Primary paths |
|------|----------------|---------------|
| **User home** | Canonical store when `npm start`; `MINNOW_HOME` override for tests | [`server/config/home.js`](../../../server/config/home.js), [`server/config/store.js`](../../../server/config/store.js) |
| **Workspace root** | Active folder for tools/file tree; persisted in global `config.json` → `workspace.path` | [`server/workspace/root.js`](../../../server/workspace/root.js) |
| **Chats** | Single `sessions/state.json`; chats filtered by `workspacePath` | [`src/state/session-workspace-scope.ts`](../../../src/state/session-workspace-scope.ts), [`src/state/sessions.ts`](../../../src/state/sessions.ts) |
| **Flat JSON API** | Whitelist under home only (`ALLOWED_CONFIG_FILES`) | [`server/config/paths.js`](../../../server/config/paths.js) |
| **Prompts** | Built-in `src/chat/prompts/` + user `~/.minnow/prompts/` (user wins) | [`server/prompts/registry.js`](../../../server/prompts/registry.js), [`src/chat/prompts/prompt-loader.ts`](../../../src/chat/prompts/prompt-loader.ts) |
| **Prompt configs** | `~/.minnow/prompt-configs/*.json` only | [`server/prompt-configs/handlers.js`](../../../server/prompt-configs/handlers.js) |
| **Skills** | Built-in `src/skills/` + user `~/.minnow/skills/` | [`server/skills/scan.js`](../../../server/skills/scan.js), [`src/skills/loader.ts`](../../../src/skills/loader.ts) |
| **Tools / rules** | `tools.json`, `rules.json` via `/api/config/*` | [`src/tools/config.ts`](../../../src/tools/config.ts), [`src/config/user-rules.ts`](../../../src/config/user-rules.ts) |
| **Work / sub-agents** | `work-agents.json`, `sub-agents.json`, prompt overrides under `prompts/` | [`server/work-agents/registry.js`](../../../server/work-agents/registry.js), [`src/agents/sub-agent-config.ts`](../../../src/agents/sub-agent-config.ts) |
| **Providers** | `~/.minnow/providers/<id>/profile.json` + `secrets.json` | [`server/providers/store.js`](../../../server/providers/store.js) |
| **MCP** | `mcp.json` + `mcp/<id>/` under home | [`server/mcp/registry.js`](../../../server/mcp/registry.js) |
| **LSP** | `src/lsp/defaults.json` merged with `~/.minnow/lsp.json` | [`server/lsp/config-loader.js`](../../../server/lsp/config-loader.js) |
| **Memory** | `~/.minnow/memory/` + `config.json` → `memory` block | [`server/memory/store.js`](../../../server/memory/store.js), [`server/memory/paths.js`](../../../server/memory/paths.js) |
| **Reef widgets** | Built-in + synced `~/.minnow/reef/` (not workspace) | [`server/reef/widget-paths.js`](../../../server/reef/widget-paths.js) |
| **File tree** | `.minnow` directory already skipped in index walks | [`src/ui/file-tree-filter.ts`](../../../src/ui/file-tree-filter.ts) |
| **Client persistence** | `detectConfigServer()` → server vs `localStorage` | [`src/config/storage-mode.ts`](../../../src/config/storage-mode.ts) |

**Global `~/.minnow/` layout (from context.md):** `config.json`, `sessions/state.json`, `tools.json`, `skills.json`, `system-prompt.json`, `rules.json`, `work-agents.json`, `sub-agents.json`, `providers/`, `mcp/`, `lsp.json`, `prompt-configs/`, `prompts/`, `skills/`, `memory/`, `reef/`, logs, screenshots, backups.

**Not project-scoped today:** Every loader above resolves paths with `getMinnowHome()` only (except built-in repo roots). No read of `<workspace>/.minnow/`.

---

## Gap

- No **`.minnow/` directory convention** inside the user’s project repo.
- No **layered resolution** (workspace → user → built-in).
- Settings UI copy assumes **all overrides live in `~/.minnow`** ([`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts)).
- **Write ambiguity:** Saving tools/rules/agents always targets global home, so teams cannot commit shared project defaults.
- **Headless / CI** (#18) needs `--workspace` to imply project config; blocked without this layer.
- **Profiles / packs** (#13, #16, #17) need a stable “project default” anchor — roadmap explicitly sequences #22 first.

---

## Goals

1. **Auto-detect** project config from the active workspace path (`getWorkspaceRoot()`).
2. **Mirror layout:** `<workspace>/.minnow/` uses the same relative paths as `~/.minnow/` where it makes sense (git-friendly, optional commit).
3. **Single resolver** used by every server-side loader; client receives **effective** config via existing APIs (minimal breaking changes).
4. **Predictable writes:** User edits in Settings **prefer the project layer** when a workspace is open and `.minnow/` exists (or after scaffold); machine-wide items stay in `~/.minnow`.
5. **Secrets safe-by-default:** Never require committing `secrets.json`, API keys, or `tools.json` keys; document `.gitignore` patterns.
6. **Cache-safe** workspace switches: invalidate merged caches when `setWorkspaceRoot` runs.

### Non-goals (v1)

- Moving **chat history** into the repo by default (sessions stay in `~/.minnow/sessions/state.json`; chats remain keyed by `workspacePath`). Optional phase: `.minnow/sessions/state.json` for explicit “team session export.”
- **Reef widget library** per project (stay user/install scoped unless a follow-up asks for `reef/` in project layer).
- **Vite-only** (`npm run dev`) reading project `.minnow` without the Node server (document limitation; ping still required).

---

## Acceptance criteria

- [ ] With workspace `W` containing `W/.minnow/tools.json` disabling a tool, effective tool config reflects project file after merge with user + defaults.
- [ ] With `W/.minnow/prompts/modes/build.full.md`, prompt registry reports **project** source and body wins over `~/.minnow` and built-in.
- [ ] `W/.minnow/work-agents.json` overrides global bindings for agents when workspace `W` is active; switching workspace to `W2` loads `W2`’s layer (or falls back).
- [ ] `W/.minnow/rules.json` applies to sends for chats with `workspacePath === W` (global rules still apply as lower layer if not overridden).
- [ ] `W/.minnow/memory/` entries are visible to memory tools for that workspace only; user-global memory remains under `~/.minnow/memory/` when no project entry exists.
- [ ] Provider **profile** in `W/.minnow/providers/<id>/profile.json` merges; **secrets** load only from `~/.minnow/providers/<id>/secrets.json`.
- [ ] Saving from Settings (tools, rules, sub-agents, work-agent prompt) writes to **project layer** when `.minnow/` exists; UI shows **Project** vs **User** scope.
- [ ] `POST /api/workspace` (or scaffold endpoint) creates `W/.minnow/` from template + `.gitignore` without touching user home.
- [ ] `resolveConfigPath` traversal tests extended for project roots; no `..` escape from `W/.minnow`.
- [ ] `npm test` green; new suites in `test/config/layers-*.test.js` and at least one integration test per major loader.
- [ ] `documentation/context.md` updated with layered persistence diagram and tables.

---

## Architecture

### Resolution order (read path)

```text
                    ┌─────────────────────┐
                    │  Built-in defaults   │  repo: src/chat/prompts, src/skills,
                    │  (lowest precedence) │  src/lsp/defaults.json, sub-agents.json, …
                    └──────────┬──────────┘
                               │ merge / overlay
                    ┌──────────▼──────────┐
                    │  User ~/.minnow/    │  MINNOW_HOME / getMinnowHome()
                    └──────────┬──────────┘
                               │ merge / overlay
                    ┌──────────▼──────────┐
                    │  Project            │  getWorkspaceRoot() + '/.minnow'
                    │  <workspace>/.minnow│  (highest precedence)
                    └─────────────────────┘
```

### Resolver module (new)

**File:** `server/config/layers.js` (and types in `server/config/layers-types.d.ts` or JSDoc typedefs).

| Export | Responsibility |
|--------|----------------|
| `getConfigLayers()` | `{ project: string \| null, user: string, builtinRoot: string }` |
| `getProjectMinnowRoot()` | `path.join(getWorkspaceRoot(), '.minnow')` if directory exists (or always return path for scaffold) |
| `resolveLayeredPath(relativeKey, { layer: 'project' \| 'user' })` | Safe join + traversal guard (reuse logic from [`server/config/paths.js`](../../../server/config/paths.js)) |
| `readLayeredJson(relativeKey, { merge: MergeStrategy })` | Read project + user + default; return `{ effective, sources }` |
| `writeLayeredJson(relativeKey, data, { prefer: 'project' \| 'user' })` | Atomic write to chosen layer |
| `invalidateConfigLayerCache()` | Call from [`setWorkspaceRoot`](../../../server/workspace/root.js) |

**Workspace context:** Resolver reads **current** workspace from [`getWorkspaceRoot()`](../../../server/workspace/root.js), not from each chat’s `workspacePath`, for **machine-wide** settings APIs. For **send-time** behavior (rules, memory injection), also accept optional `workspacePath` from the active chat so background chats on another workspace do not leak config (see risks).

### Merge strategies (by resource type)

| Resource | Read merge | Write target (default) |
|----------|------------|-------------------------|
| `tools.json` | Deep merge: project `enabled`/`permissions` override user | Project if `.minnow/` exists, else user |
| `rules.json` | Project replaces user when present | Project |
| `sub-agents.json` | Deep merge on `types`; globals from project win | Project |
| `work-agents.json` | Per-id overlay | Project |
| `skills.json` | Project `enabled` flags overlay user | Project |
| `config.json` blocks | **Split policy:** `workspace.*`, `activeProviderId` stay **user**; `planning`, `chat`, `toolSecurity`, `memory`, `supervisor` allow project overlay | Block-specific |
| `system-prompt.json` | Project wins | Project |
| `prompt-configs/*.json` | Project file wins per id | Project |
| `prompts/**` | Project > user > builtin (extend registry) | Project |
| `skills/**` | Project > user > builtin | Project |
| `mcp.json` + `mcp/<id>/` | Project servers overlay; disabled flags merge | Project |
| `lsp.json` | Existing `mergeLspConfig` — add project as top layer | Project |
| `providers/<id>/profile.json` | Project overlay on profile fields | Project |
| `providers/<id>/secrets.json` | **User only** — never read/write project | User only |
| `memory/**` | Union index; project entries tagged `scope: project` | Project path for workspace-scoped saves |
| `sessions/state.json` | **User only (v1)** | User only |
| Logs, screenshots, backups, reef sync | **User / install** | Unchanged |

### API surface (minimal)

- Extend `GET /api/config/ping` with `{ projectRoot: string | null, projectConfigured: boolean }`.
- Optional: `POST /api/workspace/scaffold-minnow` → create template tree under current workspace.
- Existing resource routes (`/api/config/tools`, etc.) return merged payloads; optional `?drySources=1` for debugging (dev-only).

### Project layout (git-friendly)

```text
<workspace>/.minnow/
  .gitignore              # ignore secrets, local overrides (see template)
  README.md               # what to commit vs keep local
  tools.json              # team tool policy (no API keys)
  rules.json
  work-agents.json
  sub-agents.json
  skills.json
  prompts/                # modes, experts, work-agents, …
  prompt-configs/
  skills/
  mcp.json
  mcp/                    # server defs (no secrets in repo)
  lsp.json
  providers/              # profiles only; secrets in ~/.minnow
  memory/                 # project-specific notes
```

**Template `.gitignore` inside `.minnow/`:**

```gitignore
secrets.json
**/secrets.json
tools.json
*.local.json
.env
```

(Team may **opt in** to committing a redacted `tools.json` without `keys` — document in README.)

---

## Key files to touch

### New

| File | Purpose |
|------|---------|
| `server/config/layers.js` | Central resolver |
| `server/config/layer-merge.js` | Deep-merge helpers per resource |
| `server/config/scaffold-project-minnow.js` | Template + `.gitignore` |
| `test/config/layers-resolve.test.js` | Path safety + precedence |
| `test/config/layers-merge.test.js` | JSON merge tables |
| `test/config/layers-integration.test.mjs` | End-to-end with temp workspace |

### Server — refactor loaders to use layers

| File | Change |
|------|--------|
| [`server/config/paths.js`](../../../server/config/paths.js) | Delegate to `resolveLayeredPath`; expand whitelist for project-relative keys |
| [`server/config/store.js`](../../../server/config/store.js) | `readConfigJson` / `writeConfigJson` → layered |
| [`server/workspace/root.js`](../../../server/workspace/root.js) | `invalidateConfigLayerCache()` on `setWorkspaceRoot` |
| [`server/prompts/registry.js`](../../../server/prompts/registry.js) | Ingest `project` root third |
| [`server/prompt-configs/handlers.js`](../../../server/prompt-configs/handlers.js) | List/load/save project dir first |
| [`server/skills/scan.js`](../../../server/skills/scan.js) | `getProjectSkillsRoot()` |
| [`server/work-agents/registry.js`](../../../server/work-agents/registry.js) | Layered JSON + prompts |
| [`server/work-agents/paths.js`](../../../server/work-agents/paths.js) | Project-safe paths |
| [`server/mcp/registry.js`](../../../server/mcp/registry.js) | Layered `mcp.json` + dirs |
| [`server/lsp/config-loader.js`](../../../server/lsp/config-loader.js) | Project `lsp.json` |
| [`server/providers/store.js`](../../../server/providers/store.js) | Profile from project; secrets from user |
| [`server/memory/paths.js`](../../../server/memory/paths.js) | Project memory root + merge index |
| [`server/memory/store.js`](../../../server/memory/store.js) | Scope-aware CRUD |
| [`server/config/middleware.js`](../../../server/config/middleware.js) | Expose scope metadata on read |
| [`server.js`](../../../server.js) | Scaffold route; log project layer on start |

### Client — display + write scope

| File | Change |
|------|--------|
| [`src/config/api-client.ts`](../../../src/config/api-client.ts) | Types for `sources` / scope |
| [`src/ui/settings-sections.ts`](../../../src/ui/settings-sections.ts) | Hints: project vs user paths |
| [`src/tools/config.ts`](../../../src/tools/config.ts) | Respect server merge (no local merge duplication) |
| [`src/chat/prompts/prompt-loader.ts`](../../../src/chat/prompts/prompt-loader.ts) | Accept project entries from API registry |
| [`src/mcp/client.ts`](../../../src/mcp/client.ts) | Document merged server list |

### Built-in defaults (unchanged paths, referenced by resolver)

| Asset | Path |
|-------|------|
| Prompts | `src/chat/prompts/` |
| Skills | `src/skills/` |
| LSP | `src/lsp/defaults.json` |
| Sub-agents | `src/agents/defaults/sub-agents.json` |
| Work agents | `src/agents/work-agents/` (built-in dir via registry) |
| MCP seed | [`server/mcp/defaults.js`](../../../server/mcp/defaults.js) |

---

## Implementation phases

### Phase 0 — Spec and fixtures (0.5 d)

- Write `server/config/layers.md` (internal) with merge tables above.
- Add test helpers: `setTestWorkspace(dir)`, `scaffoldProjectMinnow(dir)`, parallel to [`test/config/test-helpers.js`](../../../test/config/test-helpers.js).

### Phase 1 — Resolver core (1–2 d)

- Implement `layers.js` + path guards (mirror [`resolveConfigPath`](../../../test/config/resolve-config-path.test.js) tests for project root).
- Hook `invalidateConfigLayerCache` into workspace switch.
- Unit tests: traversal, missing project dir → user-only, empty project dir.

### Phase 2 — Flat JSON via store (1–2 d)

- Wire `readResource` / `writeResource` for: `tools`, `rules`, `sub-agents`, `skills`, `system-prompt`, selective `meta` blocks.
- Split `config.json` write paths (machine vs project blocks).
- Integration: tools + rules CRUD with layered temp dirs.

### Phase 3 — Directory loaders (2–3 d)

- Prompts registry + prompt-configs CRUD.
- Skills scan + `skills.json` flags.
- Work-agents registry + `work-agents.json`.
- MCP registry + `mcp/` configs.
- LSP loader.

### Phase 4 — Memory and providers (1–2 d)

- Project `memory/` with merged index; tag entries with `workspacePath` or `scope`.
- Provider profile layering; enforce secrets user-only.

### Phase 5 — Scaffold, UI, docs (1–2 d)

- `POST /api/workspace/scaffold-minnow` + Settings CTA “Initialize project config”.
- Scope badges in settings sections.
- Update [`documentation/context.md`](../../context.md) persistence section.

### Phase 6 — Hardening (1 d)

- Manual QA matrix (workspace A/B switch, missing project dir, Vite-only banner).
- Performance: avoid re-scanning entire prompt tree on every request — cache per `(workspaceKey, mtime)`.

**Estimated total:** 7–12 dev days depending on memory/provider edge cases.

---

## Dependencies

| Direction | Item | Notes |
|-----------|------|-------|
| **Blocks** | #13 Prompt profiles / export | Profiles need “activate per project” storage |
| **Blocks** | #16 Agent packs | Pack drop path: `~/.minnow/agent-packs/` + optional `.minnow/agent-packs/` |
| **Blocks** | #17 Native tool plugins | Same dual path convention |
| **Blocks** | #18 Headless CLI | `--workspace` must load project layer |
| **Uses** | Workspace root API | [`server/workspace/root.js`](../../../server/workspace/root.js) |
| **Uses** | Session workspace scoping | [`src/state/session-workspace-scope.ts`](../../../src/state/session-workspace-scope.ts) |
| **Complements** | #2 Model routing UI | Routing UI should show effective merged bindings |
| **Does not require** | Reef / trace / eval harness | Independent |

---

## Tests

| Suite | Covers |
|-------|--------|
| `test/config/layers-resolve.test.js` | Path safety for `<workspace>/.minnow/..` |
| `test/config/layers-merge.test.js` | Static merge outcomes (tools, rules, sub-agents) |
| `test/config/layers-integration.test.mjs` | HTTP `/api/config/tools` with project + MINNOW_HOME |
| `test/prompts/layers-registry.test.mjs` | Project prompt wins |
| `test/skills/layers-scan.test.mjs` | Project skill overrides built-in |
| `test/work-agents/layers-registry.test.mjs` | Project `work-agents.json` |
| `test/mcp/layers-registry.test.mjs` | Project MCP server list |
| `test/lsp/layers-config.test.mjs` | Project `lsp.json` overlay |
| `test/memory/layers-scope.test.mjs` | Project vs user memory isolation |
| Extend [`test/config/resolve-config-path.test.js`](../../../test/config/resolve-config-path.test.js) | Project-relative allowed keys |

**Conventions:** `MINNOW_HOME` temp dir + temp workspace dir with `.minnow/`; fixed UUIDs; static expected JSON strings; reset caches in `after` hooks.

**CI:** `npm test` + `npx tsc --noEmit`.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Secrets committed** | API keys in repo | Default `.minnow/.gitignore`; never load `secrets.json` from project; Settings warning on `tools.json` keys |
| **Stale cache after workspace switch** | Wrong tools/prompts for project B | `invalidateConfigLayerCache()` in `setWorkspaceRoot`; optional `mtime` watch in dev |
| **Active chat workspace ≠ server workspace root** | Config leak across projects | Pass `chat.workspacePath` into send-path loaders (memory, rules); document that Settings edits **server workspace** |
| **Write surprise** | User expects global save | Scope badge + “Save to project” vs “Save to user profile”; default project when scaffolded |
| **Duplicate merge client/server** | Drift | Server is source of truth when `npm start`; client only displays `sources` metadata |
| **Global sessions file growth** | Unrelated to #22 but visible | Keep v1 sessions in user home; optional later split |
| **Windows path casing** | Duplicate workspace keys | Reuse [`normalizeWorkspacePathKey`](../../../server/workspace/root.js) for project cache keys |
| **Vite-only dev** | No project layer | Banner: “Start npm start for project .minnow” |

---

## Open decisions (resolve in Phase 0)

1. **Sessions:** Stay user-global for v1, or opt-in `.minnow/sessions/state.json`?
2. **Reef / screenshots / logs:** Remain user-global forever, or allow `.minnow/reef/modules` for team widgets?
3. **`config.json` activeProviderId:** Machine default vs project default when both exist — recommend **user** for provider selection, **project** for `planning` / `toolSecurity` only.
4. **Empty `.minnow/`:** Treat as “no project layer” vs scaffold-on-first-save?

---

## Verification checklist (manual)

1. Scaffold `.minnow` in repo A; commit `tools.json` (no keys); clone on second machine with same workspace path.
2. Open workspace B without `.minnow` — confirm user home settings apply.
3. Switch A → B → A; confirm tool enablement tracks each layer.
4. Project `rules.md` / memory entry appears in compose for chats bound to A only.
5. Provider secret in `~/.minnow` + project profile in repo — chat uses merged endpoint without exposing secret in git.

---

## References

- Roadmap gap: [`feature-audit-roadmap.md` §22](../feature-audit-roadmap.md)
- Persistence contract: [`context.md` § Persistence](../../context.md)
- Workspace chats: [`session-workspace-scope.ts`](../../../src/state/session-workspace-scope.ts)
- Config path tests: [`test/config/resolve-config-path.test.js`](../../../test/config/resolve-config-path.test.js)
