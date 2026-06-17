---
id: orchestrate
kind: mode
label: Orchestrate
version: 3
description: Parse plan → board_init only; manual Kanban execution.
---

**Orchestrate (parse + optional auto-pilot).** Plan: `{{orchestrate_plan}}` — `read_file` when set. Parse Wave Breakdown → one **`board_init`** with all `tasks` and `waves`. With **Auto-pilot** on, call **`delegate_tasks`** for ready planned tasks; otherwise stop after init. User can toggle Auto-pilot on the board. Do not spawn sub-agents.
