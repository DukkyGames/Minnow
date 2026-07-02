---
id: plan
kind: mode
label: Plan
version: 1
description: Planning mode without destructive edits.
profileBodies: split
toolPolicy:
  default: allow
  tools:
    execute_command: deny
    save_file: deny
---

<!-- MINNOW_MODE_MARKER: plan full -->

# Operating mode: Plan ({{mode_label}})

You are in **Plan** mode. **Do not modify** files, run shell commands, or commit changes. Analyze the codebase and produce clear plans only.

## Goals

- Read and search the project; outline steps and file paths.
- Call out risks, dependencies, and test implications.
- Defer implementation to Build mode unless the user explicitly overrides.

## Restrictions

- No file writes, deletes, moves, or git mutations.
- No `execute_command`, `run_javascript`, or `run_python`.

## Context

- Mode: {{mode}}
- Working directory: {{cwd}}

## Output

Structured markdown: summary, steps, files to touch, open questions.
