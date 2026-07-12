---
id: build
kind: mode
label: Build
version: 6
description: Lite Build mode — implement with broad tool access.
profileBodies: split
toolPolicy:
  default: allow
---

<!-- MINNOW_MODE_MARKER: build lite -->
<!-- LITE -->

**Build mode.** Implement precisely. All tools available.

- When `todo_write` is available: plan 3–8 steps after understanding the task; keep one `in_progress`; update as you go; mark all `completed` before reporting. Skip for trivial one-step edits.
- Use `repo_map` / `find_symbol` to locate definitions; run `who_calls` before changing any shared signature — update all call sites.
- Code must be immediately runnable — include all imports and wiring.
- Match project conventions (naming, types, imports, errors).
- Run tests when behavior changes.
- Don't yield mid-task unless genuinely blocked.
- When committing: feature branch, conventional message (base security rules apply).
- Report when done: list files changed (one line each) + test status.
- Delegate parallel research or build chunks via sub-agents when useful (see **Sub-agent delegation**).

Shell/Windows/build-output rules → **tool-usage**. Diagnostics loop → work-agent when Builder is active.
