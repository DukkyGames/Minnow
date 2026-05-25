---
name: POLISH-021 — grep / search in files tool
overview: Add a workspace-scoped `grep` server tool so agents can search file contents by pattern (ripgrep-style) without shelling out via `execute_command`; align prompts, benchmark fixtures, and tool catalog with the new capability.
source: documentation/bug-hunt-session-2026-05-24.md (POLISH-021)
related:
  - documentation/bug-hunt-session-2026-05-24.md
  - documentation/context.md (Built-in tools / Files section)
  - documentation/plans/product_backlog_agents_48a41af9.plan.md (E2 — file tree search phase 2)
  - documentation/plans/Build out/feature-04-reef-artifacts.md (grep tool-output promotion)
  - documentation/plans/Build out/feature-08-tool-result-cache.md (cache invalidation list)
  - BUG-008 (modes benchmark — expected tool missing)
todos:
  - id: decide-engine
    content: Choose search engine — bundled ripgrep vs spawn `rg` vs pure Node walk; document Windows/macOS/Linux fallback
    status: pending
  - id: decide-tool-id-api
    content: Lock tool id `grep` and JSON schema (pattern, path, glob, case, literal, context, head_limit)
    status: pending
  - id: server-handler
    content: Implement `toolGrep` in server.js — workspace root via resolveSafePath, gitignore, caps, output format
    status: pending
  - id: definitions-sync
    content: Add ToolDefinition + server/config/tool-ids.js + path-args.ts entries; keep search_in_file unchanged
    status: pending
  - id: ignore-rules
    content: Respect .gitignore (and optional .minnowignore) — do not scan node_modules/dist unless overridden
    status: pending
  - id: permissions-defaults
    content: Wire tools.json seed, defaultToolConfig, Settings catalog; default off + ask like other file tools
    status: pending
  - id: mode-policy-prompts
    content: Allow grep in Plan/Research (read-only); update tool-usage + builder/research prompts (grep vs search_in_file)
    status: pending
  - id: benchmark-fixture
    content: Verify tools suite `grep` fixture in tools-fixtures.ts passes against real handler
    status: pending
  - id: server-tests
    content: Add test/server/grep-tool.test.mjs — fixture workspace, pattern hits, ignore, truncation, invalid regex
    status: pending
  - id: cache-invalidation
    content: Add `grep` to feature-08 invalidateTools list when tool-result cache ships
    status: pending
  - id: docs-context-bughunt
    content: Update documentation/context.md Files tool count/list; mark POLISH-021 resolved in bug-hunt doc
    status: pending
  - id: manual-verify
    content: npm start — enable grep in Settings; Build mode agent finds symbol across src/ without execute_command
    status: pending
isProject: false
---

# POLISH-021 — Agent tool: grep / search in files

**Tracker:** [documentation/bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — POLISH-021  
**Type:** Polish / capability gap  
**Area:** Server tools (`server.js`), tool definitions (`src/tools/definitions.ts`), prompts, benchmark Tools suite  
**Status:** Open (plan only — no implementation in this document)

---

## Summary

Agents and prompts repeatedly instruct **“grep the codebase”**, but Minnow only exposes **`search_in_file`** (single-file regex) and **`find_files`** (path glob, no content). There is **no** `grep` tool id in [`src/tools/definitions.ts`](../../../src/tools/definitions.ts) or [`server/config/tool-ids.js`](../../../server/config/tool-ids.js), while the **Tools benchmark** already expects one ([`src/benchmark/suites/tools-fixtures.ts`](../../../src/benchmark/suites/tools-fixtures.ts)). Today the workaround is **`execute_command`** with shell `grep`/`rg`, which is weaker for permissions, cross-platform behavior, and prompt guidance (“prefer specialized tools”).

This plan adds a first-class **`grep`** server tool: workspace-scoped content search with ripgrep-style output, ignore rules, and safe path handling—without requiring implementation details in this document beyond the recommended shape below.

---

## Problem statement

| | |
|---|---|
| **User / agent need** | Find symbols, strings, or patterns **across many files** under the workspace root. |
| **Today** | `search_in_file` requires a known file path; `find_files` lists paths only; agents use `execute_command` for `grep`/`rg` or read many files manually. |
| **Prompt drift** | [`default.full.md`](../../../src/chat/prompts/tool-usage/default.full.md) says `search_in_file` > `execute_command grep`, but mode/work-agent copy still says “grep for it” ([`build.full.md`](../../../src/chat/prompts/modes/build.full.md), [`builder/agent.full.md`](../../../src/chat/prompts/work-agents/builder/agent.full.md)). |
| **Benchmark gap** | `grep` fixture exists; tool does not → Tools suite / model probes may fail or never exercise the capability. |
| **Product backlog** | E2 file-tree search lists **phase 2 = ripgrep tool** ([`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md)); UI name filter (v1) is separate—do not conflate with this agent tool. |

---

## Goals

1. **`grep` tool id** registered and executable via `POST /api/tools` when the tool server is up (`serverRequired: true`).
2. **Multi-file content search** under a directory (default workspace `.`), optional **glob filter**, regex or literal pattern, optional case sensitivity and **context lines**.
3. **Output** human- and model-friendly: `relative/path:line:snippet` (and optional `-` context lines), with **hard cap** on matches (similar to `FIND_FILES_MAX = 500` for `find_files`).
4. **Safety:** paths resolved through existing [`resolveSafePath`](../../../server.js); respect workspace boundary unless full filesystem access is enabled.
5. **Ignore hygiene:** skip paths ignored by **`.gitignore`** (required in bug hunt); consider `.cursorignore` / `.minnowignore` in a follow-up if not in v1.
6. **Mode policy:** available in **Build**, **Plan**, **Research**, **Orchestrate**, **Reef** (read-only modes must retain search—grep is read-only).
7. **Settings:** appears in tools catalog; default **disabled** + **ask** permission like most file tools ([`defaultToolConfig`](../../../src/config/defaults.ts)).

## Non-goals (v1)

- Replacing or removing **`search_in_file`** (keep for targeted single-file search).
- File tree UI integration (E2 phase 2)—optional later wiring to the same server endpoint.
- Semantic / embedding codebase search (no vector index).
- LSP reference search (separate `get_lsp_*` tools).
- Making `grep` **default-enabled** for new installs (stay opt-in like `search_in_file`).

---

## Current state

### `search_in_file` ([`server.js`](../../../server.js) `toolSearchInFile`)

- Args: `path` (single file), `pattern` (regex string).
- Reads **entire file** into memory; line scan with `RegExp`.
- Output: `lineNum: line` per match, or “No matches”.
- No glob, no directory walk, **no gitignore**.

### `find_files` ([`server.js`](../../../server.js) `toolFindFiles`)

- Args: `pattern` (glob), optional `path` root.
- Recursive directory walk; `FIND_FILES_MAX = 500` truncation message.
- **No gitignore**; walks into `node_modules` unless pattern excludes it.
- No content search.

### Tool catalog sync

- [`ALL_TOOL_IDS`](../../../server/config/tool-ids.js) — 58 ids, no `grep`.
- [`BUILT_IN_TOOLS`](../../../src/tools/definitions.ts) — 55 built-ins per AGENTS.md; files category lists `search_in_file`, not workspace grep.
- [`extractPathLikeArgs`](../../../src/tools/path-args.ts) — must gain `grep: ['path']` (or `['path', 'glob']` if glob is a path root).

### Modes

- [`registry.ts`](../../../src/chat/modes/registry.ts): Plan/Research deny writes and shell, **not** read/search tools. `grep` needs no deny-list entry.

### Benchmark

```ts
// src/benchmark/suites/tools-fixtures.ts
grep: {
  prompt: 'Use grep to search for "export" in src with pattern export. Call the tool.',
  expectArgs: (a) => typeof a.pattern === 'string',
},
```

### Workarounds today

- `execute_command` runs shell in workspace cwd ([`toolExecuteCommand`](../../../server.js)); no structured match list, platform-dependent `grep`/`findstr`, permission noise.

---

## Recommended design

### Tool identity

| Decision | Recommendation | Rationale |
|----------|----------------|-----------|
| Tool id | **`grep`** | Matches bug hunt, benchmark fixture, and agent prompt language. |
| Label | **Grep / Search workspace** | Settings catalog clarity. |
| Category | **`files`** | Alongside `find_files`, `search_in_file`. |

Do **not** alias `grep` → `search_in_file` in the model API; they serve different scopes.

### Proposed schema (OpenAI function)

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `pattern` | string | yes | Regex pattern, or literal when `literal: true` |
| `path` | string | no | Directory to search under (default `"."`), workspace-relative |
| `glob` | string | no | File glob, e.g. `**/*.{ts,tsx}` (default: all searchable text files) |
| `case_insensitive` | boolean | no | Default `false` |
| `literal` | boolean | no | Treat `pattern` as fixed string (escape regex metacharacters) |
| `context` | number | no | Lines before/after each match (0–5, default 0) |
| `head_limit` | number | no | Max matching **lines** to return (default 200, hard max 500) |

Optional v1.1: `include_hidden` (default false), `no_ignore` (default false, expert-only).

### Output format (ripgrep-style)

Success (truncated):

```text
src/foo.ts:42:export function bar() {
src/foo.ts:43:  return 1;
src/bar.ts:10:export const x = 1;

(truncated at 200 matching lines)
```

- Use forward slashes in displayed paths (`toRelativePath`).
- No matches: `No matches for "<pattern>" under <root>`.
- Invalid regex: `Error: invalid regex: …` (mirror `search_in_file`).
- Path errors: existing `resolveSafePath` messages.

### Search engine (decision required)

Evaluate in implementation PR; plan recommendation:

| Option | Pros | Cons |
|--------|------|------|
| **A. `@vscode/ripgrep` npm binary** | Fast, gitignore built-in, familiar output | New dependency; binary size; postinstall/platform |
| **B. Spawn `rg` on PATH** | No bundle; fast when installed | Fails on machines without `rg`; Windows PATH variance |
| **C. Pure Node walk + regex** | No native deps; same as today’s style | Slow on large repos; must implement gitignore parser |

**Recommended:** **A** for product quality (Cursor/VS Code precedent), with **C fallback** when binary missing (limited features: no PCRE2, simpler ignore). **B** only as optional fast path if A is rejected for dependency policy.

**Binary / large files:** skip or best-effort UTF-8 read with size cap per file (e.g. 2 MB); document in tool description.

### Gitignore and walk root

1. Resolve `path` with `resolveSafePath(path ?? '.')` — must be directory (or treat file path as “search this file only” — optional convenience).
2. Load ignore rules from workspace root `.gitignore` (and parent rules if using a library).
3. Default **exclude** `node_modules`, `.git`, `dist`, `build` via ignore + sensible built-in denylist even if `.gitignore` is empty.
4. Align mentally with future **E2** “search in files” UI—same handler can power both.

### Coexistence with `search_in_file`

| Tool | When to use |
|------|-------------|
| `grep` | Unknown location; many files; exploration |
| `search_in_file` | Known file; confirm line content; smaller payload |

Update [`default.full.md`](../../../src/chat/prompts/tool-usage/default.full.md) rule 4 to: **`grep` > `search_in_file` > `execute_command grep`** for workspace-wide search; keep `search_in_file` for single-file confirmation.

### Permissions and cache

- **Permission:** `ask` by default in `tools.json` seed (same as `read_file` / `search_in_file`).
- **Tool-result cache** ([feature-08](../Build%20out/feature-08-tool-result-cache.md)): add `grep` to `invalidateTools` when writes touch matched files (optional v1: treat as read-only, no invalidation until cache ships).

### Reef / path aliases

- Search under workspace root only for v1; **do not** walk `@minnow/reef/widgets` unless path resolves via existing reef alias rules—document limitation in tool description.

---

## Implementation plan

### Phase 0 — Decisions (block implementation)

- [ ] Confirm engine choice (A/B/C) and max `head_limit`.
- [ ] Confirm default `glob` (all files vs common code extensions only).
- [ ] Confirm whether `path` may be a single file.

### Phase 1 — Server + definitions (core)

1. Implement `toolGrep(args)` in [`server.js`](../../../server.js); register in `SERVER_TOOL_HANDLERS`.
2. Add definition block in [`src/tools/definitions.ts`](../../../src/tools/definitions.ts) (`serverRequired: true`, category `files`).
3. Append `'grep'` to [`server/config/tool-ids.js`](../../../server/config/tool-ids.js).
4. Add path extraction in [`src/tools/path-args.ts`](../../../src/tools/path-args.ts).
5. Run existing sync test expectations if any assert tool count ([`test/tools/tools-list-sync.test.mjs`](../../../test/tools/tools-list-sync.test.mjs)).

### Phase 2 — Tests + benchmark

1. Add [`test/server/grep-tool.test.mjs`](../../../test/server/grep-tool.test.mjs) with a tiny fixture tree under `test/fixtures/grep-workspace/` (fixed files, `.gitignore` entry, known line hits).
2. Cases: match, no match, invalid regex, path outside workspace (reject), truncation, `literal: true`, `case_insensitive: true`.
3. Run Tools benchmark fixture manually or via `npm run test:benchmark` after enabling tool in test config.

### Phase 3 — Prompts + docs

1. Update tool-usage and builder/research/mode prompts that say “grep” to prefer the **`grep`** tool name.
2. Update [`documentation/context.md`](../../context.md) Files section (tool count 14 → 15, list `grep`).
3. Mark POLISH-021 **resolved** in bug-hunt session doc when shipped.

### Phase 4 — Optional follow-ups (separate PRs)

- File tree “search in files” calls same API ([E2](../product_backlog_agents_48a41af9.plan.md)).
- Reef artifact promotion for large grep results ([feature-04](../Build%20out/feature-04-reef-artifacts.md)).
- Eval pack `coding-smoke` grep task ([feature-21](../Build%20out/feature-21-local-eval-harness.md)).

---

## Acceptance criteria

- [ ] Model can call **`grep`** with `pattern` and optional `path`/`glob`; receives structured `path:line:text` lines.
- [ ] Search respects **workspace boundary** via `resolveSafePath`.
- [ ] Paths ignored by **`.gitignore`** do not appear in results (fixture test proves).
- [ ] Results **truncate** with explicit message when `head_limit` exceeded.
- [ ] Tool appears in **Settings** tools catalog; can be enabled/disabled and permission-gated.
- [ ] **Plan** and **Research** modes expose `grep` when enabled in catalog (not on deny lists).
- [ ] **`search_in_file`** behavior unchanged; both tools documented in context.md.
- [ ] **`npm test`** includes new server grep tests; **`npx tsc --noEmit`** clean.
- [ ] Tools benchmark **`grep`** fixture succeeds when tool is enabled for the run.
- [ ] No new dependency without `package.json` / README note if using `@vscode/ripgrep`.

---

## Files to touch (implementation)

| File | Change |
|------|--------|
| `server.js` | `toolGrep`, handler map, constants (`GREP_MAX_LINES`, etc.) |
| `src/tools/definitions.ts` | New `grep` `ToolDefinition` |
| `server/config/tool-ids.js` | Add `'grep'` |
| `src/tools/path-args.ts` | Path keys for boundary checks |
| `package.json` | Optional `@vscode/ripgrep` or `ignore` dependency |
| `test/server/grep-tool.test.mjs` | New |
| `test/fixtures/grep-workspace/**` | Deterministic search fixtures |
| `src/benchmark/suites/tools-fixtures.ts` | Adjust prompt/expectArgs if schema differs |
| `src/chat/prompts/tool-usage/default.full.md` | Prefer `grep` over shell |
| `src/chat/prompts/modes/build.full.md` | Tool name alignment |
| `src/chat/prompts/work-agents/builder/*.md` | Tool name alignment |
| `documentation/context.md` | Built-in tools list |
| `documentation/bug-hunt-session-2026-05-24.md` | Status when done |

**Likely unchanged:** mode registry deny lists, `defaultToolConfig` enabled set (grep stays off by default), UI file tree (`file-tree-search.ts`).

**Sync checklist:** AGENTS.md tool count if documented; migration fixtures only if tool list snapshots are asserted.

---

## Related items

| Id | Relationship |
|----|----------------|
| **POLISH-021** | This plan |
| **BUG-008** | If modes benchmark probes expect specific tools, enabling `grep` in probes may need suite updates—not a blocker for shipping the tool |
| **E2 file-search** | UI phase 2 can reuse server `grep` |
| **feature-04** | Large grep output → artifacts |
| **feature-08** | Cache invalidation list includes read/search tools |
| **feature-21** | Eval pack may add grep smoke task |

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Slow search on huge monorepos | `head_limit`, ignore rules, optional extension filter |
| OOM reading large files | Per-file byte cap; skip binary |
| Regex denial-of-service | Timeout or max file scan count per request |
| Windows without `rg` | Bundled ripgrep or Node fallback |
| Duplicate tool confusion (`search_in_file` vs `grep`) | Clear descriptions + prompt hierarchy |
| Benchmark / modes “tool missing” | Ensure tool id matches fixture; document enablement in bench settings |

---

## Open questions (resolve in Phase 0)

1. **Default glob:** search all non-binary files vs `**/*.{ts,js,md,json,...}` only?
2. **Single-file `path`:** allow `path: "src/foo.ts"` as shorthand?
3. **Dependency policy:** is `@vscode/ripgrep` acceptable in Minnow?
4. **`.cursorignore`:** v1 or defer?
5. **Default enabled:** keep off (recommended) or enable for Build mode presets?

---

---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-103](https://linear.app/minnowai/issue/MIN-103/polish-021-grep-search-tool)