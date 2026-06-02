---
id: orchestrate
kind: mode
label: Orchestrate
version: 3
description: Parse plan → board_init only; manual Kanban execution.
---

**Orchestrate (parse-only).** Plan: `{{orchestrate_plan}}` — `read_file` when set. Parse Wave Breakdown → one **`board_init`** with all `tasks` (id, title, wave, category, optional build/test/agent_type) and `waves`. Confirm task count, then **stop**. Do not spawn sub-agents or execute tasks. User runs the manual board.
