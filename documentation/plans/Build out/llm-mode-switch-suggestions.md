# LLM mode-switch and Reef handoff suggestions

**Summary:** Let the model offer structured mode switches (Plan → Orchestrate, Build ↔ Plan, Reef interactive widget) via `ask_question`, with optional sub-agent handoff for Reef widget authoring.

**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) — line 6

---

## Problem statement

Mode prompts already **suggest** switching in prose (e.g. Plan → Orchestrate in `plan.full.md`), but the model cannot reliably offer **one-click** choices or spawn a Reef specialist. Users want:

- After planning: offer new Orchestrate chat to execute the plan.
- Build vs Plan mismatches: offer mode change when the task type does not match the active mode.
- Informational answers: offer Reef interactive visualization; on acceptance, sub-agent builds widget, parent displays it.

---

## Current behavior

| Capability | Status | Key paths |
|------------|--------|-----------|
| Mode segments | Five modes including `reef`, `orchestrate` | `src/chat/modes/registry.ts`, `src/ui/mode-selector.ts` |
| Prose suggestions | Plan/Orchestrate/Build cross-refs in mode prompts | `src/chat/prompts/modes/plan.full.md`, `research.full.md`, etc. |
| Structured user questions | `ask_question` tool + bottom cards | `src/tools/definitions.ts`, `src/ui/question-cards-modal.ts` |
| Sub-agents | `spawn_sub_agent` (Orchestrate board tasks) | `src/tools/sub-agent-executor.ts`, `src/agents/orchestrator.ts` |
| Reef widgets | Inline fences + bridge; templates `@minnow/reef/widgets/` | `src/chat/reef/*`, `documentation/plans/reef-mode-agent-handoff.md` |
| New chat for mode | User manually creates chat + changes mode | `src/ui/sidebar.ts` `createChat`, `mode-selector.ts` |
| Programmatic mode switch | No tool for “switch active chat mode” or “fork orchestrate chat” | — |

---

## Proposed solution

### 1. Prompt layer (all modes)

Add a shared snippet `src/chat/prompts/tool-usage/mode-handoff.md` (or section in `default.full.md`):

| Situation | Action |
|-----------|--------|
| Plan doc written | `ask_question`: “Start execution in Orchestrate?” → options: New Orchestrate chat / Stay in Plan / Other |
| User asks to implement in Plan/Research | Offer Build mode |
| User asks to plan in Build | Offer Plan mode |
| Explainer / data / UI-friendly topic | Offer “Show as Reef widget” (only if not already Reef) |

Rules:

- Use **`ask_question`** with 2–4 preset options; never only prose for mutually exclusive choices.
- Do not auto-change `modeId` without user selection.
- After user picks Orchestrate: instruct user to create/select chat **or** provide a host action (see 3).

### 2. Reef widget handoff flow

When user accepts Reef visualization **outside Reef mode**:

1. Parent agent calls **`spawn_sub_agent`** with category `reef` (new sub-agent type) or reuses Builder with reef-only prompt — **preferred:** dedicated `reef-widget` sub-agent profile in `sub-agents.json` / `src/agents/prompts/sub-agents/reef-builder.md`.
2. Sub-agent task: produce one complete `reef-widget` fence (read templates from `@minnow/reef/widgets/`).
3. Parent receives sub-agent summary + fenced HTML via `get_sub_agent_status` / transcript injection.
4. Parent posts assistant message containing the fence (Reef mode **not** required for fence to render as code; mounting requires active chat `modeId === 'reef'` per `widget-block-detector.ts`).

**Product decision required:** Auto-switch active chat to Reef for mount, or mount in Build with “Preview as Reef” host flag.

**Recommended v1:** On user “Yes” to Reef, set `chat.modeId = 'reef'` via new client tool `set_chat_mode` (browser) or show UI banner “Switch to Reef to interact” with button calling existing `mode-selector` API.

### 3. Client tools / UI for mode fork

**Option A — Tools only (smaller):**

- `ask_question` outcomes documented in prompts; user manually switches mode and new chat.

**Option B — Host tools (better UX):**

| Tool | Behavior |
|------|----------|
| `propose_mode_switch` | Wraps `ask_question` with standard option sets per `targetMode` |
| `create_chat_with_mode` | Browser: `createChat()` + set `modeId` + optional copy plan path into `orchestratePlanPath` |

Implement in `src/tools/browser-executor.ts` or `definitions.ts` client handlers.

### 4. Orchestrate “new chat” handoff

When user chooses “New Orchestrate chat”:

- `create_chat_with_mode({ modeId: 'orchestrate', planPath })` 
- Pre-fill first user message template: “Execute plan at `<path>`”

Wire `orchestratePlanPath` on new chat (`src/types.ts`, `sessions.ts`).

---

## Implementation todos

- [ ] Author `mode-handoff.md` prompt fragment; include in `composeSystemPrompt` for Plan, Build, Research, Orchestrate, Reef
- [ ] Add sub-agent type `reef-widget` (prompt + `sub-agents.json` + allow tools: read templates, no workspace writes)
- [ ] Document spawn pattern in `reef.full.md` and `plan.full.md`
- [ ] Decide mount policy; implement `set_chat_mode` browser tool OR mode banner component
- [ ] (Option B) `create_chat_with_mode` + `propose_mode_switch` tools
- [ ] Extend `ask_question` presets in `ask-user` skill examples
- [ ] Tests: prompt contains handoff rules; sub-agent spawn mock; mode set on user YES
- [ ] Update `documentation/context.md` operating modes

---

## Files to change

| File | Change |
|------|--------|
| `src/chat/prompts/tool-usage/mode-handoff.md` | New shared rules |
| `src/chat/prompts/modes/plan.full.md` | Reference ask_question handoff |
| `src/chat/prompts/modes/build.full.md` | Build ↔ Plan |
| `src/chat/prompts/modes/reef.full.md` | Sub-agent + parent display |
| `src/agents/prompts/sub-agents/reef-widget.*.md` | Sub-agent prompts |
| `src/tools/definitions.ts` | Optional new tools |
| `src/tools/client.ts` / `browser-executor.ts` | Handlers |
| `src/ui/mode-selector.ts` | Callable from tool |
| `src/ui/sidebar.ts` | `create_chat_with_mode` |
| `src/types.ts` | Chat creation payload |
| `test/prompts/mode-handoff-prompt.test.mjs` | Static prompt tests |

---

## Testing plan

1. Plan mode: complete plan → model calls `ask_question` with Orchestrate option (manual or scripted eval).
2. User selects Reef widget → sub-agent runs → parent message contains `reef-widget` fence.
3. Active mode Reef → widget mounts in bubble.
4. User selects Orchestrate new chat → new chat has `modeId orchestrate` + plan path set.
5. Regression: `ask_question` queue still serial; no duplicate spawns.

---

## Risks / open questions

- **Sub-agent cost:** Extra model call per widget — cap with user consent only.
- **Non-Reef mount:** Detector gates on `modeId === 'reef'` — must switch mode or relax gate.
- **Orchestrate board:** Separate from chat handoff — clarify in prompt.
- **Eval:** Hard to unit-test LLM compliance — combine prompt tests + manual QA checklist.
