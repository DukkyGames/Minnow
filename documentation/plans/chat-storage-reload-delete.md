# Chat storage: reload wipe + delete failures

## Status

- **Branch:** `cursor/fix-chat-delete-min-509-fa37` (extends MIN-509)
- **Symptoms:** Deleting chats appears to do nothing; reloading empties the chat list (and creating a new chat after reload can permanently wipe rows from `sessions.db`).

## Todos

- [x] Map client/server load → save → delete path (SQLite + lazy summaries)
- [x] Confirm live `~/.minnow/sessions/sessions.db` still holds chats (UI/list bug vs total data loss)
- [x] Root-cause: `normalizeChatRow` dropped `messageCount` on summary boot
- [x] Preserve `messageCount` in `CHAT_PASSTHROUGH_KEYS` + re-apply in `sessionStateFromSummaries`
- [x] Fail-safe: unloaded chats with undefined `messageCount` stay listable / unpruned
- [x] Root-cause (delete): overlapping PUT/PATCH cleared `deletedChatIds` and resurrected chats
- [x] Serialize session flushes + dirty-epoch clear + immediate delete flush
- [x] Harden chat context-menu outside dismiss (pointerdown, ignore menu target)
- [x] Tests: sidebar listing + lazy load persistence + delete-during-PUT race
- [x] Update `documentation/context.md`
- [ ] Manual verify: reload keeps sidebar; delete removes + stays gone after reload
- [ ] Merge with MIN-509 UI refresh fixes

## How storage works

| Layer | Role |
|-------|------|
| Client `sessionState` | In-memory SessionState (`src/state/sessions.ts`) |
| Boot (C.2) | `GET /api/config/sessions/summaries` → empty `history`, denormalized `messageCount` |
| History on demand | `ensureChatHistoryLoaded` → `GET …/history/:chatId` |
| Save | Debounced PATCH (dirty sets) or full PUT (first save after load) |
| Delete | `removeChatById` → `deletedChatIds` + PATCH `deleteChatIds` (or omitted from PUT) |
| Disk | `~/.minnow/sessions/sessions.db` (rollback: `MINNOW_SESSIONS_STORE=json`) |

Rails hide “ephemeral empty” chats (`history` empty, no draft) via `chatHasListableContent`. Lazy-boot rows must use `messageCount` because `history` is `[]` until hydrate.

## Root cause (reload / wipe)

1. `chatSummaryToChat` sets `messageCount` from the summaries API.
2. `parseSessionStateFromJson` → `ensureChatShape` → `normalizeChatRow` **stripped** `messageCount` (not on `CHAT_PASSTHROUGH_KEYS`).
3. `sessionStateFromSummaries` re-applied `historyLoaded = false` but **not** `messageCount`.
4. Every prior chat looked empty → blank sidebar/rail after reload.
5. Creating a new chat calls `pruneEphemeralEmptyChats`, which removed those “empty” rows from memory; the next full PUT then deleted them from SQLite.

MIN-509 (same branch) separately fixed delete UX: unassigned-workspace active fallback, remembered-id purge, and refreshing Code / desktop / Chat-app rails after delete (context-menu click propagation).

## Root cause (delete resurrects)

1. First save after load is a full PUT (can be slow with large histories).
2. User deletes a chat → `deletedChatIds` + debounced save.
3. A second PATCH/PUT could start while the PUT was still in flight, or the PUT’s `.then` cleared **all** dirty sets — including deletes that landed mid-flight.
4. Stale PUT body still contained the deleted chat → SQLite rewrite restored it.

## Fix

1. Add `messageCount` to `CHAT_PASSTHROUGH_KEYS`.
2. Re-apply `messageCount` from each summary after parse in `sessionStateFromSummaries`.
3. If `historyLoaded === false` and `messageCount` is **undefined**, treat as listable (do not prune).
4. Serialize flushes; clear dirty sets only when `sessionDirtyEpoch` is unchanged; queue follow-up save when dirty work races an in-flight write.
5. `removeChatById` calls `saveSessionsNow()` immediately.
6. Context menu: dismiss on outside `pointerdown` (ignore presses inside the menu).
7. **Actual delete no-op in Electron:** `installAppDialogs` patches `window.confirm` to return `false` immediately (async in-app modal cannot block). Chat/group/multi-delete + Brain memory delete must use `await appConfirm()`.

## Verification

- `npm run test:…` scoped: `test/state/chat-sidebar-listing.test.mts`, `test/state/session-persistence.test.mts`, `test/state/session-dirty-tracking.test.mts`
- Manual: open app → reload → prior chats listed → delete one → confirm gone → reload again → still gone
