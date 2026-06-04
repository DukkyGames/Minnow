# Chat code change tracking

## Goal

Track line additions/deletions for agent file-mutation tools (server-side diff), show GitHub-style `+`/`-` on each tool bubble, roll up totals on the parent chat (including sub-agents), and display cumulative stats in a strip above the composer.

## Status

| Area | Location |
|------|----------|
| Server diff | `server/tools/line-diff-stats.js`, wired in `server/runtime/tools-middleware.js` |
| Types + ledger | `src/types.ts`, `src/usage/code-change-ledger.ts` |
| Recording | `src/tools/client.ts` (`executeServerTool` + `recordCodeChange`) |
| History | `src/tools/loop.ts`, `src/agents/sub-agent-runner.ts`, `src/state/sessions.ts` |
| UI badges | `src/ui/tool-messages.ts`, `src/ui/messages.ts`, `src/ui/transcript-view.ts` |
| Composer strip | `index.html` `#codeChangeStrip`, `src/ui/code-change-strip.ts`, `src/styles/code-change-strip.css` |
| Client diff helper | `src/chat/prompts/text-diff.ts` → `countLineChangeStats` |
| Tests | `test/server/line-diff-stats.test.mjs`, `test/usage/code-change-ledger.test.mts`, `test/ui/tool-messages-code-change.test.mjs`, `test/prompts/text-diff.test.mjs` |

## Out of scope (v1)

- `execute_command`, `git_commit`, patch inference
- Unified diff in tool expando (badge only)
- Cross-chat aggregates
- Backfilling old chats without re-running tools

## Todos

- [x] Server diff stats + middleware `codeChange` payloads
- [x] Types, ledger, `executeTool` / client parsing
- [x] Persist on tool history + sub-agent messages; file-tree `chatId`
- [x] Per-tool badge + history replay
- [x] Composer strip + chat switch refresh
- [x] Tests + `documentation/context.md`
