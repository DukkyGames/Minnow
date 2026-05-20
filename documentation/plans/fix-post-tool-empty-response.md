# Fix post-tool empty response (implemented)

## Problem

After tool execution, some models return `finish_reason: stop` with empty `content`. The tool loop only pushed an `assistant` message when `fullText` was truthy, so session history could end with `tool` rows only and the UI showed no final reply.

## Solution

| Area | Change |
|------|--------|
| [`src/tools/turn-continuation.ts`](../../src/tools/turn-continuation.ts) | Pure helpers: `resolveTurnContinuation`, `resolveFinalAssistantContent`, `hasPostToolTail`, dev `logTurnDebug` |
| [`src/tools/loop.ts`](../../src/tools/loop.ts) | Always commit final assistant + `setStatus('ok')`; bounded post-tool retry with ephemeral user line |
| [`src/chat/turn-recovery.ts`](../../src/chat/turn-recovery.ts) | `hasOrphanToolTailAwaitingReply` / `getOrphanToolTailUserIndex` |
| [`src/ui/pending-turn-recovery.ts`](../../src/ui/pending-turn-recovery.ts) | Tool-tail retry banner |

## Manual repro (dev)

1. `npm start`, open app devtools console.
2. `localStorage.minnowDebugTurns = '1'` — per-round `[minnow:turn]` logs.
3. Repro matrix:
   - `read_file` on a medium/large file (weak model → empty post-tool).
   - `spawn_sub_agent` with `wait: true` (large tool JSON → empty post-tool).
4. Confirm network: post-tool request has `finish_reason: stop`, empty content; client either auto-retries once or shows placeholder in history.

## Tests

- `test/tools/run-chat-turn-outcome.test.mts`
- `test/state/turn-recovery.test.mts` (tool tail cases)

Run: `npm test`.
