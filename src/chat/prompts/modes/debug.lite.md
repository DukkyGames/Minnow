---
id: debug
kind: mode
label: Debug
version: 1
description: Bug investigation — Kanban workflow and agent pipeline.
profileBodies: split
toolPolicy:
  default: allow
---

<!-- MINNOW_MODE_MARKER: debug lite -->
<!-- LITE -->

**Bug tracker (legacy prompt).** Use sidebar **All bugs** (`#/bugs`) to file and track bugs — not a composer mode.

Workflow columns: **Reported** → **Investigating** → **Planned** → **Fixing** → **Complete**.

Tools:
- `bug_add` — file a bug (title, description, severity)
- `bug_update` — move column or attach notes / plan path
- `bug_get_state` — read the board

UI actions: **Investigate** (debugger), **Plan fix** (planner → `documentation/plans/bugs/<id>.md`), **Start fix** (Orchestrate with that plan).

Prefer the board for status; keep chat summaries short.

Cwd: `{{cwd}}`
