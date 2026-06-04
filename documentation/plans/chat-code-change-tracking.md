# Chat code change tracking

## Goal

When the agent mutates the workspace, show:

1. Per-tool line stats (`+12 −3`, GitHub-style) on tool-call summary rows
2. Per-tool unified diff inside the expanded tool body
3. Per-chat cumulative stats in a strip above the composer
4. Per-workspace cumulative stats (all chats on the same `workspacePath`)
5. Backfilled totals for existing chats from persisted history (no tool re-run)

Sub-agent edits roll up to the parent chat via `parentChatId` on `executeTool`.

## Status

| Area | Location |
|------|----------|
| Server file diff | `server/tools/line-diff-stats.js`, `server/runtime/tools-middleware.js` |
| Git commit stats | `server/tools/git-change-stats.js`, `toolGitCommit` |
| Command snapshot | `server/tools/workspace-change-snapshot.js`, foreground `execute_command` |
| API | `POST /api/tools` returns `codeChange`; `POST /api/tools/code-change-for-commit` |
| Types + normalize | `src/types.ts`, `src/usage/code-change-payload.ts` |
| Ledger + workspace | `src/usage/code-change-ledger.ts` |
| Backfill | `src/usage/code-change-backfill.ts`, session load in `src/state/sessions.ts` |
| Recording | `src/tools/client.ts` |
| UI badges + diff | `src/ui/tool-messages.ts`, `src/styles/tool-call-diff.css` |
| Composer strip | `#codeChangeStrip`, `src/ui/code-change-strip.ts` |
| Workspace display | `src/ui/workspace-code-change.ts`, hub **Agent changes**, sidebar stats |
| Tests | `test/server/*`, `test/usage/*`, `test/ui/tool-messages-code-change.test.mjs` |

## Sources

| Source | `CodeChangeSource` | Notes |
|--------|-------------------|--------|
| File tools | `file-tool` | Deterministic before/after diff; capped `diffLines` |
| `git_commit` | `git-commit` | `git show --numstat` on HEAD after success |
| `execute_command` (git repo) | `command-snapshot` | `git diff --numstat HEAD` delta |
| `execute_command` (no git) | `command-heuristic` | Single-file sed/redirect best-effort |
| History scan | `backfill` | Approximate; tooltip in diff header |

## Limits

- Diff payloads capped at 500 lines per tool (`MAX_CODE_CHANGE_DIFF_LINES`)
- Background `execute_command` not snapshotted in v1 (foreground only)
- Backfill does not re-run shell; `git_commit` needs SHA in result for remote numstat
- Sub-agent history is not double-counted (parent chat totals only)

## Todos

- [x] Server diff stats + `diffLines` on file tools
- [x] `git_commit` + `execute_command` stats
- [x] Types, ledger, workspace rollup, API `codeChange` field
- [x] Persist on tool rows; backfill on session load
- [x] Tool badge + unified diff expando
- [x] Composer strip + hub/sidebar workspace hints
- [x] Tests + `documentation/context.md`
