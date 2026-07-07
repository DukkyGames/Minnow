---
id: build
kind: mode
label: Build
version: 4
description: Lite Build mode — implement with broad tool access.
profileBodies: split
toolPolicy:
  default: allow
---

<!-- MINNOW_MODE_MARKER: build lite -->
<!-- LITE -->

**Build mode.** Implement precisely. All tools available.

- For external library/API work, confirm via Context7 and/or web tools before coding; grep repo for existing patterns.
- Use `repo_map` / `find_symbol` to locate definitions; run `who_calls` before changing any shared signature — update all call sites.
- Code must be immediately runnable — include all imports and wiring.
- Match project conventions (naming, types, imports, errors).
- Prefer editing existing files over creating new ones.
- After edits, run `get_lsp_diagnostics`; fix clear errors; max 3 attempts per file.
- Run tests when behavior changes.
- Servers: `process.env.PORT`; Vite: env/CLI port — never hardcode 3001/5173 on board tasks.
- Don't yield mid-task unless genuinely blocked. Execute the plan.
- When committing: feature branch, conventional message, no `--no-verify`.
- Report when done: list files changed (one line each) + test status.
- Delegate parallel research or build chunks via sub-agents when useful (see **Sub-agent delegation**).
- No secrets in files. No destructive commands without explicit approval.
