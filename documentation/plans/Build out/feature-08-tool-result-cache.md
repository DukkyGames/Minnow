---
name: Feature 08 — Tool result caching
overview: Session-scoped in-memory cache in front of executeTool, keyed on (tool name, normalized args) with explicit invalidation when mutating tools change workspace state. Reduces redundant server round-trips during multi-turn agent loops.
source: documentation/plans/feature-audit-roadmap.md §8
todos:
  - id: cache-module-skeleton
    content: Add src/tools/result-cache.ts with scope key, normalizeArgs, stable key, get/set, TTL, and clearScope
    status: pending
  - id: cache-policy-table
    content: Define CACHE_POLICY (cacheable, ttlMs, never) and INVALIDATION_MAP (writer → readers) in result-cache.ts
    status: pending
  - id: wire-execute-tool
    content: Wrap executeToolInner via executeWithResultCache in client.ts; record invalidation after successful writes
    status: pending
  - id: workspace-invalidation
    content: Clear cache scope on workspace switch (workspace.ts or init hook) and new chat optional bust
    status: pending
  - id: settings-toggle
    content: Optional toolCache.enabled in ToolConfig + Settings Tools row (default on)
    status: pending
  - id: unit-tests
    content: Add test/tools/result-cache.test.mts (hit/miss, normalize, bust map, TTL, errors not cached)
    status: pending
  - id: integration-smoke
    content: Manual QA — duplicate read_file in one turn hits cache; save_file then read_file misses
    status: pending
  - id: context-doc
    content: Update documentation/context.md Tool loop section when feature ships
    status: pending
isProject: false
---

# Feature 08 — Tool result caching

**Roadmap:** [feature-audit-roadmap.md](../feature-audit-roadmap.md) item **#8** (status: **Missing**).  
**Architecture reference:** [documentation/context.md](../../context.md) — Tool loop and client (`executeTool`).  
**Primary hook:** [`src/tools/client.ts`](../../../src/tools/client.ts) — `executeTool` → `runWithFileTreeAutoRefresh` → `executeToolInner`.

---

## Current state

| Area | Behavior today |
|------|----------------|
| **Tool execution** | Every `executeTool(name, args, context)` call runs the full router in `executeToolInner`: approval gate, plan-mode guard, then browser executor, terminal stream, or `POST /api/tools`. No memoization. |
| **Call sites** | Main loop ([`src/tools/loop.ts`](../../../src/tools/loop.ts) ~L901), sub-agents ([`src/agents/sub-agent-runner.ts`](../../../src/agents/sub-agent-runner.ts)), file tree/viewer ([`src/ui/file-tree.ts`](../../../src/ui/file-tree.ts), [`file-tree-ops.ts`](../../../src/ui/file-tree-ops.ts), [`file-viewer.ts`](../../../src/ui/file-viewer.ts)). All share `executeTool`. |
| **Side-effect UI** | [`runWithFileTreeAutoRefresh`](../../../src/ui/file-tree-auto-refresh.ts) wraps the outer `executeTool` and refreshes the Files tree after successful mutating tools — independent of caching. |
| **Path extraction** | [`extractPathLikeArgs`](../../../src/tools/path-args.ts) already maps tool names → path argument keys (aligned with server `resolveSafePath`). Reuse for invalidation. |
| **MCP tools** | Separate branch (`mcp__*`) → `executeServerTool`; no cache. |
| **Config** | [`ToolConfig`](../../../src/tools/tool-settings-types.ts) has `enabled`, `permissions`, `keys` only — no cache settings. |
| **Related roadmap** | **#19 Determinism** plans a *different* intercept in `executeTool` for record/replay — must compose as an outer wrapper, not duplicate cache logic. |

**Evidence (no cache layer):**

```136:142:src/tools/client.ts
export async function executeTool(
  name: string,
  args: Record<string, unknown> = {},
  context: ExecuteToolContext = {},
): Promise<ToolExecutionResult> {
  return runWithFileTreeAutoRefresh(name, () => executeToolInner(name, args, context));
}
```

---

## Gap

1. **Redundant I/O** — Agents re-read the same files and re-list directories across tool turns in one chat, paying latency and disk on every call.
2. **No coherence model** — Without invalidation, caching would return stale content after `save_file` / `move_file` / `git_commit`.
3. **No policy surface** — Which tools are safe to cache, for how long, and what busts what is undefined.
4. **Workspace boundaries** — Cache must not survive workspace switches or return cross-workspace results.

---

## Goals

1. **Transparent speedup** — Identical tool invocations within a scope return the prior `ToolExecutionResult` without hitting the server/browser executor again.
2. **Correctness first** — Explicit invalidation map + scope clears; never cache errors or non-idempotent tools.
3. **Minimal diff** — New module `src/tools/result-cache.ts`; thin integration in `client.ts` only (no server changes in v1).
4. **Observable (dev)** — Optional debug flag logs cache hit/miss/bust (e.g. `localStorage.minnowDebugToolCache = '1'`).
5. **Future-proof** — API shaped so **#19** record/replay can wrap outside cache; **#6** approval patterns unchanged.

### Non-goals (v1)

- Persisting cache to `~/.minnow/` or across page reload.
- Server-side caching in `server/tools`.
- Cross-chat shared cache (each chat + workspace is its own scope).
- Invalidating on external file edits (OS watcher) — rely on mutating-tool bust + workspace switch.

---

## Acceptance criteria

### Functional

- [ ] Second `read_file` with same `path` in the same chat/workspace returns cached content **without** a network `POST /api/tools` (verifiable via debug log or mocked fetch counter in tests).
- [ ] After successful `save_file` for `src/foo.ts`, a subsequent `read_file` for `src/foo.ts` **misses** cache and returns fresh content.
- [ ] `move_file` / `copy_file` / `delete_path` invalidate cache entries for affected **source** and **destination** paths for read/list/search/metadata tools.
- [ ] `git_commit`, `git_add`, `git_checkout` invalidate git read tools (`git_status`, `git_diff`, `git_log`) for that scope.
- [ ] `execute_command`, `run_javascript`, `run_python`, `spawn_sub_agent`, `ask_question`, mode-handoff tools, board tools, and `report_orchestrator_status` are **never** cached.
- [ ] Results whose `content` starts with `Error:` are **never** stored.
- [ ] Switching workspace clears all cache entries for the previous workspace scope.
- [ ] Cache respects `toolCache.enabled === false` in settings (falls through to today’s behavior).

### UX / safety

- [ ] Approval gate still runs on every invocation when policy is `ask` (cache does not skip user approval in v1).
- [ ] Plan-mode write guard still runs before cache lookup.
- [ ] File tree auto-refresh still runs on cache **miss** that performs a real mutating tool; on cache **hit**, no refresh (no mutation occurred).

### Quality

- [ ] `npx tsc --noEmit` clean.
- [ ] `npm test` — new `test/tools/result-cache.test.mts` passes; no regressions in existing tool tests.

---

## Architecture

### Module layout: `src/tools/result-cache.ts`

```
┌─────────────────────────────────────────────────────────────┐
│ executeTool (client.ts)                                      │
│   runWithFileTreeAutoRefresh                                 │
│     executeWithResultCache ──► executeToolInner              │
└─────────────────────────────────────────────────────────────┘
```

**Exports (proposed):**

| Symbol | Responsibility |
|--------|----------------|
| `normalizeToolArgs(name, args)` | Stable args for keying (sorted keys, trimmed strings, normalized paths). |
| `buildCacheKey(name, normalizedArgs)` | `name + '\0' + stableJson(normalizedArgs)`. |
| `getCacheScope(context)` | `{ chatId, workspacePath }` → scope id string. |
| `getCachedResult(scope, key)` | Lookup + TTL check. |
| `setCachedResult(scope, key, result, policy)` | Store deep copy of `{ content, attachments? }`. |
| `invalidateAfterTool(scope, name, args, result)` | Apply bust map when write succeeds. |
| `clearCacheScope(scope)` / `clearAllCaches()` | Workspace switch / tests. |
| `executeWithResultCache(name, args, context, inner)` | Orchestrates lookup → inner → store → invalidate. |

### Scope (session-scoped)

**Scope id** = `normalizeWorkspacePath(workspacePath) + ':' + (chatId.trim() || '__no_chat__')`

- **Workspace** — Required so switching project roots does not serve stale file reads.
- **Chat** — Isolates parallel sub-agent / parent traffic when both use distinct `chatId` in `ExecuteToolContext`.
- **UI without `chatId`** — File viewer/tree calls use `__no_chat__` bucket; still workspace-scoped.

Clear on:

- `setWorkspaceFromServer` / workspace path change ([`src/state/workspace.ts`](../../../src/state/workspace.ts)).
- Optional: `deleteChat` / archive (low priority v1).

Do **not** persist to `SessionState` JSON — in-memory only, cleared on full page reload (acceptable per roadmap).

### Cache key: `(name, normalized-args)`

1. Start from args **after** `mergeConfigKeysIntoArgs` (so `web_search` keys match what the executor sees). Integration point: cache wrapper runs **inside** `executeToolInner` after enrichment for built-ins, or document that enrichment happens before cache for each branch.
2. **Normalize:**
   - Recursively sort object keys.
   - Trim string values; collapse redundant whitespace in path strings.
   - Normalize path fields via existing path helpers (same rules as `extractPathLikeArgs` keys, forward-slash relative paths).
   - Omit `undefined`; treat missing optional args consistently (e.g. `git_diff` without `path`).
3. **Serialize** with `JSON.stringify` on normalized object (no key order drift).

### Cache policy table

```ts
type CachePolicy = {
  cacheable: boolean;
  ttlMs: number; // 0 = no TTL (invalidation-only)
};

const DEFAULT_CACHE_POLICY: CachePolicy = { cacheable: false, ttlMs: 0 };
```

**v1 `cacheable: true` (invalidation-primary, long TTL):**

| Tool | ttlMs | Notes |
|------|-------|--------|
| `read_file`, `read_file_range` | 0 | Bust on file writes |
| `list_directory` | 0 | Bust on tree mutations under path prefix |
| `search_in_file`, `get_file_metadata` | 0 | Path-based bust |
| `find_files` | 0 | Bust on any file change under search root |
| `git_status`, `git_diff`, `git_log` | 0 | Bust on git write tools |
| `get_lsp_diagnostics` | 30_000 | Short TTL; also bust on file writes for that path |
| `list_lsp_servers` | 60_000 | Rarely changes |
| `load_impeccable_context` | 300_000 | Design context |
| `web_search`, `web_search_ddg` | 120_000 | Time-sensitive; TTL even without bust |
| `read_document` | 0 | If enabled; path bust |

**`cacheable: false` (always execute fresh):**

- All mutating file/git/code tools (`save_file`, `append_file`, …, `git_commit`, `execute_command`, …).
- `get_datetime`, `calculate` (non-deterministic / time-based).
- Sub-agent, board, orchestrate, mode handoff, `ask_question`, MCP, streaming code tools.
- `save_memory` (writes global store).

### Invalidation map

Run **after** inner execution when `!isErrorResult(result)` and tool is a known writer.

```ts
type InvalidationRule = {
  /** Tool names whose cache entries should be removed */
  invalidateTools: readonly string[];
  /** Extract path prefixes from args to match cache keys */
  pathFromArgs: (name: string, args: Record<string, unknown>) => string[];
};

const INVALIDATION_MAP: Record<string, InvalidationRule> = {
  save_file: {
    invalidateTools: ['read_file', 'read_file_range', 'search_in_file', 'get_file_metadata', 'list_directory', 'find_files', 'get_lsp_diagnostics'],
    pathFromArgs: (_, args) => pathKeys(args, ['path']),
  },
  append_file: { /* same as save_file */ },
  insert_at_line: { /* same */ },
  replace_text_in_file: { /* same */ },
  make_directory: { invalidateTools: ['list_directory', 'find_files'], pathFromArgs: ... },
  move_file: { pathFromArgs: source + destination, invalidate both },
  copy_file: { /* dest + source */ },
  delete_path: { /* path + parent dir list_directory */ },
  git_add: { invalidateTools: ['git_status', 'git_diff', 'git_log'], pathFromArgs: () => [] },
  git_commit: { /* same */ },
  git_checkout: { invalidateTools: [...], pathFromArgs: () => ['**'] }, // conservative: clear git + all file reads in scope
};
```

**Matching algorithm:**

- For each cached entry in scope, parse stored key → tool name + normalized args.
- If tool name ∈ `invalidateTools`, check whether any path arg in cached entry **equals or is under** a bust prefix (directory semantics for `list_directory` / `find_files`).
- Delete matching entries; increment bust counter for debug.

**Conservative fallback:** If a writer is not in the map but is in `FILE_TREE_MUTATING_TOOLS`, bust all file-read tools for extracted paths.

### Integration in `client.ts`

Recommended call order inside `executeTool`:

```
runWithFileTreeAutoRefresh(name, () =>
  executeWithResultCache(name, args, context, () =>
    executeToolInner(name, args, context)
  )
)
```

**Inside `executeWithResultCache`:**

1. If cache disabled → call inner.
2. Resolve policy for `name`; if not `cacheable` → call inner; on success run `invalidateAfterTool` only.
3. Build scope + key; on hit return cloned result.
4. On miss: call inner.
5. If success and cacheable → `setCachedResult`.
6. If writer → `invalidateAfterTool` (whether or not response was cached).

**Approval / plan guard:** Stay in `executeToolInner` before inner body OR run cache after gates by structuring `executeToolInner` as gates + `executeToolInnerUncached`. **Do not** return cache hits before `maybeBlockToolForUserApproval` when permission is `ask`.

Suggested structure:

```ts
async function executeToolInner(...) {
  // early special cases (set_chat_mode, ask_question, mcp, sub-agent, board) — no cache
  ...
  const blocked = await maybeBlockToolForUserApproval(...);
  if (blocked) return blocked;
  const planWriteBlock = blockPlanModeWrite(...);
  if (planWriteBlock) return { content: planWriteBlock };

  return executeWithResultCache(name, enrichedArgs, context, () =>
    executeToolBodyAfterGates(name, enrichedArgs, context)
  );
}
```

Extract post-gate body to `executeToolBodyAfterGates` to avoid double approval on hits.

### Settings (optional v1.1)

Extend [`ToolConfig`](../../../src/tools/tool-settings-types.ts):

```ts
toolCache?: {
  enabled: boolean; // default true
};
```

Surface in Settings → Tools as a single toggle: “Cache repeated read-only tool results in this session”. Persist via existing `tools.json` / `PUT /api/config/tools`.

Per-tool TTL overrides can wait; v1 uses code constants in `result-cache.ts`.

---

## Key files

| File | Change |
|------|--------|
| **`src/tools/result-cache.ts`** | **New** — policy, keying, store, invalidation, wrapper. |
| **`src/tools/client.ts`** | Wire `executeWithResultCache`; split post-gate execution body. |
| **`src/tools/path-args.ts`** | Reuse `extractPathLikeArgs`; optional `normalizePathArg(path)`. |
| **`src/tools/tool-settings-types.ts`** | Optional `toolCache.enabled`. |
| **`src/config/defaults.ts`** | Default `toolCache: { enabled: true }`. |
| **`src/state/workspace.ts`** | Call `clearAllCaches()` or `clearCachesForWorkspace(oldPath)` on switch. |
| **`src/ui/file-tree-auto-refresh.ts`** | No change (outer wrapper still sees real mutations only). |
| **`documentation/context.md`** | Document cache behavior under Tool loop (when shipped). |
| **`test/tools/result-cache.test.mts`** | **New** — unit tests. |

**Out of scope for v1:** `server/tools/*`, `server.js` POST handler, sub-agent server isolation.

---

## Implementation phases

### Phase 1 — Core cache (MVP)

1. Implement `result-cache.ts` with in-memory `Map<scopeId, Map<cacheKey, CacheEntry>>`.
2. Implement `normalizeToolArgs` + `buildCacheKey` + TTL expiry on read.
3. Add unit tests for hit/miss, normalization equivalence, error non-storage.

### Phase 2 — Invalidation

1. Implement `INVALIDATION_MAP` + path-prefix matching.
2. Wire `invalidateAfterTool` after successful writes in wrapper.
3. Tests: `save_file` busts `read_file`; `move_file` busts source and dest.

### Phase 3 — Integration

1. Refactor `client.ts` gates vs cached body.
2. Hook workspace switch clear.
3. Manual QA in `npm start` with debug logging.

### Phase 4 — Settings + docs (optional)

1. `toolCache.enabled` toggle + defaults merge in `normalizeToolConfig`.
2. Update `context.md` and roadmap item status → **Built**.

---

## Dependencies

| Dependency | Relationship |
|------------|----------------|
| **#6 Approval patterns** | Cache must not bypass `ask` approval in v1; may later allow “auto-approve on cache hit” as enhancement. |
| **#19 Determinism / record-replay** | Record layer should wrap **outside** `executeWithResultCache` so recordings capture real server I/O, or explicitly record cache hits as synthetic — decide when #19 starts; default **outer wrap**. |
| **#22 Project-scoped configs** | Independent; cache is runtime-only. |
| **`extractPathLikeArgs`** | Required for invalidation paths — keep in sync with server path args. |
| **`FILE_TREE_MUTATING_TOOLS`** | Align invalidation writers with this set. |

**Blocks:** Nothing — can ship standalone.

**Enables:** Faster multi-turn agent loops; lower load on local tool server; foundation for eval harness (#21) if combined with #19.

---

## Tests

### Unit — `test/tools/result-cache.test.mts`

| Case | Assertion |
|------|-----------|
| Same name + args (different key order) | Same cache key |
| Path trim / `./` normalization | Same key |
| Cache hit | Inner mock called once |
| Error result | Not stored; second call invokes inner again |
| `save_file` then `read_file` same path | Second read misses |
| TTL expiry | After `ttlMs`, miss |
| `clearCacheScope` | All entries for scope gone |
| Non-cacheable tool | Inner always called |

Use fixed scope id `'test-scope'`, fixed args, no `Date.now()` in keys.

### Integration (manual)

1. `npm start`, enable debug flag, open chat.
2. Prompt model to `read_file` same path twice in one turn → one server round-trip.
3. `save_file` then `read_file` → fresh content.
4. Switch workspace → repeat read → miss (server hit).

### Regression

- `test/file/file-tree-ops.test.mts` — CRUD still works.
- Existing orchestrate/sub-agent tests — no cache for spawn tools.

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| **Stale reads** | Agent edits wrong file | Strict invalidation map; conservative `git_checkout` bust; workspace scope clear |
| **Stale directory listings** | Miss new files | `list_directory` / `find_files` bust on all file mutators affecting prefix |
| **Memory growth** | Long sessions OOM | Cap entries per scope (e.g. 500 LRU); optional `maxAgeMs` sweep |
| **Approval bypass perception** | User thinks tool didn’t run | v1: always show tool UI from loop (cache hit still renders result); don’t skip approval modal for `ask` |
| **Cached attachments** | Stale images | Only cache tools without attachments, or deep-clone attachment URLs; `read_file` is text-only — safe |
| **MCP / dynamic tools** | Wrong cache | Default `cacheable: false` for unknown `mcp__*` |
| **Sub-agent isolation** | Parent sees child cache | Distinct `chatId` per run in `ExecuteToolContext` |
| **File viewer vs agent** | Shared `__no_chat__` bucket | Acceptable v1; document; optional bust on viewer save |
| **Double wrapper with #19** | Confusing test behavior | Document compose order: `recordReplay(executeWithResultCache(inner))` |

---

## Open questions (resolve in Phase 1 kickoff)

1. **Cache hit + `ask` permission** — Always show approval modal, or skip modal when key matches a prior **approved** invocation in the same scope? (v1 recommendation: **always modal** for `ask`.)
2. **Sub-agent `chatId`** — Confirm child runs pass a unique id (inspect `setSubAgentExecutorContext`).
3. **Prefix matching for `find_files`** — Invalidate on any file change under `args.path` root, or entire scope on any mutation (simpler).
4. **Global toggle default** — On by default, or opt-in for first release?

---

## References

- Roadmap gap: [feature-audit-roadmap.md §8](../feature-audit-roadmap.md)
- Tool router: [`src/tools/client.ts`](../../../src/tools/client.ts)
- Tool loop: [`src/tools/loop.ts`](../../../src/tools/loop.ts)
- Path args: [`src/tools/path-args.ts`](../../../src/tools/path-args.ts)
- Mutating tools set: [`src/ui/file-tree-auto-refresh.ts`](../../../src/ui/file-tree-auto-refresh.ts)
- Tool definitions catalog: [`src/tools/definitions.ts`](../../../src/tools/definitions.ts)
