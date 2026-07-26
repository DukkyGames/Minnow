# Fix: chat history empty after app restart (lazy history C.2)

**Linear:** [MIN-505](https://linear.app/minnowai/issue/MIN-505/chat-history-empty-after-restart-lazy-history-wipe-paint-race)

## Problem

After restarting Minnow, some chats open with an **empty transcript** even though they had messages before. This is intermittent ("sometimes") because it depends on which chat was active and whether a save ran while other chats were still unloaded.

## Root causes

1. **Message wipe on save (data loss)**  
   Lazy boot loads summaries with `history: []` / `historyLoaded: false`. The first flush after load is a **full PUT** of all chats. Unloaded chats were serialized with empty `history`, and the server `syncMessages` replaced stored rows with `[]`. After that, history was gone forever.

2. **Paint-before-hydrate (UI race)**  
   Several surfaces set `activeId` and call `renderChatFromHistory` / empty-state UI **without awaiting** `ensureChatHistoryLoaded`. Desktop/Chat app treat `history.length === 0` as a permanent empty landing state, so a late hydrate never re-paints.

## Fix

- [x] Client: `chatForSessionsWire` / `sessionStateForSessionsWire` omit `history` when `historyLoaded === false`
- [x] Server: `patchSessionState` / `writeWholeSessionState` skip `syncMessages` when the wire object has no `history` key
- [x] Await history hydrate before paint in `switchChat`, desktop, Chat app, workspace change, experts/email activate paths
- [x] Keep summary `messageCount` on inflated chats; `chatHasListableContent` lists unloaded chats in desktop/Code rails
- [x] Tests: PATCH metadata-only + PUT omit-history preserve messages; client wire omit tests; sidebar listing for unloaded
- [ ] Manual verify: restart → desktop rail shows prior chats; switch → transcript loads; restart again → messages still present

## Todos

- [x] Wire omit + server skip sync
- [x] UI hydrate-before-paint
- [x] Sidebar/rail listing via messageCount
- [x] Focused automated tests
- [ ] Confirm with reporter (active chat vs switch vs wiped forever)
