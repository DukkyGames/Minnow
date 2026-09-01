# MIN-647 — Queued message display

**Status:** done  

**Issue:** [MIN-647](https://linear.app/minnowai/issue/MIN-647/add-queued-message-display) / [HenriGrimm/Minnow#922](https://github.com/HenriGrimm/Minnow/issues/922)  
**Overlaps:** [MIN-587](https://linear.app/minnowai/issue/MIN-587) item 2 (Local Server queue indicator — implement once)

## Problem

Composer follow-ups already persist on `chat.pendingMessageQueue` (MIN-200) and a compact strip sits above the input, but the **transcript looks idle** after Enter — the message is sent-and-forgotten. Independently, when llama.cpp is saturated (`--parallel` slots full), **Local Server** has no queue-depth reading.

## Approach

1. **Chat transcript** — paint queued follow-ups as muted user bubbles at the tail (`#queuedTranscript`), with the same edit / push-now / delete actions as the composer strip. Live rows (stream, tools, cards) insert *before* that cluster so order stays: history → in-flight turn → queued. The cluster is removed as soon as `flushPendingMessageQueue` dequeues an item (turn start), not after the next turn finishes.
2. **Local Server** — poll llama.cpp `GET /metrics` beside `/slots` and surface `llamacpp:requests_deferred` as `ServeActivity.queued`. Loaded-model chips and the header picker suffix share that field (MIN-587 item 2).

Composer strip stays; it is the compact control. Transcript bubbles are the “not forgotten” reading.

## Todos

- [x] Plan this work
- [x] Transcript queued bubbles + insert-before-queue helper
- [x] Flush notifies UI immediately on dequeue
- [x] Serve activity `queued` from `/metrics`
- [x] Local Server + picker chips
- [x] Tests
- [x] Docs (`context.md`, chatting manual, models manual)
- [x] Typecheck + scoped tests
- [x] Fix circular-import TDZ on queue-changed listener
- [x] Fix composer-message-queue test parse leftover
