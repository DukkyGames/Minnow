---
name: Fixer board report routing
overview: Fix fixer tasks not advancing after a pass board_report by correcting the env-fixer to testing transition with slot priority, merge-fixer verify-failure retry with context, and hardening stream-end routing when fixerChatId was cleared early.
status: completed
todos:
  - id: fix-env-finalizer
    content: "finalizeEnvFixerOnStreamEnd: moveTaskStatus to testing, reserve tester slot / enqueue at front, await startTaskTesting before finalize returns (prevent sibling steal)"
    status: completed
  - id: fix-merge-verify-retry
    content: "On pass board_report + verify failure: retry merge fixer with fixerAttempts, restore integration, re-spawn with seed explaining verify failure (not silent complete)"
    status: completed
  - id: fix-stream-end-fallback
    content: Add resolveFixerTaskForStreamEnd helper and route unmatched fixer stream-end via chat.boardTaskId before drain-only fallback
    status: completed
  - id: add-tests
    content: Add env-fixer concurrency test (sibling queued but testing wins), merge verify-fail retry seed test, unmatched stream-end fallback test
    status: completed
  - id: update-context
    content: Update documentation/context.md Orchestrate board section with fixer pass routing behavior
    status: completed
---

# Fix fixer pass board_report routing

## Problem

Fixer agents write `board_report({ outcome: "pass" })` correctly and the orchestrator delegates the next task, but the **fixing task** stays stuck (`in_progress` for env fix, `merging` for merge fix) instead of moving to **Testing** or **Complete**.

## Shipped fixes

1. **Env-fixer test-phase pass** — `finalizeEnvFixerOnStreamEnd` moves to `testing`, pre-reserves the tester slot, clears fixer linkage, then `await startTaskTesting({ enqueueAtFront, allowPreReservedTestChat })`.
2. **Merge-fixer verify-fail retry** — pass `board_report` still requires `verifyIntegrationMerge`; failures build a verify summary and re-spawn the merge fixer with enriched seed (attempt number + failure reason).
3. **Stream-end fallback** — `resolveFixerTaskForStreamEnd` routes via `Chat.boardTaskId` when `fixerChatId` was cleared before delivery.
4. **`getOrCreateBoardChat`** — re-links `taskChatField` when reusing an existing chat (fixes fixer retry after `fixerChatId` was cleared).

## Test plan

```bash
npx tsx --import ./test/test-loader.mjs --test test/orchestrate/fixer-recovery.test.mts test/orchestrate/merge-fixer-finalize.test.mts
```
