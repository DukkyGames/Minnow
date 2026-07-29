# MIN-512 — Orchestrator chat mode

## Problem

Board-managed chats expose the normal composer mode selector. Selecting a composer mode changes
`Chat.modeId` and can also replace the work-agent binding that identifies a builder, tester, or
fixer. The chat then loses the role and board-tool behavior assigned by the orchestrator.

## Success criteria

- Board planner and member chats do not display the composer mode selector.
- Programmatic mode changes cannot replace a board-managed chat's assigned mode or work agent.
- Switching back to a normal chat restores the mode selector.
- Existing non-board mode selection behavior remains unchanged.

## Test plan

- Add a DOM regression test for a tester chat linked to a board task.
- Verify a mode-change attempt returns an explicit error and preserves `modeId` and `workAgentId`.
- Verify planner chats linked to a board also hide the selector.
- Verify a regular chat shows the selector after leaving a board chat.
- Run the focused regression test, board suite, type-check, and production build.
- Manually open a board task chat and verify its composer chrome and role behavior.

## Todos

- [x] Trace board chat creation, role resolution, tool filtering, and composer mode mutation.
- [x] Add regression coverage for board-managed mode selection.
- [x] Hide the mode selector for board-managed chats.
- [x] Reject mode changes for board-managed chats.
- [x] Update the project context.
- [x] Run automated and manual verification.
