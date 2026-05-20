# Switch chats while waiting for a response

**Summary:** Allow changing the active chat in the sidebar while another chat’s tool loop is still streaming, without blocking navigation or corrupting the in-flight turn.

**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) — line 1

---

## Problem statement

Users cannot multitask across chats during long agent runs. Today, any in-flight generation sets a **global** `streaming` flag and hard-blocks sidebar navigation with “Finish the current reply first.” That forces users to wait on one chat even when they only want to check history or start work in another thread.

---

## Current behavior

| Area | Behavior | Key paths |
|------|----------|-----------|
| Global streaming | Single `streaming` boolean; optional `streamingChatId` for sidebar dot | `src/app-state.ts` (`setStreaming`) |
| Chat switch guard | `switchChat`, `createChat`, `deleteChat` return early when `streaming` | `src/ui/sidebar.ts` (lines ~321–324, ~361–364, ~271–274) |
| Composer | Send blocked when streaming (stop button); recovery can disable input | `src/ui/composer-send.ts`, `src/tools/loop.ts` (`sendMessageWithTools` early return) |
| Mode / view toggles | Disabled while `streaming` | `src/ui/mode-selector.ts`, `src/ui/view-mode-toggle.ts` |
| Sidebar dot | Only the chat matching `streamingChatId` shows active streaming indicator | `src/ui/chat-item-dot.ts` |
| Message DOM | `renderChatFromHistory` clears `#chatArea` on every switch — would destroy a live stream row if switch were allowed without detaching | `src/ui/messages.ts` |
| Abort | `chatFetchAbort` is global, not per-chat | `src/app-state.ts` |

The architecture already tracks **which** chat is streaming (`streamingChatId`) but treats streaming as a **UI-wide lock** on navigation.

---

## Proposed solution

### 1. Per-chat streaming state (keep global convenience)

- Introduce a small registry (e.g. `Map<chatId, TurnController>`) or extend `setStreaming` so “is this chat busy?” is queryable without blocking unrelated chats.
- Keep `streaming === true` when **any** chat is active, for top-level affordances that should reflect “something is running” (optional: only when **active** chat is streaming).
- `streamingChatId` remains the source of truth for sidebar dots.

### 2. Allow `switchChat` while another chat streams

- Remove the `if (streaming) return` guard in `switchChat` (and likely `createChat`; **keep** guard on `deleteChat` of the streaming chat or abort-first confirm).
- On switch **away** from streaming chat:
  - Do **not** abort the in-flight fetch unless the user explicitly stops generation.
  - Do **not** call `renderChatFromHistory` on the streaming chat’s DOM while it is detached — either leave the loop updating an off-DOM snapshot or pause live DOM updates until the user returns (see 3).
- On switch **to** a non-streaming chat: normal `renderChatFromHistory` + `bootTurnRecoveryForChat`.
- On switch **back** to streaming chat: reattach or rebuild UI from `chat.history` + `pendingTurn` live capture (`registerPendingTurnLiveCapture` in `src/chat/turn-checkpoint.ts`).

### 3. Tool loop DOM lifecycle

- Refactor `src/tools/loop.ts` so stream row/bubble refs are keyed by `chatId`, not assumed to be `#chatArea` of the active chat.
- When active chat ≠ streaming chat: skip `appendStreamingAssistantRow` / bubble updates in visible DOM; continue checkpointing via `turnCheckpoint` + `syncPendingTurn` (already persisted).
- When user returns to streaming chat: if loop still running, mount stream row from pending snapshot; if completed while away, render from history.

### 4. Composer behavior

- Active chat **not** streaming: composer enabled (new message to that chat).
- Active chat **is** streaming: current behavior (stop button).
- Non-active chat streaming: show subtle status (“Reply in progress in *Chat name*”) and optional “Go to chat” link; do not block typing in the active chat.

### 5. Edge cases

- **Stop** while viewing another chat: abort must target the streaming chat’s controller, not only active chat.
- **Workspace switch** with background stream: define policy (abort all, or allow background completion).
- **Orchestrate board view** (`renderChatFromHistory` short-circuit): same detachment rules when `viewMode === 'board'`.

---

## Implementation todos

- [ ] Add `getStreamingChatId()` / `isChatStreaming(id)` helpers on top of `app-state` (or dedicated `stream-registry.ts`)
- [ ] Remove navigation block from `switchChat`; define delete/create rules when target chat is streaming
- [ ] Key loop DOM handles (`wrap`, `bubble`, `streamStatus`) by `chatId` in `loop.ts`
- [ ] Gate live DOM updates in loop when `getActiveChat().id !== streamingChatId`
- [ ] On `switchChat`, branch: render history vs reattach stream vs background-only checkpoint
- [ ] Update composer + status strip for “streaming elsewhere” UX
- [ ] Ensure `stopGeneration` resolves correct chat’s `AbortController`
- [ ] Audit `refreshModeSelectorDisabled` / view-mode toggle — disable only when **active** chat streams (or document intentional global lock)
- [ ] Add unit tests for switch-while-streaming (happy-dom: mock loop + sidebar)
- [ ] Manual QA: long tool run, switch away, send in second chat, switch back, stop from either chat

---

## Files to change

| File | Change |
|------|--------|
| `src/app-state.ts` | Per-chat streaming helpers |
| `src/ui/sidebar.ts` | Remove switch guard; optional “streaming” badge on non-active rows |
| `src/tools/loop.ts` | Chat-keyed DOM; conditional render |
| `src/ui/messages.ts` | Reattach stream UI; safe `renderChatFromHistory` |
| `src/ui/composer-send.ts` | Composer rules when background stream exists |
| `src/chat/turn-checkpoint.ts` | Ensure checkpoint works without visible DOM |
| `src/ui/chat-item-dot.ts` | Verify dot for non-active streaming chat |
| `test/ui/sidebar-streaming-switch.test.mjs` | New tests |

---

## Testing plan

1. Start a slow reply in chat A (tool loop or plain stream).
2. Switch to chat B — sidebar must not show error; B’s history loads.
3. Send a message in B — must not abort A unless specified.
4. Switch back to A — see partial stream or completed message.
5. Press Stop while on B — A’s stream stops; pending turn handled per stop rules.
6. Reload session — persisted `pendingTurn` still recovers per existing feature 22 rules.
7. Regression: mobile sidebar, orchestrate board view, sub-agent cards.

---

## Risks / open questions

- **Memory:** Multiple concurrent streams — is only one allowed at a time (recommended v1) or true parallel sends?
- **API load:** Two simultaneous LM Studio streams — provider limits?
- **UX:** Should creating a new chat abort the background stream or leave it running?
- **Implementation cost:** Largest change is loop DOM detachment; consider v1 “switch allowed but only one stream” before parallel streams.
