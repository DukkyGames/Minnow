# Do not restart finished chats on open

**Summary:** Opening a chat that already has a completed assistant reply must not auto-send or auto-resume the tool loop; only genuinely interrupted turns should recover.

**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) — line 5

---

## Problem statement

When users open an older chat, Minnow often **restarts** generation as if the turn were still in progress. That happens unless the user had manually pressed Stop (which sets `pendingTurn.stopped === true`). Finished conversations should load statically from `history` only.

---

## Current behavior

| Step | Behavior | Key paths |
|------|----------|-----------|
| Chat switch / load | `bootTurnRecoveryForChat(chat)` always runs | `src/ui/sidebar.ts` (`switchChat`), session boot in `main.ts` |
| Recovery gate | If `shouldOfferRecovery(chat)` → `resumePendingTurn` → `sendMessage()` | `src/chat/turn-recovery.ts` |
| `shouldOfferRecovery` | True whenever `chat.pendingTurn` validates | `src/state/pending-turn-shape.ts` |
| Normal completion | `turnCheckpoint.complete()` → `clearPendingTurn(chat)` | `src/chat/turn-checkpoint.ts`, `src/tools/loop.ts` (~1039) |
| User stop | `finalizeStoppedTurn` sets `pendingTurn` with `stopped: true` — **skipped** by auto-resume | `src/chat/finalize-stopped-turn.ts`, `turn-recovery.ts` |
| Stale cleanup | `clearStalePendingTurn` only clears if **no** user messages | `pending-turn-shape.ts` — does not clear when last message is assistant |

**Failure mode:** `pendingTurn` remains on disk after a **successful** finish (crash before `complete()`, bug, or partial persistence), but `history` already contains the final `assistant` message. On open, `bootTurnRecoveryForChat` calls `resumePendingTurn` and re-runs the model.

---

## Proposed solution

### 1. Define “turn already finished”

Add `isPendingTurnObsolete(chat)` (pure function in `pending-turn-shape.ts`):

- If last history message is `assistant` with non-empty `content` (or tool-call chain complete per `hasPostToolTail` rules), treat `pendingTurn` as stale.
- If last message is `assistant` + `tool` results and a final assistant exists after tools, obsolete.
- If `pendingTurn.stopped === true`, never auto-resume (existing).
- If orphan user tail (no assistant), keep existing orphan banners — not obsolete.

### 2. Clear on load and on switch

- In `bootTurnRecoveryForChat`, before `shouldOfferRecovery`:
  - If obsolete → `clearPendingTurn(chat)`, `dismissPendingTurnRecovery()`, return.
- Extend `clearStalePendingTurnsOnLoad` to call obsolete check for every chat after session hydrate.

### 3. Harden completion path

- Audit `loop.ts` all exit paths (tool loop break, max turns, error) — ensure `turnCheckpoint.complete()` or explicit `clearPendingTurn` when assistant row pushed to history.
- On `recordAssistantReplyOnChat`, defensive clear of `pendingTurn`.

### 4. UI

- No Continue banner for obsolete checkpoints.
- If checkpoint exists but history shows complete message, optional one-time migration log in dev mode only.

---

## Implementation todos

- [ ] Implement `isPendingTurnObsolete(chat)` + unit tests in `test/state/pending-turn-shape.test.mts`
- [ ] Call obsolete check at start of `bootTurnRecoveryForChat`
- [ ] Extend `clearStalePendingTurnsOnLoad` in `sessions.ts` load path
- [ ] Audit `loop.ts` / `api/chat.ts` for `clearPendingTurn` on all success paths
- [ ] Add regression test: chat with history assistant + pendingTurn → switch does not call `sendMessage`
- [ ] Manual QA: finish chat, reload app, open chat — no new stream

---

## Files to change

| File | Change |
|------|--------|
| `src/state/pending-turn-shape.ts` | `isPendingTurnObsolete` |
| `src/chat/turn-recovery.ts` | Skip resume when obsolete |
| `src/state/sessions.ts` | Load-time cleanup |
| `src/tools/loop.ts` | Completion hardening |
| `src/api/chat.ts` | Plain send completion |
| `test/state/pending-turn-shape.test.mts` | New cases |
| `test/chat/turn-recovery.test.mts` | Boot recovery scenarios |

---

## Testing plan

1. Complete a turn normally — inspect `sessions/state.json` — `pendingTurn` absent.
2. Artificially inject `pendingTurn` + full assistant history — open chat — no API call / no stream row.
3. Interrupted turn (pending, no final assistant) — still auto-resumes or shows Continue per feature 22.
4. User-stopped turn — still no auto-resume; partial visible.
5. Orphan user message — orphan retry banner still shown.

---

## Risks / open questions

- **Tool-only tail:** Assistant message empty but tools complete — use `hasPostToolTail` / `resolveFinalAssistantContent` rules consistently.
- **Orchestrate board:** Pending board state separate from `pendingTurn`?
- **Migration:** One-time session scrub on load vs lazy on switch — prefer both.
