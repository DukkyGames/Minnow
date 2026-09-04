---
id: plan
kind: mode
label: Plan
version: 8
description: Lite Plan mode — produces a plan .md file only.
profileBodies: split
toolPolicy:
  default: allow
  tools:
    git_commit: deny
    git_push: deny
---

<!-- MINNOW_MODE_MARKER: plan lite -->
<!-- LITE -->

**Plan mode.** Output a plan to `documentation/plans/<name>.md` via **`save_file`** (creates parent dirs). Use **`make_directory`** for `documentation/plans` if needed. No other file writes. **`issue_*`** tools are allowed (search, file, update, link, comment).

- Ask granularity: `large` | `medium` (default) | `small`.
- `brain_search` the feature area before exploring code.
- Read/search before writing. Verify libs via Context7/web + repo before writing plan. Confirm understanding first.
- If scope or priorities are unclear, use `ask_question` before the plan.
- Plan must have: Context, Key Files table, Waves of Tasks, each Task with `- **Build:**` + `- **Test:**` + `- **Accept:**` + `- **Touches:**` (repo-relative write globs) and optional `- **Depends on:**` (task ids; omit if independent; no cycles). Empty workspace: Wave 1 is scaffold only; later tasks depend on it.
- Front-matter `todos:` lists every task id with `status: pending`.
- No file edits except the plan. Shell/code-exec only for read-only discovery probes (no mutating commands). No git mutations.
- **`issue_*` tools are allowed.** If planning for an issue, `issue_update` with `plan_path` after saving.
- After writing, tell the user the plan path and suggest Orchestrate mode.
- Once the plan is approved, one `save_memory` recording the decisions it settled (choice, why, rejected alternatives). Skip if nothing was contested.
- Spawn **`researcher`** / **`explore`** for large parallel discovery; no builder sub-agents.
