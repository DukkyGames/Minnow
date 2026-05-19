# Step 01 — Chat UX polish and streaming affordances

**Step ID:** `s01-ui-polish`  
**Status:** Implementation plan (not yet implemented)  
**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) items **15, 16, 24, 25** (chat bar spacing, top bar cleanup, streaming animation, “Generating response…” — **not** LSP/MCP lines 26–28)  
**Parent roadmap:** [`.cursor/plans/to-fix_step_order_a5310c61.plan.md`](../../../.cursor/plans/to-fix_step_order_a5310c61.plan.md) — Wave 0, Step 01  
**Depends on:** nothing  
**Blocks:** nothing critical (Step 02 may run in parallel)  
**Prototype folder:** None in repo at plan time — use [`DESIGN.md`](../../../DESIGN.md), [`.impeccable/design.json`](../../../.impeccable/design.json), and [`documentation/plans/thought-bubbles-ui.md`](../thought-bubbles-ui.md) instead.

---

## Overview

Polish the primary chat surface without new persistence, providers, or settings pages. Four user-visible problems drive this step:

| Backlog # | User pain | Target outcome |
|-----------|-----------|----------------|
| **15** | Composer / “chat bar tools” spacing feels tight or misaligned | Consistent gaps between attach row, preview chips, textarea, and send button across breakpoints |
| **16** | Redundant top-bar controls | **New chat** only in the sidebar; **one** sidebar open/collapse control per viewport |
| **24** | Generating-state animation is a harsh blinking square | Distinct, on-brand **thinking** vs **generating** affordances |
| **25** | After reasoning ends, user sees a blank gap or lone square | Visible **“Generating response…”** (with motion) until the first prose token |

**Out of scope for Step 01:** `~/.speedchat` migration, new composer tool rows (Step 20), terminal, file tree, skills, providers, programmatic prompts, changing tool-loop semantics beyond stream UI hooks, fixing LM Studio connectivity, live tool-bubble wiring (T9 in tool-usage verification).

**Already done (do not re-implement):** Empty assistant bubble on new chats (parent plan notes backlog item 2 fixed).

---

## Prerequisites

### Environment

- Node **18+** (project uses **22** in verification notes).
- `npm install` completed.
- For manual streaming QA: **LM Studio** running with at least one chat model; optional **reasoning** model + LM Studio **App Settings → Developer** → separated reasoning enabled (see [`thought-bubbles-ui.md`](../thought-bubbles-ui.md)).

### Read first (implementer)

| Order | Document / file | Why |
|-------|-----------------|-----|
| 1 | [`documentation/context.md`](../../context.md) | Architecture, message rendering, bootstrap |
| 2 | This plan | Acceptance criteria and file tasks |
| 3 | [`index.html`](../../../index.html) | Top bar + composer markup |
| 4 | [`src/styles/input.css`](../../../src/styles/input.css), [`messages.css`](../../../src/styles/messages.css), [`thoughts.css`](../../../src/styles/thoughts.css), [`topbar.css`](../../../src/styles/topbar.css), [`responsive.css`](../../../src/styles/responsive.css) | Visual changes |
| 5 | [`src/ui/messages.ts`](../../../src/ui/messages.ts), [`src/ui/thought-bubbles.ts`](../../../src/ui/thought-bubbles.ts), [`src/markdown/renderer.ts`](../../../src/markdown/renderer.ts) | Streaming DOM lifecycle |
| 6 | [`src/tools/loop.ts`](../../../src/tools/loop.ts), [`src/api/chat.ts`](../../../src/api/chat.ts) | Send paths that create streaming rows |
| 7 | [`DESIGN.md`](../../../DESIGN.md) § Components / Buttons / Flat Chrome | Tone and spacing |
| 8 | [`documentation/plans/tool-usage-verification.md`](../tool-usage-verification.md) | Regression checklist after UI pass |

### Dependencies (npm)

No new runtime dependencies required. **Recommended dev dependency** for DOM unit tests (implementer choice, pick one):

- **`happy-dom`** + Node built-in `node:test`, **or**
- **`linkedom`** + `node:test`

Do **not** add Playwright unless the team explicitly wants E2E in a later step; Step 01 verification is DOM/unit + build + manual.

---

## Dependencies (other steps)

| Relationship | Step | Notes |
|--------------|------|-------|
| **Depends on** | — | Safe first step |
| **Soft parallel** | Step 02 (`~/.speedchat`) | No schema conflict if Step 02 avoids `index.html` top bar in the same PR |
| **Does not block** | Steps 03–20 | Pure UI |

---

## Problem analysis (current behavior)

### A. Hidden prose shell hides the only cursor

```79:82:src/styles/messages.css
.msg.assistant.msg--awaiting-prose .msg-bubble.msg-bubble--awaiting {
  display: none;
}
```

`appendStreamingAssistantRow()` puts the `.cursor` **inside** the hidden `.msg-bubble--awaiting`. Until `revealAssistantProseBubble()`, the user often sees **nothing** in the assistant column (non-reasoning models) or only thought bubbles, then a **blank gap** after `endReasoningPhase()` until the first prose delta.

### B. `.cursor` is a solid rectangle

```247:255:src/styles/messages.css
.cursor {
  display: inline-block;
  width: 8px; height: 14px;
  background: var(--cyan);
  ...
}
```

Backlog calls this a “square”; it reads as a block, not a typing indicator.

### C. Redundant top-bar actions

- `#btnNewChatTop` duplicates sidebar `chat-new-wide` / `chat-new-compact`.
- `#btnSidebarToggle` duplicates `#btnSidebarCollapse` on **desktop** (`toggleSidebarLayout` vs `toggleSidebarCollapsed` both collapse the rail). On **mobile (≤640px)**, `#btnSidebarCollapse` is **hidden** ([`sidebar.css`](../../../src/styles/sidebar.css) L349–351) — top-bar toggle must **remain on mobile only**.

### D. Composer spacing

[`input.css`](../../../src/styles/input.css): `.input-bar` gap `10px`, `.input-row` gap `8px`, attach/send `44×44px`. Backlog **15** asks for clearer separation when `#attachPreview` is visible and alignment of paperclip vs textarea baseline.

### E. Mojibake in status pill

`setStatus('spin', 'Generating replyâ€¦')` in [`loop.ts`](../../../src/tools/loop.ts) and [`chat.ts`](../../../src/api/chat.ts) — fix to proper Unicode ellipsis `…` while touching those files.

---

## Target UX specification

### Stream phases (per assistant turn)

Use a single state machine owned by the streaming row (new helper module recommended).

| Phase | When | Visible UI |
|-------|------|------------|
| **`generating`** | Row created → first reasoning delta **or** first prose delta (if no reasoning) | Status row: label **“Generating response…”** + subtle pulse/dots animation (not a solid block) |
| **`thinking`** | First reasoning SSE delta → `endReasoningPhase()` | Status label **“Thinking…”** (optional; thought dashed bubble is primary); status may hide once `.thought-stage` is visible — **never** hide all feedback |
| **`generating`** (again) | `endReasoningPhase()` called, prose not yet revealed | **“Generating response…”** must show (fixes backlog **25**) |
| **`prose`** | `revealAssistantProseBubble()` + streamed content | Hide status row; show prose bubble; inline caret optional (thin, accent) during stream |
| **`done`** | Turn complete | Remove caret; normal completed bubble |

**Accessibility**

- Status container: `role="status"`, `aria-live="polite"`, `aria-busy="true"` while not in `prose`/`done`.
- Labels must be visible text (not `aria-hidden` only).
- Respect `prefers-reduced-motion`: disable pulse keyframes; keep static labels.

### Top bar (after cleanup)

| Viewport | Sidebar open | Sidebar collapse | New chat |
|----------|--------------|------------------|----------|
| **Desktop ≥641px** | N/A (sidebar visible or rail) | `#btnSidebarCollapse` only | Sidebar buttons only |
| **Mobile ≤640px** | `#btnSidebarToggle` only | hidden | Sidebar when drawer open |

Remove `#btnNewChatTop` from markup entirely.

### Composer spacing targets

- Align attach button vertical center with first line of textarea (flex `align-items: flex-end` is OK if textarea min-height matches attach height).
- When `#attachPreview` is visible: `8px` gap below chips before `.input-row` (already on `.input-bar-composer`; verify visually).
- Touch targets remain **≥44px** on mobile ([`responsive.css`](../../../src/styles/responsive.css) 16px font rule for inputs at ≤600px — do not break).

---

## API / UI changes

### DOM (new / changed)

**`appendStreamingAssistantRow()`** — suggested structure:

```html
<div class="msg assistant msg--awaiting-prose" data-stream-phase="generating">
  <motion.div class="msg-label">Assistant</motion.div>
  <motion.div class="stream-status" role="status" aria-live="polite" aria-busy="true">
    <span class="stream-status__dots" aria-hidden="true"></span>
    <span class="stream-status__label">Generating response…</span>
  </motion.div>
  <!-- thought-stage inserted here by ThoughtBubbleController -->
  <motion.div class="msg-bubble msg-bubble--awaiting">
    <motion.div class="cursor" aria-hidden="true"></motion.div>
  </motion.div>
</div>
```

(Use semantic elements as in existing code — `motion.*` is illustrative only.)

**New CSS classes** (in [`messages.css`](../../../src/styles/messages.css) unless split to `stream-status.css`):

- `.stream-status`, `.stream-status--thinking`, `.stream-status--generating`
- `.stream-status__label`, `.stream-status__dots` (three-dot or bar pulse)
- `.cursor--prose` (optional thinner caret for inline streaming)

**`index.html`**

- Remove `#btnNewChatTop` and adjacent separator if it only served that button.
- Keep `#btnSidebarToggle`; add class e.g. `topbar-sidebar-toggle` for responsive show/hide.

**`responsive.css`**

- Remove `#btnNewChatTop { display: none }` block (element gone).
- Add `@media (min-width: 641px) { .topbar-sidebar-toggle { display: none; } }` (or equivalent).

### TypeScript API (new)

Create [`src/ui/stream-status.ts`](../../../src/ui/stream-status.ts) (name may vary; keep responsibility narrow):

```ts
export type StreamPhase = 'generating' | 'thinking' | 'prose' | 'done';

export interface StreamingStatusHandle {
  setPhase(phase: StreamPhase): void;
  dispose(): void;
}

export function attachStreamStatus(wrap: HTMLElement): StreamingStatusHandle;
```

**Integration points**

| File | Change |
|------|--------|
| [`src/ui/messages.ts`](../../../src/ui/messages.ts) | Create status node in `appendStreamingAssistantRow`; export `setStreamingRowPhase(wrap, phase)` or return handle alongside `{ wrap, bubble, cursor }` |
| [`src/ui/thought-bubbles.ts`](../../../src/ui/thought-bubbles.ts) | On first `appendReasoningDelta`, notify phase `thinking` (via optional callback or `data-stream-phase` on wrap) |
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) | On new `appendStreamingAssistantRow` after tool round: reset phase `generating`; wire `onFirstProseDelta` to `prose`; call `endReasoningPhase` hook → `generating` if bubble still hidden |
| [`src/api/chat.ts`](../../../src/api/chat.ts) | Mirror loop behavior in plain `sendMessage` path |
| [`src/markdown/renderer.ts`](../../../src/markdown/renderer.ts) | No API change; cursor may stay for prose stream |

**`StreamingAssistantRow` type** — extend:

```ts
export interface StreamingAssistantRow {
  wrap: HTMLDivElement;
  bubble: HTMLDivElement;
  cursor: HTMLDivElement;
  streamStatus: StreamingStatusHandle; // new
}
```

---

## Detailed file-by-file tasks

### 1. [`index.html`](../../../index.html)

- [ ] Remove `<button … id="btnNewChatTop" …>` (lines ~25–27).
- [ ] Remove orphaned `.topbar-sep` if it only separated new-chat from model picker; keep separators that still divide meaningful groups.
- [ ] Add class `topbar-sidebar-toggle` to `#btnSidebarToggle` for CSS targeting.
- [ ] Composer: optional wrapper tweak only if needed for spacing (prefer CSS-only); document any markup change in verification file.

### 2. [`src/styles/responsive.css`](../../../src/styles/responsive.css)

- [ ] Delete `@media (max-width: 380px) { #btnNewChatTop { display: none; } }` block.
- [ ] Add desktop rule to hide `.topbar-sidebar-toggle` at `min-width: 641px`.
- [ ] Verify mobile landscape `.input-bar` padding still OK after composer CSS changes.

### 3. [`src/styles/topbar.css`](../../../src/styles/topbar.css)

- [ ] Adjust `.topbar` gap if removing a button leaves awkward whitespace (target: balanced model picker flex).
- [ ] No new shadows (Flat Chrome rule).

### 4. [`src/styles/input.css`](../../../src/styles/input.css)

- [ ] Tune `.input-bar` / `.input-bar-composer` / `.input-row` gaps (suggested: composer column gap `10px`, input-row gap `10px`, attach-preview bottom margin `2px`).
- [ ] Ensure `.attach-btn` and `.send-btn` share height with `#msgInput` min-height (`44px`).
- [ ] Chip strip: add `margin-bottom: 2px` when not `.hidden` if preview-to-input gap is tight.
- [ ] Document final pixel values in verification file for visual regression.

### 5. [`src/styles/messages.css`](../../../src/styles/messages.css)

- [ ] Add `.stream-status` block styles (muted text, 12–13px, uppercase optional per DESIGN label rules).
- [ ] Add `@keyframes stream-pulse` / `stream-dots` with `prefers-reduced-motion` override.
- [ ] Change awaiting rule: **do not** hide entire assistant feedback — either:
  - **Option A (recommended):** Keep `.msg-bubble--awaiting { display: none }` but status row is **sibling**, always visible until `prose`; or
  - **Option B:** Show bubble with min-height 0 and only status inside — avoid Option B if it duplicates bubbles.
- [ ] Refine `.cursor` for prose: width `2px`, height `1em`, `background: var(--accent)`, or replace with CSS `caret-color` on contenteditable-less approach (keep `div.cursor` for minimal diff).
- [ ] When `.msg--awaiting-prose` removed, hide `.stream-status`.

### 6. [`src/styles/thoughts.css`](../../../src/styles/thoughts.css)

- [ ] Ensure `.thought-stage` margin does not double-gap with `.stream-status` (coalesce to `margin-bottom: 6px` total).
- [ ] Keep `.thought-cursor` distinct from prose `.cursor` (already muted).

### 7. [`src/ui/stream-status.ts`](../../../src/ui/stream-status.ts) (new)

- [ ] Implement `attachStreamStatus`, `setPhase`, label strings:
  - `generating` → `"Generating response…"`
  - `thinking` → `"Thinking…"`
  - `prose` / `done` → hide status, `aria-busy="false"`
- [ ] Export label constants for tests (`STREAM_LABEL_GENERATING`, etc.).

### 8. [`src/ui/messages.ts`](../../../src/ui/messages.ts)

- [ ] Import stream-status helper.
- [ ] Update `appendStreamingAssistantRow()` to insert status element **before** bubble.
- [ ] `revealAssistantProseBubble()` → set phase `prose` and remove `msg--awaiting-prose` (existing) + hide status.
- [ ] Export helper to set phase from loop/chat/thoughts.

### 9. [`src/ui/thought-bubbles.ts`](../../../src/ui/thought-bubbles.ts)

- [ ] Accept optional `onPhaseChange?: (phase: 'thinking') => void` in constructor **or** read `wrap.dataset` via exported function from messages.
- [ ] First `appendReasoningDelta` → fire `thinking` once.
- [ ] `endReasoningPhase()` → invoke parent callback to set `generating` if prose not revealed (parent checks `wrap.classList.contains('msg--awaiting-prose')`).

### 10. [`src/tools/loop.ts`](../../../src/tools/loop.ts)

- [ ] Destructure `streamStatus` from `appendStreamingAssistantRow()`.
- [ ] Pass phase callbacks into `ThoughtBubbleController`.
- [ ] After `streamRow = appendStreamingAssistantRow()` on tool-loop continuation: `streamStatus.setPhase('generating')`.
- [ ] Fix status strings: `Generating reply…`, `Running tools…` (UTF-8 ellipsis).
- [ ] On `onFirstProseDelta` / `revealProse`: phase `prose`.

### 11. [`src/api/chat.ts`](../../../src/api/chat.ts)

- [ ] Same stream-status wiring as loop for plain send path.
- [ ] Fix mojibake status strings.

### 12. [`src/markdown/renderer.ts`](../../../src/markdown/renderer.ts)

- [ ] Verify empty streaming markdown still appends cursor; no change unless caret style moved to CSS only.

### 13. Scripts / extracted HTML (hygiene)

- [ ] Update [`scripts/_extracted-body.html`](../../../scripts/_extracted-body.html) if migration script still used (mirror `index.html` top bar).

### 14. [`documentation/context.md`](../../context.md)

- [ ] **Message rendering** — document stream status row, phases, top-bar button policy.
- [ ] **Layout** — note mobile-only `#btnSidebarToggle`, sidebar-only new chat.
- [ ] **Testing** — link to `documentation/plans/verification/step-01.md`.

### 15. [`documentation/plans/verification/step-01.md`](../verification/step-01.md) (new, implementer creates)

- [ ] Commands: `npm run build`, `npm test` (or documented `node --test` path), optional `npx tsx scripts/step01-ui-smoke.mjs`.
- [ ] Manual checklist U1–U8 (below).

### 16. [`documentation/plans/tool-usage-verification.md`](../tool-usage-verification.md) (optional touch)

- [ ] Add short “Step 01 regression” note: re-run build + smoke; UI-only, no new T9/A3 requirements.

---

## Acceptance criteria

### Functional

1. **New chat:** No `#btnNewChatTop` in DOM; `createChat()` still works from sidebar buttons at all breakpoints.
2. **Sidebar toggle:** Desktop has no top-bar hamburger; mobile has top-bar hamburger; `#btnSidebarCollapse` works on desktop.
3. **Non-reasoning stream:** From send until first token, user sees **“Generating response…”** (not empty chat column).
4. **Reasoning stream:** During reasoning, user sees thought bubble(s) and **Thinking…** and/or clear thought UI; after reasoning ends and before prose, **Generating response…** shows.
5. **Prose stream:** Status hides; markdown bubble visible; caret is not a large solid square.
6. **Tool loop:** Second turn after tools shows generating state again; no duplicate status nodes.
7. **Abort / error:** `thoughtController.abort()` and failed sends remove `aria-busy` and status nodes (no orphans).
8. **Composer:** Attach + textarea + send aligned; attachment chips do not collide with send button on 320px width.

### Technical

9. `npm run build` exits 0.
10. Automated tests in `test/` pass (implementer adds runner or `node --test` script).
11. No new `localStorage` keys; no server API changes.
12. [`documentation/context.md`](../../context.md) updated.

### Verifier sign-off

Verifier reports **PASS** only if criteria 1–12 hold and manual U1–U8 in verification file are checked.

---

## Full implementation todo checklist

Copy into PR description; implementer checks off:

### Planning & setup

- [ ] Read prerequisites and problem analysis sections
- [ ] Confirm LM Studio available for manual streaming tests
- [ ] Create `documentation/plans/verification/step-01.md` from template below

### Top bar & composer

- [ ] Remove `#btnNewChatTop` from `index.html`
- [ ] Hide `#btnSidebarToggle` on desktop via CSS; keep on mobile
- [ ] Tune `input.css` spacing (document values)
- [ ] Adjust `topbar.css` / `responsive.css` for removed button

### Streaming affordances

- [ ] Add `src/ui/stream-status.ts`
- [ ] Update `appendStreamingAssistantRow` + types in `messages.ts`
- [ ] Add `.stream-status` + cursor styles in `messages.css`
- [ ] Wire `thought-bubbles.ts` phase callbacks
- [ ] Wire `loop.ts` tool path + new stream rows
- [ ] Wire `chat.ts` plain send path
- [ ] Fix UTF-8 ellipsis in status pill strings
- [ ] `prefers-reduced-motion` tested

### Tests & docs

- [ ] Add `test/fixtures/step01/*.json` static fixtures
- [ ] Add `test/ui/stream-status.test.mjs` (or `.ts` with runner)
- [ ] Add `scripts/step01-ui-smoke.mjs` (HTML assertions)
- [ ] Add `npm test` script to `package.json` if missing
- [ ] Update `documentation/context.md`
- [ ] Run `npm run build` locally
- [ ] Run full test command locally

### Handoff

- [ ] Fill verification file with commands + results
- [ ] List manual tests U1–U8 as PASS/FAIL
- [ ] Hand to verifier agent (separate session)

---

## Unit / integration test plan

### Philosophy

- **Deterministic:** fixed strings, no `Date.now()` in assertions.
- **Business outcome:** phase labels and DOM visibility, not CSS pixel values.
- **Static expected results** in fixture files per project test guidelines.

### Test files to add

| File | Type | What it proves |
|------|------|----------------|
| [`test/fixtures/step01/stream-labels.json`](../../../test/fixtures/step01/stream-labels.json) | Fixture | Expected copy for phases |
| [`test/fixtures/step01/topbar-desktop.html`](../../../test/fixtures/step01/topbar-desktop.html) | Fixture snippet | Must not contain `btnNewChatTop` |
| [`test/ui/stream-status.test.mjs`](../../../test/ui/stream-status.test.mjs) | Unit (happy-dom/linkedom) | `attachStreamStatus` phase transitions |
| [`test/ui/messages-stream-row.test.mjs`](../../../test/ui/messages-stream-row.test.mjs) | Unit | `appendStreamingAssistantRow` inserts `.stream-status` before bubble |
| [`scripts/step01-ui-smoke.mjs`](../../../scripts/step01-ui-smoke.mjs) | Integration smoke | Fetch `index.html` from running `npm start`; assert selectors |

### Fixture: `test/fixtures/step01/stream-labels.json`

```json
{
  "generating": "Generating response…",
  "thinking": "Thinking…",
  "generating_ascii_check": "Generating response\u2026"
}
```

### Fixture: `test/fixtures/step01/topbar-desktop.html`

Static excerpt (implementer keeps in sync with `index.html`):

```html
<!-- EXPECTED_ABSENT: id="btnNewChatTop" -->
<!-- EXPECTED_PRESENT: id="btnSidebarToggle" class="topbar-sidebar-toggle" -->
```

### Unit test cases (`stream-status.test.mjs`)

Use `node:test` + happy-dom:

1. **`attachStreamStatus` starts in generating** — label text equals fixture `generating`; `aria-busy="true"`.
2. **`setPhase('thinking')`** — label equals fixture `thinking`.
3. **`setPhase('prose')`** — status element has class `hidden` or `display: none`; `aria-busy="false"`.
4. **`dispose()`** — removes node from DOM.
5. **`prefers-reduced-motion`** — optional: assert animation class not required when env mocked.

### Unit test cases (`messages-stream-row.test.mjs`)

1. Mount minimal `#chatArea` + `#emptyState` in DOM.
2. Call `appendStreamingAssistantRow()`.
3. **Assert order:** `.stream-status` is previous sibling of `.msg-bubble--awaiting`.
4. Call `revealAssistantProseBubble(wrap, bubble)`.
5. **Assert:** `wrap` lacks `msg--awaiting-prose`; status hidden.

### Integration smoke (`scripts/step01-ui-smoke.mjs`)

```bash
# Prerequisites: npm start
node scripts/step01-ui-smoke.mjs http://localhost:5173
```

Checks (static expected booleans in script output):

| Check ID | Assertion |
|----------|-----------|
| S1 | HTML does not include `id="btnNewChatTop"` |
| S2 | HTML includes `id="btnSidebarToggle"` |
| S3 | HTML includes `class="topbar-sidebar-toggle"` (after implementer adds) |
| S4 | `messages.css` (built asset or source read) contains `.stream-status` |
| S5 | `npm run build` already run — optional re-invoke via `child_process` |

### Regression

- Re-run existing: `npx tsx scripts/sa16-smoke.mjs http://localhost:<port>` — must stay **PASS** (no tool API changes).

### `package.json` script (implementer adds)

```json
"test": "node --test test/ui/*.test.mjs"
```

---

## Implementer + verifier workflow

### Implementer agent

1. Read **Read first** table and this plan’s **Problem analysis**.
2. Implement tasks in order: **top bar → stream-status module → messages/thoughts → loop/chat → CSS → tests → context.md**.
3. Create [`documentation/plans/verification/step-01.md`](../verification/step-01.md) with:
   - Exact commands run
   - Exit codes
   - Manual U1–U8 results
4. Run locally:
   - `npm run build`
   - `npm test` (or documented equivalent)
   - `npx tsx scripts/step01-ui-smoke.mjs http://localhost:<port>` (with `npm start`)
   - `npx tsx scripts/sa16-smoke.mjs http://localhost:<port>`
5. Update [`documentation/context.md`](../../context.md).
6. **Do not** mark step complete — hand off to verifier.

### Verifier agent (separate session)

1. Read **Acceptance criteria** only (+ verification file).
2. Re-run all commands from verification file; **do not** implement features.
3. Spot-check `index.html` and one streaming manual test (U3 or U4).
4. Report **PASS** or **FAIL** with logs; on FAIL, return to implementer.

### Manual QA (verification file U1–U8)

| ID | Steps | Pass |
|----|-------|------|
| U1 | Desktop width: top bar has no new-chat icon; sidebar **+ New chat** creates session | |
| U2 | Desktop: no hamburger; sidebar chevron collapses/expands rail | |
| U3 | Mobile ≤640px: hamburger opens chat drawer; backdrop closes | |
| U4 | Non-reasoning model: send message → **Generating response…** until text appears | |
| U5 | Reasoning model + LM Studio dev setting: **Thinking…** / thought bubbles, then **Generating response…**, then prose | |
| U6 | Tool-capable model with tools enabled: after tool row, next turn shows generating state (no blank gap) | |
| U7 | Attach 2+ chips: spacing between chips, textarea, send looks even | |
| U8 | `prefers-reduced-motion: reduce` (OS or DevTools): no distracting pulse; labels still visible | |

### Tool-usage-verification checklist (subset)

From [`tool-usage-verification.md`](../tool-usage-verification.md), re-validate after Step 01:

- [ ] **Build:** `npm run build` — PASS
- [ ] **Smoke:** `sa16-smoke.mjs` — PASS
- [ ] **A1** paperclip still present
- [ ] **A6** attachments clear on successful send only (unchanged behavior)
- [ ] No regression to drawer tools section

---

## Risks and mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Removing top-bar new chat on small phones | Users might not discover sidebar | Sidebar opens via hamburger; **+** compact button on rail when collapsed |
| Hiding desktop hamburger breaks keyboard users | Lost shortcut to expand rail | Desktop `#btnSidebarCollapse` remains focusable |
| Double status (thought bubble + label) | Visual noise | Show **Thinking…** only until first thought bubble mounts, or keep both with clear hierarchy (status smaller, thought primary) |
| Tool-loop second row leaks old status | Duplicate nodes | Always call `dispose()` on previous handle when removing `wrap` |
| Tests flake without DOM impl | CI fails | Pin happy-dom version; avoid timers in tests |
| CSS `display:none` on bubble still hides cursor during await | Confusion | Status is **outside** bubble (required) |
| Scope creep into settings/topbar toggles (backlog 30) | Delayed delivery | Defer per Step 20 |

---

## `documentation/context.md` updates (implementer)

Add under **Message rendering**:

- **Live stream phases:** `generating` → optional `thinking` (reasoning SSE) → `generating` (post-reasoning, pre-prose) → `prose`.
- **DOM:** `.stream-status` sibling before assistant bubble; hidden after `revealAssistantProseBubble`.
- **Top bar:** `#btnNewChatTop` removed; `#btnSidebarToggle` mobile-only; new chat via sidebar only.

Add under **Layout** or **Hardening**:

- One sidebar collapse control per viewport width.

---

## Suggested commit message (when user requests commit)

```
✨ polish(chat): composer spacing, top bar cleanup, stream status labels
```

---

## References

- [`documentation/plans/to-fix.md`](../to-fix.md) — items 16, 17, 26, 27, 28
- [`documentation/plans/thought-bubbles-ui.md`](../thought-bubbles-ui.md) — reasoning prerequisites
- [`PRODUCT.md`](../../../PRODUCT.md) / [`DESIGN.md`](../../../DESIGN.md) — product and visual rules
