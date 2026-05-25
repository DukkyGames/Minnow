---
name: polish-018-plan-intent-picker
overview: >-
  Plan-mode onboarding UI with preset intents (new feature, UI designer, code review,
  write tests, other), scoped user input, and composed first-send messages — reducing
  blank-slate friction without changing Plan tool policy.
todos:
  - id: w0-decisions
    content: "Wave 0: Product decisions sign-off (show rules, preprompt copy, skill wiring)"
    status: pending
  - id: w1-presets-module
    content: "Wave 1: Intent preset registry + preprompt templates"
    status: pending
  - id: w2-picker-ui
    content: "Wave 2: Plan intent picker panel + styles + mount hooks"
    status: pending
  - id: w3-send-integration
    content: "Wave 3: Compose message, send, dismiss persistence"
    status: pending
  - id: w4-tests-docs
    content: "Wave 4: Unit tests + context.md + bug-hunt status"
    status: pending
isProject: true
---

# POLISH-018 — Plan mode intent picker

**Date:** 2026-05-24  
**Status:** Planned (approved 2026-05-24; Linear backlog; no implementation yet)  
**Source:** `documentation/bug-hunt-session-2026-05-24.md` (POLISH-018, **Planned**)  
**Linear:** [MIN-74](https://linear.app/minnowai/issue/MIN-74/polish-018-plan-intent-picker)  
**Goal:** When the user enters **Plan** mode on an empty thread, show a guided intent picker instead of only the generic empty state + composer.

---

## Context

### Problem

Plan mode’s system prompt (`src/chat/prompts/modes/plan.full.md`) expects the model to gather context, explore the codebase, and write `documentation/plans/<name>.md`. Today, switching to Plan or opening a new Plan chat shows the same generic empty state as Build (`EMPTY_STATE_HTML` in `src/constants.ts` via `renderChatFromHistory` in `src/ui/messages.ts`): glyph, “No messages yet”, LM Studio hint. Users must invent the first message from scratch.

### Precedent in Minnow

**Orchestrate board onboarding** (`mountBoardOnboardingPanel` in `src/ui/orchestrate-board.ts`, styles in `src/styles/orchestrate-board.css`) is the closest pattern:

- Dedicated panel in the main content area (not the composer strip).
- Primary action composes text into `#msgInput` and calls `sendMessage()` (`sendBoardMessage`).
- Plan list + **Start** with a fixed kickoff string (`BOARD_ONBOARDING_KICKOFF_MESSAGE`).

POLISH-018 should mirror that **structure** (panel → secondary scope step → send) but with **intent presets** and **per-intent preprompt scaffolds**.

### Constraints (unchanged by this feature)

- Plan mode **tool policy** stays read-only except `documentation/plans/` (`plan-write-guard.ts`, `modes/plan.*.md`).
- Intent picker only affects **first user turn composition** and UX; it does not add new tools or widen write paths.
- No prototype folder exists in the repo; UX should follow existing tokens (`--mn-*`) and onboarding panels.

### Related backlog (out of scope here)

| Item | Relationship |
|------|----------------|
| POLISH-019 (General/Chat mode) | Separate sixth mode; no overlap |
| POLISH-020 (Reef merge) | Mode count may change later; picker is Plan-only |
| `uiDesignerMode` on `Chat` | Existing `plan` \| `implement` for `/ui-designer`; picker “UI designer” should align, not duplicate settings |

---

## Desired behavior (from bug hunt)

1. User switches to **Plan** or opens a **Plan** chat with **no messages**.
2. **Chat area** shows a dedicated **Plan intent picker** (not only empty state).
3. **Preset buttons** (initial set):
   - **New feature** — greenfield / feature planning
   - **UI designer** — Impeccable / `ui-designer` skill–adjacent planning
   - **Code review** — review-oriented plan (scope, files, checklist)
   - **Write tests** — test-coverage plan
   - **Other** — free-text only (no fixed preprompt template)
4. For each preset except **Other**:
   - Apply a **preprompt** (scaffold text prepended or structured in the first user message).
   - Show a **scope prompt** (short description: feature name, paths, MVP, etc.).
   - On submit, send **one combined user message** into the Plan thread.
5. **Other:** user enters scope/message directly; send without a template block.

---

## Product decisions (resolve in Wave 0)

### When to show the picker

| Option | Recommendation | Rationale |
|--------|----------------|-----------|
| Every time user selects Plan mode | ❌ | Annoying when returning to an in-progress Plan chat |
| Once per chat, when `history.length === 0` and `modeId === plan` | ✅ **Default** | Matches “on open” intent; same gate as generic empty state |
| Once per workspace (global flag) | ❌ | Hides picker for second Plan chat in same repo |

**Additional rules (recommended):**

- **Hide** picker when `chat.history.length > 0`.
- **Hide** when streaming or composer recovery blocked (same gates as mode selector).
- Provide **“Skip”** or **“Type in composer instead”** link that dismisses picker for this chat without sending.
- Optional **“Change intent”** control in empty-state area only before first message — low priority; can defer to v2.

**Persistence:** add optional `Chat.planIntentPickerDismissed?: boolean` (default false). Set `true` on Skip. Do not show picker when dismissed even if history is empty.

### Switching mode on a non-empty chat

If user changes mode **to** Plan on a chat that already has history: **do not** show picker (no retroactive onboarding).

### New chat defaults

When user creates a chat already in Plan mode (if supported) or switches to Plan before first send: show picker.

### UI designer preset vs skill

Built-in skill: `src/skills/ui-designer/SKILL.md` (plan vs implement, Impeccable workflow). Composer already inserts hints via `src/ui/skill-picker.ts` for `/ui-designer`.

**Recommendation:** composed first message includes slash invocation where appropriate:

```text
/ui-designer plan — <user scope>
```

Preprompt body (static) should state: output is a **plan markdown under `documentation/plans/`** only, Impeccable preflight, audit/shape before file writes — aligned with skill + Plan mode restrictions.

### Code review & write tests in Plan mode

These skills (`code-review`, `write-tests`) are normally **implementation/review** workflows. In **Plan** mode the deliverable is still a **plan document**, not executing review or writing tests.

**Recommendation:** preprompts frame intent explicitly, e.g. “Produce a Plan-mode document that defines scope, files, waves, and verification for a future code review” / “…for adding test coverage”, not “run review now”.

### Expert / work agent

Do **not** auto-switch expert in v1 unless product asks — Plan mode already has strong system prompt. Optional v2: map presets to `expertSelection` hints. Document as out of scope for v1.

---

## UX specification

### Layout (chat area)

Replace or supersede `#emptyState` when picker is active:

```
┌─────────────────────────────────────────────┐
│  [icon]  What do you want to plan?          │
│  Short subtitle (Plan mode delivers .md…)   │
│                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐    │
│  │ New      │ │ UI       │ │ Code     │    │
│  │ feature  │ │ designer │ │ review   │    │
│  └──────────┘ └──────────┘ └──────────┘    │
│  ┌──────────┐ ┌──────────┐                  │
│  │ Write    │ │ Other    │                  │
│  │ tests    │ │          │                  │
│  └──────────┘ └──────────┘                  │
│                                             │
│  (Step 2 — after preset, except Other)      │
│  Label: Describe scope…                     │
│  [ multiline or single-line input ]         │
│  [ Back ]  [ Start planning ] (primary)     │
│                                             │
│  Skip — use composer only                     │
└─────────────────────────────────────────────┘
```

- **Step 1:** preset grid (buttons, `role="group"`, keyboard roving tabindex).
- **Step 2:** scope field + Back (returns to grid) + primary submit.
- **Other:** Step 1 selects Other → show scope field only (placeholder: “Describe what you want to plan…”); no preprompt block in composed message.

### Visual system

- New BEM block: `.plan-intent-picker` (parallel to `.board-onboarding`).
- New stylesheet: `src/styles/plan-intent-picker.css` (import from main style entry like orchestrate board).
- Reuse empty-state vertical centering from `.empty-state` where possible.

### Accessibility

- `aria-live="polite"` on step changes.
- Preset buttons: `aria-pressed` or radio-group pattern.
- Primary action disabled until scope non-empty (trimmed), except allow empty for Other only if product allows — **recommend require non-empty** for all paths.

### Composer interaction

While picker visible:

- Composer remains available; **Skip** dismisses picker and focuses `#msgInput`.
- Do not auto-hide composer (unlike tool approval overlay).

---

## Technical design

### New modules

| File | Responsibility |
|------|----------------|
| `src/chat/plan/intent-presets.ts` | Preset ids, labels, descriptions, preprompt template strings, optional `skillPrefix` |
| `src/ui/plan-intent-picker.ts` | DOM mount, step state machine, `shouldShowPlanIntentPicker(chat)` |
| `src/styles/plan-intent-picker.css` | Layout and tokens |

### Preset registry (initial content)

| `id` | Label | `skillPrefix` (optional) | Preprompt role |
|------|-------|--------------------------|----------------|
| `new-feature` | New feature | — | Ask for feature name, users, MVP, constraints; plan waves for implementation |
| `ui-designer` | UI designer | `/ui-designer plan —` | Impeccable-guided UI plan under `documentation/plans/`; no implementation |
| `code-review` | Code review | `/code-review` (optional) | Plan for review pass: targets, checklist, outputs — not executing review |
| `write-tests` | Write tests | `/write-tests` (optional) | Plan coverage: modules, test stack, cases — not writing tests yet |
| `other` | Other | — | No preprompt; user text only |

Preprompt templates live as **static English strings** in `intent-presets.ts` (or `src/chat/prompts/plan/intent/*.md` if prompts grow large — start inline for minimal scope).

### Message composition

```ts
function composePlanIntentMessage(presetId, userScope: string): string {
  if (presetId === 'other') return userScope.trim();
  const preset = getPreset(presetId);
  const prefix = preset.skillPrefix ? `${preset.skillPrefix} ` : '';
  return `${prefix}${preset.preprompt}\n\n---\n\nUser scope:\n${userScope.trim()}`;
}
```

Use the same send path as board onboarding:

```ts
function sendPlanIntentMessage(text: string): void {
  const input = document.getElementById('msgInput') as HTMLTextAreaElement | null;
  if (!input) return;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  void import('../chat/messaging').then((m) => m.sendMessage());
}
```

After successful send: set `planIntentPickerDismissed = true` (or rely on `history.length > 0` on next render).

### Mount / unmount hooks

| Hook point | Action |
|------------|--------|
| `renderChatFromHistory` (`messages.ts`) | If `shouldShowPlanIntentPicker(chat)`, call `mountPlanIntentPicker(chatArea, chat)` instead of generic `EMPTY_STATE_HTML` |
| `setChatMode` (`mode-selector.ts`) | After mode → plan, `renderChatFromHistory` already runs — picker appears if empty |
| Active chat switch (`sidebar` / session load) | Same via `renderChatFromHistory` |
| Stream end / history append | Picker not remounted if messages exist |

Export `refreshPlanIntentPickerIfMounted()` for parity with `refreshBoardOnboardingIfMounted` (optional; call from `loop.ts` if streaming gates disable controls).

### Session schema

Add to `Chat` in `src/types.ts`:

```ts
/** Plan intent picker dismissed without sending (POLISH-018). */
planIntentPickerDismissed?: boolean;
```

Bump `SESSION_SCHEMA_VERSION` only if migration required; prefer optional field with default `undefined` → false (no migration).

### Tests

| Test | Location |
|------|----------|
| `composePlanIntentMessage` for each preset + other | `tests/plan-intent-picker.test.ts` (node:test) |
| `shouldShowPlanIntentPicker` matrix (mode, history, dismissed) | same file |
| DOM mount smoke (optional) | browser test subset if existing pattern for onboarding |

Run: `npm test` and `npx tsc --noEmit`.

### Documentation updates (implementation wave)

- `documentation/context.md` — Plan mode row: intent picker, files, show rules.
- `documentation/bug-hunt-session-2026-05-24.md` — POLISH-018 status → **Planned** when implementation starts.

---

## Wave breakdown

### Wave 0 — Product decisions sign-off

- [ ] Confirm show rules: empty Plan chat only; dismiss flag; no picker on mode switch with history.
- [ ] Approve preset list and user-facing labels.
- [ ] Approve preprompt copy (eng review for Plan-mode framing of review/tests).
- [ ] Decide whether `code-review` / `write-tests` slash prefixes appear in composed message (recommended: yes for skill routing hints).

### Wave 1 — Intent preset registry

- [ ] Add `src/chat/plan/intent-presets.ts` with types `PlanIntentPresetId`, `PlanIntentPreset`, `getPreset`, `composePlanIntentMessage`.
- [ ] Add unit tests for composition (static expected strings per preset).

### Wave 2 — Plan intent picker UI

- [ ] Add `src/styles/plan-intent-picker.css` and wire import.
- [ ] Implement `mountPlanIntentPicker(container, chat)` + `shouldShowPlanIntentPicker(chat)`.
- [ ] Two-step UI + Skip + Back; disable submit when scope empty.
- [ ] Integrate into `renderChatFromHistory` empty branch.

### Wave 3 — Send integration & persistence

- [ ] `sendPlanIntentMessage` on primary submit.
- [ ] Set `planIntentPickerDismissed` on Skip and after send.
- [ ] `touchChat` + `scheduleSaveSessions` on dismiss.
- [ ] Disable controls while `isActiveChatStreaming()` / `isComposerRecoveryBlocked()`.

### Wave 4 — Tests, docs, closure

- [ ] Full test matrix for `shouldShowPlanIntentPicker`.
- [ ] Manual QA checklist (below).
- [ ] Update `documentation/context.md`.
- [ ] Mark POLISH-018 in bug-hunt doc when shipped.

---

## Manual test plan

1. New chat → switch to **Plan** → picker visible; generic empty state not shown.
2. Each preset → scope step → **Start planning** → one user message in history with expected scaffold; stream starts.
3. **Other** → only user text in message.
4. **Skip** → picker hidden; generic empty state or bare chat; composer works; reload session → still dismissed.
5. Plan chat with messages → switch away and back → no picker.
6. Build chat with messages → switch to Plan → no picker.
7. Streaming in progress → picker actions disabled.
8. `npm test` + `npx tsc --noEmit` green.

---

## Out of scope (v1)

- Changing Plan tool policy or `plan.full.md` structure.
- Auto-selecting Expert or Work Agent from preset.
- Settings UI to customize presets (future: user config under Settings → Modes → Plan).
- Replacing `ask_question` tool usage inside Plan runs — picker is **client onboarding** only.
- Localization / i18n.
- POLISH-019 General mode or Reef merge.

---

## Open questions (for product owner)

1. **Exact preprompt copy** for each preset — should copy live in repo as markdown snippets editable without code change?
2. **UI designer:** force `uiDesignerMode: 'plan'` on chat when preset chosen?
3. **Re-show picker** after Skip if user deletes all messages — treat as empty history again?
4. **Benchmark / headless:** does picker need `data-testid` hooks for automation (recommend yes on primary buttons)?

---

## Implementation estimate

| Wave | Effort (rough) |
|------|----------------|
| 0 | 0.5 day (review) |
| 1 | 0.5 day |
| 2 | 1 day |
| 3 | 0.5 day |
| 4 | 0.5 day |
| **Total** | **~3 days** |

---

## References

- Bug hunt: `documentation/bug-hunt-session-2026-05-24.md` § POLISH-018
- Plan mode prompt: `src/chat/prompts/modes/plan.full.md`
- Orchestrate onboarding: `src/ui/orchestrate-board.ts` (`mountBoardOnboardingPanel`, `sendBoardMessage`)
- Empty chat render: `src/ui/messages.ts`, `src/constants.ts`
- Mode switch: `src/ui/mode-selector.ts`
- Skills: `src/skills/ui-designer/`, `code-review/`, `write-tests/`
- Architecture index: `documentation/context.md` (Operating modes)


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-74](https://linear.app/minnowai/issue/MIN-74/polish-018-plan-intent-picker)
