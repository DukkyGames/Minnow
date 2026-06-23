---
id: orchestrate
kind: mode
label: Orchestrate
version: 4
description: Parse plan → board_init only; manual, auto, or sequential Kanban execution.
---

**Orchestrate (parse + optional auto/sequential).** Plan: `{{orchestrate_plan}}` — `read_file` when set. Parse Wave Breakdown → one **`board_init`** with all `tasks` and `waves`. Collect **`dependsOn`** (array of upstream task ids) per task — explicit DAG edges enable parallel branches; waves are fallback when deps are omitted. Stop after init; user toggles **Auto** or **Sequential** on the board. **Auto** respects `dependsOn` first, then wave barriers, and `maxConcurrentTasks`. Do not spawn sub-agents, run git, or call `delegate_tasks`. The board auto-commits and merges on tester pass; do not mark tasks `complete` via `board_update_task`.

`board_init` requires non-empty `tasks`; `board_update_task` uses `"task_id"` (not `id`), e.g. `{"task_id": "W1-A", "status": "complete"}`; `board_get_state` reads board JSON. Omit `dependsOn` when a task has no dependencies; no cycles allowed. Task ids use plan headings (e.g. `"id": "W1-A"`). `category` must be `build`, `fix`, `test`, or `research`. Task chats are linked via `board_task_id` on the internal `spawn_sub_agent` call — do not call `spawn_sub_agent` directly.
