# Plan: Chat-stream UI lag (all OS, local and cloud)

**Linear:** Orchestrator V2 [Phase 7](https://linear.app/minnowai/issue/MIN-727/phase-7-chat-stream-ui-stays-responsive-mid-generation) · [P7-A](https://linear.app/minnowai/issue/MIN-728) · [P7-B](https://linear.app/minnowai/issue/MIN-729) · [P7-C](https://linear.app/minnowai/issue/MIN-730) · [P7-D](https://linear.app/minnowai/issue/MIN-731)

## Status

Research complete. Tracked as V2 Phase 7 ([MIN-727](https://linear.app/minnowai/issue/MIN-727)). Confirm with a Performance panel + `MINNOW_DEBUG=1` long-task log before implementing. Can start now; does not wait on Phases 1–6.

## Todos

- [ ] Measure: one cloud turn and one local turn with `MINNOW_DEBUG=1`; capture `[minnow:longtask]` + Chromium Performance profile
- [ ] Confirm whether “external” means remote APIs or LM Studio on localhost (`isLocalProvider` is true for loopback)
- [ ] P0: Coalesce `handleChunk` work onto one rAF / 50–100 ms tick; yield between SSE blocks in a burst
- [ ] P0: Call `scrollChatIfPinned` once per paint, not per token (loop, thought bubble, markdown flush)
- [ ] P1: Stop joining full thinking text on every chunk; pass length/delta into live stats instead
- [ ] P1: Ticked motion — drop periodic `document.getAnimations()`; park by mutation / known roots
- [ ] P2: Align `STEP_HZ` comments (code is 20 Hz, comments still say 8 Hz)
- [ ] Verify: idle UI unchanged; local tok/s not regressed; cloud and local typing/scroll stay responsive mid-stream

## Symptom

UI is fine when nothing is generating. While a chat is in flight the shell feels laggy. Reported on **all OS**, with **local and external providers**.

Idle-ok + in-flight-bad means the stream path on the **renderer main thread**, not boot, not SQLite, not a single OS GPU driver.

## Verdict

The local tok/s work (`acquireTickedMotion`) is a **real local amplifier** (whole-document animation park + `getAnimations()` style recalc). It **cannot** be the sole cause of cloud lag, because it is gated on `isLocalProvider`.

The path that matches “every provider, every OS” is **unthrottled per-SSE-event work** in `streamCompletionTurn`: parse, thinking join, forced scroll layout, then a 100 ms markdown lex of the growing reply.

Keep the tok/s wins. Fix the shared fanout. Narrow the ticker’s rescan.

## Will Orchestrator V2 (Phase 1 & 6) fix this?

**No — not as currently specified, and not on a timeline that helps now.**

Provider streaming is **already** server-side (`server/generations/upstream.js`). Finding A in [`orchestrator-v2-implementation.md`](./orchestrator-v2-implementation.md): the PRD’s “move streaming server-side” risk is largely done. The lag is the **renderer still applying every token to the DOM**.

| Phase | What it moves | Effect on this lag |
|---|---|---|
| **1** — Server engine, SSE, renderer as view ([MIN-678](https://linear.app/minnowai/issue/MIN-678)) | Board *scheduler* only. Scripted effector, **zero LLM**. Normal chat unchanged. Client loop keeps serving chat through Phase 5. | None for chat. May later reduce *board* freezes (kanban no longer refreshes on per-token `subscribeChatStreamActivity`) once Phase 2 agents exist. |
| **6** — Normal chat adopts `runTurn()` ([MIN-683](https://linear.app/minnowai/issue/MIN-683)) | Turn *loop* (tools, routers, budget) off `loop.ts`. Scheduled **after Phase 5**. | Moves CPU that is not the freeze. P6-A: `onEvent` drives the **existing chat DOM**. P6-C accept: streaming/thinking/tools **visually identical**. Markdown lex, scroll layout, thought paint, ticked motion all stay in the renderer unless event grain is changed — and the plan does not change it. |

Do not wait on V2 for this. The P0 coalesce (one paint + one scroll per frame) is independent and still needed after Phase 6 unless `onEvent` is defined as throttled snapshots rather than per-token deltas. That grain is an open product choice for P6-A; it is not in the current issues.

## Tok/s work (what we shipped)

| Piece | File | Gate | Intent | UI side effect |
|---|---|---|---|---|
| Ticked motion | `src/ui/motion-ticker.ts` | Local provider stream | Drop compositor from vsync (~6 tok/s at 144 Hz) to 20 Hz | Parks **every** infinite animation in the document; `getAnimations()` every 250 ms forces style recalc (authors already noted input/scroll latency) |
| Hidden-window park | `src/boot/render-idle.ts` + `src/styles/motion.css` | Window hidden / minimised | Same vsync tax while AFK | None while the window is visible |
| `backgroundThrottling: false` | `electron/main.ts` | Always | Keep SSE + AFK timers alive | Compositor stays unthrottled; decorative CSS runs at full rate unless parked |
| Loader spinner stop | `index.html` | After `app-ready` | Leftover vsync after boot | Idle only |
| Live metrics | `src/chat/streaming-stats.ts` | Every stream | Live tok/s / TTFT | ~100 ms strip update — cheap |

`loop.ts` still comments “8 Hz” and “no-op for cloud”. Actual `STEP_HZ` is **20**. Cloud never calls `acquireTickedMotion`.

`isLocalProvider` is true for llama.cpp, mlx-lm, `lm-studio-local`, and **any** `localhost` / `127.0.0.1` / `::1` base URL (LM Studio, Ollama, MTPLX). If “external” meant LM Studio, both sessions run the ticker.

## Shared stream path (primary suspect)

Main chat: `runChatTurn` → `streamCompletionTurn` → `subscribeToGeneration`.

`GET /api/generations/:id/stream` pumps SSE on the renderer. One `reader.read()` can contain many `\n\n` blocks. Each block calls `onChunk` **synchronously** (`src/api/generations.ts`). There is no `scheduler.yield()` between events.

Per event (`handleChunk` in `src/tools/loop.ts`):

1. Merge stream meta, route reasoning / content / tool deltas
2. `ThoughtBubbleController.appendReasoningDelta` (invalidates join cache)
3. `emitStreamProgress` → `getJoinedDisplayText()` (rebuilds the full thinking string)
4. `scrollChatIfPinned()` if the transcript is visible — reads `scrollHeight`, writes `scrollTop`, schedules rAF
5. `onStreamContextActivity` → `setContextInFlightOverlay` (joins thinking again) + `notifyChatStreamActivity`

Throttled but still UI-thread:

- Markdown: `scheduleAssistantBubbleRender` every **100 ms** (`ASSISTANT_RENDER_DEBOUNCE_MS`). Incremental DOM reuse is O(dirty suffix). `marked.lexer(raw)` still lexes the **entire** growing reply each paint.
- Stats strip: 100 ms
- Context ring: 1000 ms trailing debounce (the overlay object is still replaced every token)

`appendReasoningDelta` also calls `scrollChatIfPinned`. Markdown flush calls `scrollBottom` → `scrollChatIfPinned` again. That is **two or three forced layouts per token / paint**.

This path does not care whether the upstream is llama.cpp or Anthropic. Faster models burst more events per read, so they feel worse.

## Why the ticker is still in the dock

For **local** sessions it is doing what it was asked: zero running compositor animations except the 20 Hz step. The implementation is exhaustive on purpose (one leftover spinner cancels the tok/s win).

Cost of that exhaustiveness:

- `document.getAnimations()` is a document-wide style recalc
- Stepping `currentTime` on every looping animation in the shell (sidebar, status, thinking caret, streaming caret)
- The UI clock drops to 20 fps of motion, which reads as lag even when hit-testing still works

Do **not** remove it. Change **how** it finds animations.

## Out of scope (already handled or not this bug)

- Boot / eager JS (`MIN-584`) — idle is fine
- Board `scheduleBoardUiRefresh` rAF coalesce — already landed; still relevant if lag is board-only
- Message-list virtualization — long **history** rebuilds, not live stream
- Hidden-window animation pause — not visible-window lag

## Measurement (do this before coding)

1. `MINNOW_DEBUG=1` → renderer console `[minnow:longtask]` (threshold 100 ms)
2. Chromium Performance on the Electron renderer: one cloud turn, one local turn, 20–30 s each
3. Compare: short chat vs long thinking; reasoning collapsed vs expanded; Code app vs Chat app
4. Optional: `prefers-reduced-motion` — if lag vanishes, compositor/ticker; if it stays, JS fanout

Look for: **Layout** (`scrollHeight` / `getAnimations`), **Scripting** (`marked.lexer`, string join), **Animation** (caret / spin).

## Implementation sketch (after measurement)

### P0 — shared fanout

- Buffer SSE chunks; apply UI at most once per animation frame (or 50–100 ms)
- If a `read()` delivers N blocks, process a bounded number then `await` a rAF / `scheduler.yield()`
- Single `scrollChatIfPinned` from the paint path (`flushAssistantBubbleRender`), remove the per-chunk and per-delta calls

### P1 — thinking + ticker

- Live stats: store thinking length / last delta; do not join segments every chunk
- Ticked motion: register animations when stream chrome mounts, or `MutationObserver` on known roots; delete the 250 ms `getAnimations()` sweep (or run it once on acquire)

### P2 — hygiene

- Comments and JSDoc: 20 Hz, not 8 Hz
- Consider not parking animations outside chat chrome (sidebar rings) unless tok/s measurement still requires it

## Accept

- Typing, scrolling, and clicking stay responsive during cloud and local streams
- Local tok/s on a fixed prompt is not worse than today (repeat the original 144 Hz vs parked measurement)
- `npx tsc --noEmit` + existing motion-ticker and markdown incremental tests
- Manual: Code + Chat app, collapsed thinking, long reply with a fenced code block
