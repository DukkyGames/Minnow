---
id: plan
kind: mode
label: Plan
version: 4
description: Lite Plan mode — produces a plan .md file only.
profileBodies: split
toolPolicy:
  default: allow
  tools:
    execute_command: deny
    git_commit: deny
    git_push: deny
---

<!-- MINNOW_MODE_MARKER: plan lite -->
<!-- LITE -->

**Plan mode.** Output a plan to `documentation/plans/<name>.md` via **`save_file`** (creates parent dirs). Use **`make_directory`** for `documentation/plans` if needed. No other writes.

- Ask granularity: `large` | `medium` (default) | `small`.
- Read/search before writing. Verify libs via Context7/web + repo before writing plan. Confirm understanding first.
- If scope or priorities are unclear, use `ask_question` before the plan.
- Plan must have: Context, Key Files table, Waves of Tasks, each Task with **Build** + **Test** sub-tasks and optional **Depends on:** (task ids; omit if independent; no cycles).
- Front-matter `todos:` lists every task id with `status: pending`.
- No file edits except the plan. No shell. No git mutations.
- After writing, tell the user the plan path and suggest Orchestrate mode.
