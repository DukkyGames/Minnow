# MIN-584 — Multi-chat runtime performance

Rebuilt 2026-09-02 against Orchestrator V2. Runtime stalls with several chats, not cold-boot cost.

Suggested order: **P0-1 → P0-3 → P0-2 → P1-3 → P1-1/P1-2 → P1-4 → P2s**.

Cold-boot / bundle findings from 2026-08-09 stay follow-ups; they do not explain the freeze.

## Todos

- [x] **P0-1** Close sub-agent SSE on terminal (client + server `done` + `res.end()`); skip `connect()` for terminal hydrates; regression test for open-stream count
- [x] **P0-3** Coalesce `renderSidebar()` after tool batches (rAF), keep immediate render for user-driven switches
- [x] **P0-2** Keyed incremental sidebar (no `innerHTML = ''`); keep previous transcript until a fragment is ready (sync staging swap; chunking deferred to avoid remount races)
- [x] **P1-3** Gate dirty-tracking shadow behind the DEV verifier; save timer max-wait throttle; `touchChat` on `lastStats`
- [x] **P1-1** Skip tool-card DOM construction when the stream is not visible
- [x] **P1-2** Per-chat overlay `Map`; streaming context-ring throttle (leading+trailing); skip ring refresh for background chats
- [x] **P1-4** Windows: async/idle warmup for PowerShell ancestor PIDs and WSL probes (no sync spawn on first tool)
- [x] **P2-1** Acquire ticked motion for all providers; coalesce `getAnimations` to one rAF per mutation burst
- [x] **P2-2** No-op `notifyChatStreamActivity` when there are no subscribers
- [x] **P2-3** Cache chat scroll root; skip DOM query when unpinned; drop dead `if (false)` branch
- [x] Tests + `documentation/context.md`

## Decisions

1. **P0-1 multiplex vs close-on-terminal.** Close-on-terminal plus skip-connect for hydrates is the contained fix. Per-parent multiplex is deferred; live runs already sit under the engine concurrency cap (~3).
2. **P0-2 transcript.** Full virtualization is out of scope. Build off-DOM, swap once; chunk across frames only when history is large so small-chat tests stay synchronous.
3. **P0-3.** Immediate `renderSidebar()` for click/switch; `scheduleRenderSidebar()` for tool-batch and other hot paths.
4. **Cold boot.** Not in this pass (eager CodeMirror, Bench on the eager graph, sequential `initApp`, entry CSS).
