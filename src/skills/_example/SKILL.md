---
name: _example
description: >-
  Author template for SpeedChat skills (not shown in the slash picker).
disable-model-invocation: true
---

# Example skill (documentation only)

This folder documents the **SKILL.md** contract. It is **not** invokable via `/` in the composer.

## Folder layout

```text
~/.speedchat/skills/<skill-id>/SKILL.md   # user override
src/skills/<skill-id>/SKILL.md            # built-in (repo)
```

## Required front matter

- `name` — must match the folder name; slash command is `/<name>`
- `description` — one line for the picker and routing hints

## Optional front matter

- `label` — display title in the picker
- `version` — semver badge
- `disable-model-invocation: true` — only apply when user types `/name` (SpeedChat v1 default)

## Merge rules

User skills under `~/.speedchat/skills/` **override** built-ins with the same `name`.

## Body

Write actionable markdown: when to use, steps, and SpeedChat **tool ids** from `definitions.ts`.

See Step 14 for `/impeccable` (UI polish skill).
