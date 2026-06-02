# Manual-first Orchestrate Kanban — implementation notes

Implemented in worktree `orchestrate-kanban-05c6213e` (waves A–F).

## Summary

- Concurrent chat streaming (`streamingChatIds`, per-chat abort).
- Sidebar chat groups (`ChatGroup`, `groupId` on chats, schema v5).
- **Folder-linked boards (2026-06):** Kanban state lives on `ChatGroup` (`orchestrateBoard`, `viewMode`, `plannerChatId`); planner chat has `boardGroupId`; `activeBoardGroupId` drives main-column board view. v4→v5 migration moves legacy `chat.orchestrateBoard` onto folders.
- Board tasks carry `agentType`, `chatId`, `buildSpec`, `testSpec`.
- `orchestrate-board-actions.ts` is the shared operation layer for UI (and future tools).
- Supervisor / watchdog / `report_orchestrator_status` removed; orchestrate prompts are parse-only.

## Manual verification

1. Orchestrate chat → select plan → **Build board** → board fills; nothing runs.
2. Assign agent → **Start** → task chat in sidebar group; stream in background.
3. **Stop** cancels run; chat remains.
4. Status buttons move cards; all-complete shows completion once.
5. **Start wave** with >3 planned tasks respects cap and queues.
6. Sidebar: **+ New group**, rename/delete group, collapse.
