# Feature 31 — Ask Question cards (structured user Q&A)

**Backlog ID:** G1 · `feature-31-ask-question-cards`  
**Wave:** 8 (Agent UX)  
**Size:** L  
**Status:** Shipped  
**Reference UI:** Cursor-style question strip (category label, prompt, radio options with title + description, carousel, submit on last card, Esc cancel)

---

## 1. Problem

When the model needs clarification, it today either:

- Asks in free-form prose (easy to miss, no structured choices), or
- Invents answers and continues (violates tool-usage rules).

Cursor exposes an **`AskQuestion`** tool that blocks the turn until the user picks options. Minnow has no equivalent: no tool, no UI host, no prompt guidance, and no skill for *when* to use structured questions.

**Goal:** When the LLM has one or more questions, show a **bottom strip** (same real estate as tool approval), **one question per card**, prev/next arrows, and return answers as structured JSON to resume the tool loop.

---

## 2. Goals and non-goals

### In scope

| Area | Deliverable |
|------|-------------|
| **Tool** | Browser-native `ask_question` in catalog + executor |
| **UI** | `#questionHost` strip, card carousel, submit, Esc/dismiss |
| **Loop** | Block `executeTool` until submit or cancel; serialize concurrent asks |
| **Prompts** | `tool-usage` + Plan/Research mode hints |
| **Skill** | Built-in `feature-context-gathering` (or `ask-user`) guiding structured asks |
| **Settings** | Tool row in utility category; default **full** permission (no double approval) |
| **Tests** | Schema validation, queue, UI state machine (unit); optional smoke |

### Out of scope (post-v1)

- Persisting partial answers across page reload mid-question
- Server-side `/api/questions` (browser-only tool)
- Embedding question cards **inside** the message list (strip only, like approval)
- MCP-exposed AskQuestion proxy

---

## 3. UX specification (match screenshot)

### 3.1 Placement

Mirror tool approval in [`index.html`](../../index.html):

```html
<!-- After #chatArea, before #toolApprovalHost (or stacked below approval when both exist) -->
<div id="questionHost" class="question-host" aria-live="polite" hidden></div>
<div id="toolApprovalHost" class="tool-approval-host" …></div>
```

**Stack order (bottom → top):** composer → `questionHost` → `toolApprovalHost` → chat. If both hosts can be visible, define z-index / max-height so combined height ≤ ~50vh.

### 3.2 While open

Reuse approval pattern from [`tool-approval-modal.ts`](../../src/ui/tool-approval-modal.ts):

- `#mainColumn` class e.g. `main-column--question-pending`
- Hide `.input-bar` (composer) via CSS (same as `main-column--tool-approval-pending`)
- Disable `#msgInput` / `#sendBtn` until resolved
- **Do not** stop streaming indicator elsewhere; only block send

### 3.3 Single card layout

| Region | Content |
|--------|---------|
| **Header** | Optional `title` (category, e.g. “Theme system”) + close **X** (same as cancel) |
| **Prompt** | `question.prompt` — prominent, 1–2 lines |
| **Options** | List of selectable rows: **bold label** + muted description (screenshot style) |
| **Selection** | Radio (single) or checkbox group (`allow_multiple`) |
| **Footer** | Primary **Submit answers** (disabled until required selections made); hint `Esc to cancel` |

### 3.4 Carousel (multiple questions)

When `questions.length > 1`:

- Show **one card** at a time
- **Prev / Next** icon buttons in header or footer; disable at ends
- Dots or `2 / 5` index indicator
- **Submit** only on last card OR always visible but validates **all** questions answered (recommended: submit on last card only; prev/next preserve draft selections in memory)

### 3.5 Keyboard

| Key | Action |
|-----|--------|
| `Esc` | Cancel → tool result `cancelled` |
| `←` / `→` | Prev / next card (when not in textarea) |
| `1`–`9` | Optional: select option index on current card (mirror approval digit shortcuts) |
| `Enter` | Submit when valid (on last card or global submit) |

### 3.6 Visual design

New [`src/styles/question-cards.css`](../../src/styles/question-cards.css) — tokens from [`tokens.css`](../../src/styles/tokens.css):

- Sheet background `var(--surface)`, hairline `var(--border)`
- Selected option: subtle `var(--bg-elevated)` fill (screenshot hover state)
- Category underline accent `var(--accent)` (thin line under title)
- No full-screen scrim; flat strip like [`tool-approval.css`](../../src/styles/tool-approval.css)

Import in [`main.ts`](../../src/main.ts).

---

## 4. Tool contract

### 4.1 Name and routing

- **Function name:** `ask_question`
- **Category:** `utility`
- **serverRequired:** `false` → [`executeBrowserTool`](../../src/tools/browser-executor.ts) delegates to UI promise (not inline logic in executor switch)

### 4.2 JSON schema (OpenAI function parameters)

```ts
// ask-question-types.ts — shared types
interface AskQuestionOption {
  id: string;       // stable id returned in results
  label: string;    // short title (bold in UI)
  description?: string;
}

interface AskQuestionItem {
  id: string;       // stable question id
  prompt: string;
  options: AskQuestionOption[];  // min 2
  allow_multiple?: boolean;        // default false
}

interface AskQuestionArgs {
  title?: string;                 // strip header / category
  questions: AskQuestionItem[]; // min 1, max 10 (cap in validator)
}
```

### 4.3 Tool result (string content for `role: tool`)

Return **JSON string** (model parses easily):

```json
{
  "status": "answered",
  "answers": {
    "q1": ["opt-a"],
    "q2": ["opt-x", "opt-y"]
  }
}
```

Cancel / dismiss:

```json
{ "status": "cancelled", "answers": {} }
```

Validation errors (bad args from model):

```json
{ "status": "error", "message": "questions[0] requires at least 2 options" }
```

### 4.4 Executor flow

```
executeTool('ask_question', args)
  → validateAskQuestionArgs(args)
  → enqueueAskQuestion(request)   // like approval-queue.ts
  → showQuestionCardsModal(request)
  → Promise<AskQuestionResult>
  → JSON.stringify(result) as tool content
```

**Permission gate:** Skip `maybeBlockToolForUserApproval` for `ask_question` (the strip *is* user interaction). Default in `tools.json` / seed: **`full`**.

**Enabled by default:** `true` (user can turn off in Settings / composer tools).

### 4.5 Interaction with streaming

When `ask_question` runs mid–tool-loop:

- Assistant bubble may still show “using tools…”
- User must complete or cancel questions before loop continues
- **Stop** button: should cancel pending question UI and abort turn (wire through existing stop / `chatFetchAbort` — same as denying a tool)

---

## 5. Architecture

```mermaid
sequenceDiagram
  participant LLM
  participant Loop as tools/loop.ts
  participant Client as tools/client.ts
  participant Queue as ask-question-queue.ts
  participant UI as question-cards-modal.ts

  LLM->>Loop: tool_calls ask_question
  Loop->>Client: executeTool
  Client->>Queue: enqueueAskQuestion
  Queue->>UI: showQuestionCardsModal
  UI-->>User: carousel cards
  User->>UI: Submit / Esc
  UI-->>Queue: resolved
  Queue-->>Client: JSON result
  Client-->>Loop: tool message
  Loop->>LLM: next completion
```

### 5.1 New modules

| File | Responsibility |
|------|----------------|
| [`src/tools/ask-question-types.ts`](../../src/tools/ask-question-types.ts) | Args/result types, validators |
| [`src/tools/ask-question-queue.ts`](../../src/tools/ask-question-queue.ts) | Serialize modals (copy approval-queue) |
| [`src/ui/question-cards-modal.ts`](../../src/ui/question-cards-modal.ts) | DOM build, carousel state, resolve promise |
| [`src/styles/question-cards.css`](../../src/styles/question-cards.css) | Strip + card + option rows |
| [`src/tools/definitions.ts`](../../src/tools/definitions.ts) | +1 catalog entry |
| [`src/tools/client.ts`](../../src/tools/client.ts) | Route `ask_question` before generic browser path |
| [`test/tools/ask-question-validate.test.mts`](../../test/tools/ask-question-validate.test.mts) | Validator edge cases |
| [`test/ui/question-cards-state.test.mts`](../../test/ui/question-cards-state.test.mts) | Pure state: index, validation, serialize answers |

### 5.2 Queue vs approval

- **Same pattern** as [`approval-queue.ts`](../../src/tools/approval-queue.ts): only one question strip at a time globally.
- If tool approval and ask_question both pending: **approval drains first** (existing tool order) OR document that `ask_question` cannot run while approval open (simpler: queue behind approval in `executeTool` order — rare).

### 5.3 Chat history / bubbles

- Keep existing [`renderToolCall`](../../src/ui/tool-messages.ts) / `renderToolResult` for `ask_question`.
- Tool result body: collapsed JSON or short summary line: “User answered 3 questions” (humanize in `describe-invocation` / tool message formatter).
- Optional v1.1: custom bubble with Q/A summary (not required for ship).

### 5.4 Sub-agents

- Thread `ExecuteToolContext` (`chatId`, `subAgentType`) into modal header badge (reuse approval badge pattern).
- Sub-agent drawer: parent sees tool call; question UI still mounts in **parent** `#questionHost` (user answers for the running agent).

---

## 6. Prompt and skill updates

### 6.1 Tool usage prompt

Edit [`src/chat/prompts/tool-usage/default.full.md`](../../src/chat/prompts/tool-usage/default.full.md) (+ lite):

```markdown
### Structured questions (`ask_question`)

When you need **mutually exclusive choices**, **priorities**, or **MVP scope** from the user, call `ask_question` instead of long prose lists.

- Use **2–5 options** per question with clear `label` + short `description`.
- Batch related questions in one call (max 10); use `allow_multiple` only when several answers are valid.
- Do **not** ask_question for things you can infer from the repo or settings.
- After `cancelled`, ask conversationally or proceed with labeled assumptions.
- Plan / Research modes: prefer `ask_question` over suggesting destructive tools.
```

Bump `version` in front matter.

### 6.2 Mode prompts

- [`modes/plan.full.md`](../../src/chat/prompts/modes/plan.full.md): one bullet — use `ask_question` for scope/priority before drafting plans.
- [`modes/research.full.md`](../../src/chat/prompts/modes/research.full.md): optional — clarify sources/constraints via `ask_question`.

No registry change: `ask_question` not in `PLAN_DENIED_TOOLS`.

### 6.3 Built-in skill

Add [`src/skills/ask-user/SKILL.md`](../../src/skills/ask-user/SKILL.md) (id negotiable: `ask-user` or ship updated [`feature-context-gathering`](../../../.cursor/skills/feature-context-gathering/SKILL.md) as built-in copy):

- **When:** ambiguous requirements, multi-feature planning, trade-offs.
- **How:** call `ask_question` with grouped cards; 1–3 questions per call; structured options.
- **When not:** repo-explorable facts, linter errors, file paths.

Register in builtin manifest (`npm run prebuild`), [`documentation/context.md`](../../context.md) skills table.

### 6.4 System / base prompt

No duplicate tool list in `base` — only `tool-usage` section above.

---

## 7. Settings and catalog

| Item | Value |
|------|--------|
| `id` | `ask_question` |
| `label` | Ask question |
| `description` | Show structured multiple-choice questions at the bottom of the chat and wait for answers. |
| Default permission | `full` |
| Default enabled | `true` |
| Composer tools popover | Appears automatically via `fillToolsSection` |

Update tool count in `context.md` (41 → 42; 9 → 10 browser-native).

---

## 8. Edge cases

| Case | Behavior |
|------|----------|
| User closes X / Esc | `cancelled`; model should not retry same questions blindly |
| `questions` empty / invalid | `error` JSON, no UI |
| >10 questions | Truncate or reject with `error` (reject preferred) |
| Option `id` duplicate | Validator error |
| User hits **Stop** during strip | Cancel question promise + abort stream |
| Page reload mid-question | v1: pending turn recovery may restore chat without reopening strip — document as known gap |
| Model calls `ask_question` twice in one turn | Queue serializes |
| Tool disabled in settings | `Error: tool ask_question is disabled` |
| Plan mode | Allowed (not in deny list) |

---

## 9. Implementation phases (with todos)

### Phase A — Types and tool definition

- [ ] **A1** Add `ask-question-types.ts` with validators (min/max questions, options, ids).
- [ ] **A2** Add `ask_question` entry to `definitions.ts` (utility, browser).
- [ ] **A3** Unit tests for validators (`test/tools/ask-question-validate.test.mts`).

### Phase B — UI strip and carousel

- [ ] **B1** Add `#questionHost` to `index.html`; import CSS in `main.ts`.
- [ ] **B2** Implement `question-cards-modal.ts` (single card + carousel + submit/cancel).
- [ ] **B3** CSS polish: header, option row selected state, arrows, footer button.
- [ ] **B4** `main-column--question-pending` hides composer; disable input/send.
- [ ] **B5** Keyboard: Esc, arrows, optional digit shortcuts.
- [ ] **B6** Pure state tests for carousel index and answer map.

### Phase C — Queue and client wiring

- [ ] **C1** `ask-question-queue.ts` (clone approval-queue pattern).
- [ ] **C2** `client.ts`: early route for `ask_question` → queue → modal.
- [ ] **C3** Default seed in tool config: enabled + `full` permission.
- [ ] **C4** Stop generation cancels open question modal (integrate with existing abort).

### Phase D — Prompts and skill

- [ ] **D1** Update `tool-usage/default.full.md` + `default.lite.md`.
- [ ] **D2** Plan mode prompt bullet (full/lite).
- [ ] **D3** Add built-in skill `ask-user` + manifest + context.md entry.
- [ ] **D4** Sync `.cursor/skills/feature-context-gathering` note to prefer Minnow tool when in-app.

### Phase E — Docs and verification

- [ ] **E1** Update [`documentation/context.md`](../../context.md) (tool approval adjacent section + tool counts).
- [ ] **E2** Add [`documentation/plans/verification/feature-31.md`](verification/feature-31.md) checklist.
- [ ] **E3** Manual QA: 1 question, 5 questions carousel, multi-select, cancel, Plan mode, sub-agent badge, dark/light theme.

---

## 10. Test plan (verification)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Model calls `ask_question` with 1 question, 3 options | Strip shows; submit returns JSON answers |
| 2 | 4 questions | Arrows move cards; submit disabled until all answered |
| 3 | `allow_multiple: true` | Multiple options per question in JSON array |
| 4 | Esc | `cancelled`; loop continues with tool message |
| 5 | Tool off in settings | Error string, no strip |
| 6 | Plan mode | Tool still in API list; strip works |
| 7 | Stop during strip | Turn abort; strip closes |
| 8 | `npm test` | New validator + state tests pass |

---

## 11. Resolved product decisions

| Topic | Resolution |
|-------|----------------|
| Host order | `#toolApprovalHost` then `#questionHost` (tool approval closer to chat). |
| Submit | Primary **Submit answers** only on the **last** card; earlier cards use carousel arrows. |
| Skill | Built-in **`ask-user`** at `src/skills/ask-user/SKILL.md`. |
| Other | **Shipped in v1** — UI adds **Other** + textarea; result uses `__other__` id. |
| Tool bubble | Full **JSON** in history; expanded Result shows a **numbered list** via `format-ask-question-result` + `renderToolResult`. |

## 12. Related files

| Concern | Path |
|---------|------|
| Approval precedent | [`src/ui/tool-approval-modal.ts`](../../src/ui/tool-approval-modal.ts), [`src/styles/tool-approval.css`](../../src/styles/tool-approval.css) |
| Tool loop | [`src/tools/loop.ts`](../../src/tools/loop.ts) |
| Permissions | [`src/tools/permission-gate.ts`](../../src/tools/permission-gate.ts) — `ask_question` is routed before the gate (dedicated UI) |
| External skill reference | [`.cursor/skills/feature-context-gathering/SKILL.md`](../../../.cursor/skills/feature-context-gathering/SKILL.md) |
