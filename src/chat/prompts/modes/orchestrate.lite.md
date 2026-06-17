---
id: orchestrate
kind: mode
label: Orchestrate
version: 3
description: Parse plan → board_init only; manual Kanban execution.
---

**Orchestrate (parse + optional auto-pilot).** Plan: `{{orchestrate_plan}}` — `read_file` when set. Parse Wave Breakdown → one **`board_init`** with all `tasks` and `waves`. Stop after init; user can toggle **Auto-pilot** on the board to start tasks automatically. Do not spawn sub-agents or call `delegate_tasks`.
