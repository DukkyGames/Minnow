# Chat code change tracking

## Goal

Track line additions/deletions when the agent mutates the workspace; show GitHub-style `+`/`-` on tool rows, a **unified diff** in the expanded tool body, **per-chat** totals above the composer, **per-workspace** rollups (hub/sidebar), and **backfill** totals from existing history without re-running tools.

Sub-agent mutations roll up to the parent chat and workspace.

## Status

Planning complete — implementation pending.

## Mutation sources (in scope)

| Source | Mechanism |
|--------|-----------|
| File tools | `save_file`, `append_file`, `insert_at_line`, `replace_text_in_file`, `delete_path`, `move_file`, `copy_file` — before/after content diff on server |
| `git_commit` | `git show --numstat` / patch for HEAD after successful commit |
| `execute_command` | Git working-tree snapshot before/after; fallback heuristics for `sed -i`, `patch`, redirects |
| Backfill | Scan `chat.history` + `subAgentRuns.messages`; parse tool args; optional `git show` for known SHAs |

## UI surfaces

| Surface | Location |
|---------|----------|
| Per-tool badge | `src/ui/tool-messages.ts` summary row |
| Unified diff expando | Same file — reuse `src/ui/prompt-diff-unified.ts` |
| Chat totals strip | `index.html` `#codeChangeStrip`, `src/ui/code-change-strip.ts` |
| Workspace totals | `SessionState.codeChangeTotalsByWorkspace`, `src/ui/hub.ts` (and optional sidebar) |

## Key modules (planned)

| Area | Location |
|------|----------|
| Server line diff | `server/tools/line-diff-stats.js` |
| Git / command delta | `server/tools/workspace-change-snapshot.js` |
| Middleware wiring | `server/runtime/tools-middleware.js` |
| Types + ledger | `src/types.ts`, `src/usage/code-change-ledger.ts` |
| Backfill | `src/usage/code-change-backfill.ts` |
| Recording | `src/tools/client.ts` |
| History | `src/tools/loop.ts`, `src/agents/sub-agent-runner.ts`, `src/state/sessions.ts` |

## Todos

- [ ] Server diff stats + file-tool `codeChange` + capped `diffLines`
- [ ] `git_commit` numstat + `execute_command` snapshot / heuristics
- [ ] Types, chat + workspace ledger, `executeTool` parsing
- [ ] Persist on tool history + sub-agent messages
- [ ] History backfill on session/chat load
- [ ] Tool badge + unified diff expando
- [ ] Chat composer strip + workspace aggregate UI
- [ ] Tests + `documentation/context.md`

## Accuracy notes

- File tools and git commit stats are authoritative at execution time.
- Command snapshot depends on a git repo; heuristics are best-effort and labeled in metadata.
- Backfill may be approximate for overwrites (`save_file` without stored before-content); use `source: 'backfill'`.
