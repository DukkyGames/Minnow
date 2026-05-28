---
name: ui-designer
description: Impeccable-guided UI audit, screenshot capture, plan or implement Minnow surfaces.
label: UI Designer
user-invocable: true
argument-hint: "[plan|implement] [target description]"
---

# UI Designer (Minnow)

Specialized orchestrator for **Impeccable** design work on Minnow UI. Requires the built-in `/impeccable` skill (Step 14). Uses CDP `browser_screenshot` when Chrome remote debugging is available (Step 12).

**Related:** `/impeccable` — general Impeccable commands; this skill runs a fixed workflow.

## Modes

Reply with **`plan`** (default) or **`implement`** after `/ui-designer`:

| Mode | Behavior |
|------|----------|
| **plan** | Audit, shape brief, markdown plan only — **no** file writes (`mutation=closed`) |
| **implement** | After shape confirmation — edit UI paths via `impeccable craft` / `polish` |

## Workflow

1. **Preflight** — `load_impeccable_context` (PRODUCT.md, DESIGN.md, optional `.impeccable/design.json`). Context passes when `hasProduct` / `hasDesign` are true; if `hasDesignJson` is false, note `designJsonSetupHint` and run `/impeccable document` before token-critical edits. Fail fast if PRODUCT.md is placeholder; suggest `/impeccable teach` (harness).
2. **Observe** — `browser_navigate` → `http://127.0.0.1:<PORT>` (Minnow dev server); `browser_screenshot` for visual evidence (vision model required).
3. **Audit** — `/impeccable audit` (harness): load `reference/audit.md` after `load_impeccable_context`; apply to `#app` or target CSS/HTML. Do not use `run_impeccable` for audit.
4. **Shape** — `/impeccable shape` (harness): follow injected `reference/shape.md`; confirm brief with user. Do not use `run_impeccable` for shape. **`/impeccable craft`** auto-injects both `craft.md` and `shape.md`; run the shape interview in chat before coding.
5. **Plan or implement** — Plan: output under `documentation/plans/` only. Implement: edit `index.html`, `src/styles/**`, `src/ui/**`.
6. **Verify** — Re-screenshot; summarize visual delta in chat.

Emit once per turn before edits:

```text
IMPECCABLE_PREFLIGHT: context=pass product=pass command_reference=pass shape=pass|not_required image_gate=pass|skipped:<reason> mutation=open|closed
```

## Minnow targets

- Shell: `index.html`, `src/styles/*.css`, `src/ui/**`
- Context: `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json`, `src/styles/tokens.css`

## Tools (allowlist)

- Browser: `browser_list`, `browser_navigate`, `browser_snapshot`, `browser_screenshot`, `browser_click`, `browser_fill` (implement mode)
- Files: `read_file`, `read_file_range`, `search_in_file`, `replace_text_in_file`, `save_file`, `list_directory`
- Impeccable: `load_impeccable_context`, harness `/impeccable` (audit, shape, craft, polish); `run_impeccable` only for `detect` or `live` if needed

Excluded: git, `execute_command`, `web_search`, sub-agents.

## Model

Dedicated binding: `~/.minnow/config.json` → `uiDesigner.providerId` + `uiDesigner.modelId`. Screenshots need a **vision-capable** model.
