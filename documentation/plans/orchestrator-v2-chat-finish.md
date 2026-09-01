# Finish Orchestrator V2 chat regressions

**Status:** Implemented  
**Date:** 2026-09-01  
**Linear:** [Orchestrator V2](https://linear.app/minnowai/project/orchestrator-v2-97ced8c22ad8) leftover merge-gate symptoms after Phase 6/10 (`runChatTurn` → `runTurn()`).

One PR that closes four leftover product-chat bugs from the runner migration: in-transcript **Loading model…**, composer stuck in follow-up after a turn, agent-activity rows that never clear, and live stream/tools painting into the chat you switched to.

Do not change `server/runner/` unless a test proves the runner emits into the wrong chat — this is a caller/DOM isolation bug.

## Todos

- [x] Write this plan with the four bugs and the teardown contract
- [x] Mount streaming row before `ensureChatModelLoadedForTurn`; set stream-status and sidebar phase to `loading_model`
- [x] Sync composer from streaming state in `runChatTurn` `finally`; dispose leftover stream-status / awaiting-prose chrome
- [x] Clear `currentGenerationId` in `finally`; rehydrate parent sub-agents on stream-end so terminal runs leave the panel
- [x] Gate painter DOM writes on `isStreamDomVisible(originChatId)`; keep remount-on-return
- [x] Add stream-end composer, loading-model, activity-snapshot, and switch-chat paint tests; update `documentation/context.md`

## Shared teardown (`runChatTurn` `finally`)

Ordered teardown (touches bugs 2–4):

1. `setStreaming(false)` + `notifyChatStreamEnded` (existing PRD §1.3 order).
2. Clear `currentGenerationId` unless resumable Stop (`stopReason === 'system'`).
3. `clearMainTurnActivity` + `syncComposerFromStreamingState()` if this chat is still active (even when `ownsGlobalStreaming` is false).
4. Dispose stream status / remount listener; drop awaiting-prose shells that never revealed.
5. Hydrate parent sub-agents if any still look `queued` / `running` in the client map.

## 1. Missing Loading model in the transcript

**Symptom:** Sending while a My Models / Minnow host model is still loading does not show **Loading model…** in the chat row. Status-bar copy may appear; the in-transcript `stream-status` never does.

**Cause:** `runChatTurn` sets `setStatus('spin', 'Loading model…')` during `ensureChatModelLoadedForTurn`, but `appendStreamingAssistantRow` (which attaches `attachStreamStatus` and the `loading_model` phase) runs **after** the await. The row defaults to **Generating response…**. `setSidebarStreamPhase('loading_model')` is also never called on this path.

**Fix:** Create the streaming assistant row **before** `ensureChatModelLoadedForTurn`. `streamStatus.setPhase('loading_model')` + `setSidebarStreamPhase('loading_model', chat.id)` while `pendingModelLoad`. After load, switch to `generating` / **Generating reply…**. Keep the status-bar string; MIN-587 % progress stays out of this PR.

## 2. Composer stuck on follow-up after the turn ends

**Symptom:** After the agent turn finishes, the composer stays in streaming chrome (placeholder **Add a follow-up**, Stop affordance) until you switch chats and come back. Switch works because `switchChat` calls `syncComposerFromStreamingState()`.

**Cause:** `endRunTurnChatStreaming` does `setStreaming(false)` then `notifyChatStreamEnded`. It never calls `syncComposerFromStreamingState`. Code `#chatArea` is not a `subscribeChatStreamEnd` listener. A second leftover: live `stream-status` is not always disposed in `finally`, so **Generating response…** / **Running tools…** can stay in the transcript until a history rebuild.

**Fix:** After `endStreamingImpl` in `finally`, if this chat is still active, call `syncComposerFromStreamingState()`. In `finally`, dispose stream status and drop awaiting-prose shells that never revealed.

## 3. Agents remain in agent activity after they finish

**Symptom:** Agent activity rows (and elapsed timers) keep running after the work is done.

**Causes:**

- **Main turn fallback.** `buildAgentActivitySnapshot` builds a `main:<chatId>` row from `chat.currentGenerationId` even after `clearMainTurnActivity`. `runChatTurn` only clears that id on some success/fail branches, not in `finally`.
- **Sub-agent client map.** `listActiveSubAgentRuns` keeps `queued` / `running`. If SSE misses the terminal fold, the run stays until `hydrateSubAgentRunsForParentChat` on chat switch.
- Title jobs already unregister via `emitTitleJobEnded` when the job finishes; they are scheduled *after* the turn and must not be cleared on stream-end.

**Fix:** In `finally`, always `chat.currentGenerationId = undefined` unless Stop is the resumable system path; `touchChat` + save; `clearMainTurnActivity`. On parent stream-end, if any sub-agent for that parent is still live in the client map, re-fetch `/api/agents?parentChatId=`.

## 4. Switching chats while running paints into the new chat

**Symptom:** Mid-turn switch to another chat: tools, stream tokens, and responses appear in the chat you switched **to**.

**Cause:** There is one `#chatArea`. `setTurnChatMount(getActiveChatMountElement())` pins that shared node. `switchChat` wipes it and paints B. The painter for A still holds `host.mount === #chatArea` and `tool_call` does `host.mount.appendChild(wrap)` with **no** `isStreamDomVisible(host.chatId)` check.

**Fix:** Do not remove `turnMount` (it still blocks `launch_minnow_app` rerouting). Gate every painter DOM write (`delta` paint, `tool_call` append, `tool_result` live-DOM resolve, `beginNextStreamingRow`) on `isStreamDomVisible(originChatId)`. Keep in-memory snapshots so remount can catch up. `registerStreamDomRemount` must pass `mount` only when origin is visible. `remountStreamDomForChat` on switch **back** stays the recovery path.

## Verification

- Unit tests: stream-end composer, loading-model transcript, activity snapshot after a finished turn, switch-chat paint isolation + remount.
- Manual (after unit tests): send on an unloaded My Models row; finish a Build turn without switching; spawn a sub-agent and wait for it to finish; start a turn in A, switch to B mid-tools, confirm B stays clean, switch back to A.
