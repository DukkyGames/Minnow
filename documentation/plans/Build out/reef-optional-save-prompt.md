# Optional save prompt for Reef modules

**Summary:** After the agent builds a custom Reef widget, ask the user whether to persist it under `~/.minnow/reef/modules` before writing any file.

**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) — line 3

**Depends on:** [`reef-files-minnow-home.md`](reef-files-minnow-home.md) (home module paths + write allowlist)

---

## Problem statement

Reef widgets are normally ephemeral `reef-widget` fences in chat. When the model “saves” a widget, it may write into the workspace without consent. Users want an explicit choice: keep the widget in the conversation only, or save a reusable module to Minnow home.

---

## Current behavior

| Area | Behavior | Key paths |
|------|----------|-----------|
| Live widgets | Mounted from assistant markdown; no save step | `src/chat/reef/widget-block-detector.ts`, `src/markdown/renderer.ts` |
| Templates | Read from `@minnow/reef/widgets/` | `server/reef/widget-paths.js` |
| Structured user input | `ask_question` tool → bottom card UI | `src/tools/definitions.ts`, `src/ui/question-cards-modal.ts` |
| Persistence | No first-class “save reef module” flow | — |
| Prompts | Reef mode does not instruct “confirm before write” for custom modules | `src/chat/prompts/modes/reef.full.md` |

---

## Proposed solution

### 1. Product flow

1. Agent emits a complete `reef-widget` fence in chat (user sees interactive UI).
2. If the agent believes the widget is worth reusing, it calls **`ask_question`** (or a dedicated tool) with:
   - Prompt: “Save this widget as a reusable module?”
   - Options: `Yes, save to my Minnow library` / `No, keep only in this chat` / `Other`
3. On **Yes**:
   - Agent writes `~/.minnow/reef/modules/<slug>.md` via `@minnow/reef/modules/…` (see home modules plan).
   - Slug from user label or derived from widget title (sanitized).
4. On **No**:
   - No `write_file`; widget remains only in message history.

### 2. Prompt contract (Reef + tool-usage)

Add to `reef.full.md` / `reef.lite.md`:

- **Never** `write_file` a reef module without user confirmation via `ask_question`.
- After first successful widget for a user request, offer save when the widget is non-trivial (heuristic in prompt: dashboards, multi-control tools, reused templates).
- Use path `@minnow/reef/modules/<slug>.md` only after confirmation.

### 3. Optional dedicated tool (v2)

`save_reef_module` — params: `slug`, `markdown_body`; server writes only under home modules; returns path. Internally still could call `ask_question` first from prompt discipline only in v1.

### 4. UI affordance (optional)

- Message action on assistant bubbles containing mounted reef host: “Save to library…” → triggers same `ask_question` preset or opens slug input modal.

---

## Implementation todos

- [ ] Complete home modules path + write policy ([`reef-files-minnow-home.md`](reef-files-minnow-home.md))
- [ ] Add Reef prompt section: confirm-before-save + `ask_question` example
- [ ] Add `ask_question` preset examples in `src/skills/ask-user/SKILL.md` or reef prompt appendix
- [ ] (Optional) `save_reef_module` tool definition + server handler
- [ ] (Optional) Bubble action in `src/ui/message-actions.ts` for reef hosts
- [ ] Test: mock `ask_question` → write only on affirmative answer (prompt test or integration)
- [ ] Update `documentation/context.md` Reef workflow

---

## Files to change

| File | Change |
|------|--------|
| `src/chat/prompts/modes/reef.full.md` | Save confirmation rules |
| `src/chat/prompts/modes/reef.lite.md` | Lite rules |
| `src/chat/prompts/tool-usage/default.full.md` | Cross-link ask_question + reef save |
| `server/reef/*` | Module write (from home plan) |
| `src/tools/definitions.ts` | Optional `save_reef_module` |
| `src/ui/message-actions.ts` | Optional bubble action |
| `test/chat/reef/*` | Prompt convention test for “must ask before save” |

---

## Testing plan

1. Reef mode: agent creates widget, asks save question — user picks No — no file under `~/.minnow/reef/modules`.
2. User picks Yes — file created at `@minnow/reef/modules/<slug>.md`, readable via `read_file`.
3. Regression: inline widgets still mount without save.
4. `ask_question` disabled in settings — agent must not loop; prompt says skip save offer or use prose consent.

---

## Risks / open questions

- **Who asks?** Parent agent only, or sub-agent spawned for widget build (see mode-switch plan)?
- **Overwrite:** If slug exists, second `ask_question` for replace?
- **PII:** Modules may contain user data — warn in save prompt?
- **Without `npm start`:** Offline client cannot write home — degrade gracefully?
