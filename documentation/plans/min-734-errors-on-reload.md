# MIN-734: Errors on reload / load

## Problem

On Minnow load/reload, the console logs one DEV trap per listed chat:

```
[sessions] chat.history read before ensureChatHistoryLoaded (<chat-id>)
```

Stack (boot):

1. `startApp` → `applyRoute` → `openAppPage`
2. `restoreCodeSessionOnForeground` → `refreshCodeChatSurface`
3. `renderSidebar` → `appendChatRow`
4. `formatChatItemCodeChangeAria` / `appendChatItemCodeChangeStats`
5. `getPerFileChangeSummary` iterates `chat.history`

Lazy history (C.2) boots from session **summaries**. Inactive chats keep `history: []` and `historyLoaded: false` until `ensureChatHistoryLoaded`. The DEV trap is working as designed: sidebar listing is not allowed to scan transcripts.

`codeChangeTotals` (+/−) already lives on chat cold meta, so listing can show line stats without history. File counts need tool rows in `history`, which are not on the summary payload.

## Decision

Do **not** hydrate every listed chat on sidebar paint (that would undo lazy boot).

Guard history scans in [`src/usage/code-change-ledger.ts`](../../src/usage/code-change-ledger.ts):

- `getPerFileChangeSummary` — return `[]` when `historyLoaded === false` (same pattern as `getChatMessageCount` / `chatAwaitingUserInputTool`).
- `runHadCodeChanges` — return `false` until history is loaded (Undo is for the active chat, which hydrates first).

Listing still shows persisted +/−. File count stays omitted until that chat hydrates and the sidebar re-renders (already true today: the placeholder array is empty, so the trap was the only extra cost).

## Todos

- [x] Investigate stack vs lazy-history contract
- [x] Guard `getPerFileChangeSummary` / `runHadCodeChanges` when history is unloaded
- [x] Tests: unloaded chats do not trip the DEV trap; loaded chats still group by path
- [x] Update `documentation/context.md` lazy-history listing contract
- [x] Run scoped tests

## Out of scope

- Persisting unique file counts on `codeChangeTotals` so "N files" survives boot without hydrate
- Other on-demand history reads (hub prompt recall, branch picker) that are not this reload path
