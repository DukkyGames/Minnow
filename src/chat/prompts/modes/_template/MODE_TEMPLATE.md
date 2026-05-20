# MODE_TEMPLATE — Minnow operating mode prompt

Use this when authoring a new mode under `src/chat/prompts/modes/`. Production files use split `*.full.md` / `*.lite.md` pairs.

---

## 1. Front matter reference

```yaml
---
id: build                    # ModeId — must match registry
kind: mode                   # Required for loader
label: Build                 # UI label
version: 1
description: One-line summary for docs
profileBodies: split         # split | single
toolPolicy:                  # Mirrors src/chat/modes/registry.ts
  default: allow             # allow | deny | ask (ask → deny at API in v1)
  tools:
    execute_command: deny
---
```

---

## 2. Role

One paragraph persona: what the assistant optimizes for in this mode.

---

## 3. Goals

- Bullet list of outcomes
- What to prioritize vs defer

---

## 4. Tool policy

Document which tools are denied and why. Runtime enforcement: `filterToolsByMode()` in `src/chat/modes/tool-policy.ts` using `getMode(id).toolPolicy`.

| Mode | Typical restriction |
|------|---------------------|
| build | None (user Settings still apply) |
| plan | No shell, file writes, git mutations |
| orchestrate | None (prompt stresses structure) |
| research | Read/search/web only |

---

## 5. Output format

Describe expected markdown structure (headings, checklists, citations).

---

## 6. Anti-patterns

What this mode must **not** do (e.g. Plan: no drive-by refactors).

---

## 7. Interpolation tokens

| Token | Source | Notes |
|-------|--------|-------|
| `{{mode}}` | `ModeId` | e.g. `plan` |
| `{{mode_label}}` | Registry label | e.g. `Plan` |
| `{{cwd}}` | `ComposeContext.cwd` | Origin or project root |
| `{{enabled_tools}}` | Summaries from enabled + mode-filtered tools |
| `{{profile}}` | `full` \| `lite` \| `custom` | Optional in body |

Embed test markers:

```html
<!-- MINNOW_MODE_MARKER: build full -->
```

---

## 8. Lite trimming rules

- Target **≤ 40%** of full body length; hard cap **&lt; 600 characters** body (excluding front matter) for CI.
- No examples in lite; imperative bullets only.
- Include `<!-- LITE -->` and `<!-- MINNOW_MODE_MARKER: {id} lite -->`.

---

## Example full body opener

```markdown
<!-- MINNOW_MODE_MARKER: my-mode full -->

# Operating mode: My Mode ({{mode_label}})

...
```
