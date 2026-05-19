---
name: ui-designer
description: Impeccable-guided UI audit, screenshot capture, plan or implement SpeedChat surfaces.
label: UI Designer
user-invocable: true
argument-hint: "[plan|implement] [target description]"
---

# UI Designer (SpeedChat)

Specialized orchestrator for **Impeccable** design work on SpeedChat UI. Requires the built-in `/impeccable` skill (Step 14). Uses CDP `browser_screenshot` when Chrome remote debugging is available (Step 12).

**Related:** `/impeccable` — general Impeccable commands; this skill runs a fixed workflow.

## Modes

Reply with **`plan`** (default) or **`implement`** after `/ui-designer`:

| Mode | Behavior |
|------|----------|
| **plan** | Audit, shape brief, markdown plan only — **no** file writes (`mutation=closed`) |
| **implement** | After shape confirmation — edit UI paths via `impeccable craft` / `polish` |

## Workflow

1. **Preflight** — `node src/skills/impeccable/scripts/speedchat-context.mjs` (PRODUCT.md, DESIGN.md, `.impeccable/design.json`). Fail fast if PRODUCT.md is placeholder; suggest `npx impeccable teach`.
2. **Observe** — `browser_navigate` → `http://127.0.0.1:<PORT>` (SpeedChat dev server); `browser_screenshot` for visual evidence (vision model required).
3. **Audit** — `run_impeccable` with `command: audit` on `#app` or target CSS/HTML.
4. **Shape** — `run_impeccable` with `command: shape`; confirm brief with user.
5. **Plan or implement** — Plan: output under `documentation/plans/` only. Implement: edit `index.html`, `src/styles/**`, `src/ui/**`.
6. **Verify** — Re-screenshot; summarize visual delta in chat.

Emit once per turn before edits:

```text
IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=pass shape=pass|not_required image_gate=pass|skipped:<reason> mutation=open|closed
```

## SpeedChat targets

- Shell: `index.html`, `src/styles/*.css`, `src/ui/**`
- Context: `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `src/styles/tokens.css`

## Tools (allowlist)

- Browser: `browser_list`, `browser_navigate`, `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_fill` (implement mode)
- Files: `read_file`, `read_file_range`, `search_in_file`, `replace_text_in_file`, `save_file`, `list_directory`
- Impeccable: `run_impeccable`

Excluded: git, `execute_command`, `web_search`, sub-agents.

## Model

Dedicated binding: `~/.speedchat/config.json` → `uiDesigner.providerId` + `uiDesigner.modelId`. Screenshots need a **vision-capable** model.
