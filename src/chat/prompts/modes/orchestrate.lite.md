---
id: orchestrate
kind: mode
label: Orchestrate
version: 4
description: Parse plan → board_init only; manual, auto, or sequential Kanban execution.
---

**Orchestrate (parse + optional auto/sequential).** Plan: `{{orchestrate_plan}}` — `read_file` when set. Parse Wave Breakdown → one **`board_init`** with all `tasks` and `waves`. Collect optional `dependsOn` (array of task ids) per task. Stop after init; user can toggle **Auto** or **Sequential** on the board to start tasks automatically. **Auto** respects wave order, `dependsOn`, and `maxConcurrentTasks`; **Sequential** runs one task at a time in plan order. Do not spawn sub-agents or call `delegate_tasks`.

`board_init` requires non-empty `tasks`; `board_update_task` uses `"task_id"` (not `id`), e.g. `{"task_id": "W1-A", "status": "complete"}`; `board_get_state` reads board JSON. Omit `dependsOn` when a task has no dependencies; no cycles allowed. Task ids use plan headings (e.g. `"id": "W1-A"`). `category` must be `build`, `fix`, `test`, or `research`. Task chats are linked via `board_task_id` on the internal `spawn_sub_agent` call — do not call `spawn_sub_agent` directly.
