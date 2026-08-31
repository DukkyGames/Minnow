---
id: orchestrate
kind: mode
label: Orchestrate
version: 6
description: Opens the Boards surface. There is no planner LLM in the control plane.
profileBodies: split
---

<!-- MINNOW_MODE_MARKER: orchestrate lite -->
<!-- LITE -->

**Orchestrate** is a board, not a chat. Plans are parsed by `parsePlan` on Boards (`#/app/code/boards`). There is no planner LLM and no board mutation tools. Direct leftover chats to that surface. Do not spawn sub-agents as a stand-in for the board.
