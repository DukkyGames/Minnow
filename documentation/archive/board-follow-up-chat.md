# Board follow-up chat: switch, chip, no auto-send

**Status:** Implemented

## Goal

**Start follow-up chat** on the V2 board report leaves Boards, opens a new General Code chat with a file-style board-title chip (full board context attached, not pretyped), and waits for the user to type and send.

## Todos

- [x] Rewrite `startFollowUp`: snapshot context, `closeBoardsView({ restoreChat: false })`, `createChatWithMode({ modeId: 'general' })` with no seed, focus composer
- [x] Push a text attachment labeled with the board title; body is full board context; injects via existing `fileContentBlock` on send
- [x] Cover no auto-send, close/navigate, chip payload (title + tasks + report, no review prompt)
- [x] Update `documentation/context.md` and this plan

## Agreed context

- Land in **Code → Chat**, new conversation selected.
- Composer mode: **General**.
- Chip looks like a file attachment; **label is the board title**. Full board payload is behind the chip and is **injected on send** through the existing text-attachment path (`<file name="…">` in [`buildHistoryUserContent`](../../src/chat/build-api-messages.ts)). Composer text stays empty; **do not auto-send**.

## Why it failed

[`startFollowUp`](../../src/orchestrator/board-report.ts) previously called `createChatWithMode({ modeId: 'general', initialUserMessage: seed })`.

That path:

1. **Auto-sent** — `initialUserMessage` is pushed into history and [`kickoffSeededChatTurn`](../../src/ui/sidebar.ts) starts the turn.
2. **Left the user on Boards** — `createChatWithMode` only runs [`exitBoardViewForNavigation`](../../src/ui/exit-board-view.ts) (leftover V1 board folder). The live surface is V2 [`boards-view.ts`](../../src/orchestrator/boards-view.ts) at `#/app/code/boards`. Composer and sidebar stay display-suppressed until [`closeBoardsView`](../../src/orchestrator/boards-view.ts) tears down `#orchestratorBoardsRoot` and stamps `#/app/code/chat`.

## Implementation

1. Snapshot title + context from `BoardState` + report markdown **before** teardown (`buildBoardFollowUpContext`).
2. `await closeBoardsView({ restoreChat: false })` so the overlay is gone and the hash is `#/app/code/chat` without painting the previous chat. Dynamic import avoids a cycle (`boards-view` already imports `board-report`).
3. `createChatWithMode({ modeId: 'general' })` — omit `initialUserMessage`.
4. `attachBoardFollowUpChip` (`kind: 'text'`, `name` = board title) then focus `#msgInput`.

Payload keeps board id/name, plan path, integration branch, run summary, **all tasks with phase**, and the end-of-run report (4000-char cap). It does **not** include the old “Help me review…” auto-prompt.

## Out of scope

- Changing git-error / PR-review / issues **Send to chat** (those still auto-run by design).
- A new attachment kind or chip CSS.
- Opening the chat as a board-rail embed.
