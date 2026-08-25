---
name: thinking-carrot-pulse
overview: Only the most recent "Thought for" carrot animates; all earlier thinking carrots stay static.
todos:
  - id: task-1
    title: Core pulse logic in thought-bubbles.ts
    status: pending
  - id: task-2
    title: Wire sync into render/finalize call sites
    status: pending
isProject: true
---

# Plan: only the current thinking carrot animates

## Context

In chat, every collapsed **"Thought for X.Xs"** toggle renders a caret (`▸`) that pulses. Today *all* of them animate at once, which is noisy. The user wants only the **current** (most recent) thinking carrot animated; earlier ones should be static.

**Root cause** — `src/ui/thought-bubbles.ts`:
- `renderThoughtsToggle()` (line 355–435) adds `thoughts-caret--pulse` to the caret whenever the toggle is collapsed (lines 390–391). Every collapsed toggle therefore pulses.
- The settled-toggle click handler (lines 413–424) re-adds `thoughts-caret--pulse` whenever a toggle is collapsed, so clicking any historical toggle makes it pulse.
- The live `ThoughtBubbleController.ensureThinkingPanel()` caret is created with `thoughts-caret--pulse` (line 250) — this is the *current* reasoning and is correct to pulse, but nothing de-pulses the previous turn's settled toggle when it appears.

The animation itself lives in `src/styles/thoughts.css` (`.thoughts-caret--pulse`, lines 70–72, with a `prefers-reduced-motion` override at 113–120). **No CSS change is needed** — the fix is purely about *which* elements receive the class.

**Fix model:** at most one caret pulses at a time — always the most recent reasoning indicator in DOM order (the live stage while reasoning is active, otherwise the newest settled toggle). A single `syncThoughtsCaretPulse(scope)` enforces this; it is called after history render, after each live-stage creation, after each settled-toggle creation, and on every expand/collapse.

## Key Files

| File | Role |
|------|------|
| `src/ui/thought-bubbles.ts` | `renderThoughtsToggle`, `ThoughtBubbleController` (live stage), new `syncThoughtsCaretPulse` + `thoughtsScopeFromEl` |
| `src/styles/thoughts.css` | `.thoughts-caret--pulse` animation (unchanged) |
| `src/ui/messages.ts` | `renderChatFromHistory` — replay path; call sync after full render |
| `src/tools/loop.ts` | `finalizeAndAnchorThinkingRound` + persist sites — streaming path; call sync after toggle creation |
| `src/api/chat.ts` | Non-streaming reply finalize (line 856); call sync after toggle creation |
| `test/ui/thought-bubbles.test.mjs` | happy-dom unit tests (extend) |

## Waves

- **Wave 1** — Task 1 (core logic, self-contained, fully unit-testable).
- **Wave 2** — Task 2 (wire the sync into the render/finalize call sites). Depends on Task 1.

---

## Task 1 — Core pulse logic in `thought-bubbles.ts`

**Build**
- Add `pulse?: boolean` to the `ThoughtsToggleOptions` interface (lines 350–353); default `false`.
- In `renderThoughtsToggle` (lines 388–395): only add `thoughts-caret--pulse` when `resolved.pulse === true && !expanded` (replace the unconditional `if (!expanded)` at 390–391).
- Add and export `syncThoughtsCaretPulse(scope: HTMLElement | null): void`:
  - Resolve the root (`scope`, or fall back to the active chat mount when `null`).
  - Collect all `.thoughts-caret` in the root (live + settled).
  - Remove `thoughts-caret--pulse` from every caret.
  - Take the last caret in DOM order; if it is **not** `thoughts-caret--expanded`, add `thoughts-caret--pulse` to it.
- Add and export `thoughtsScopeFromEl(el: HTMLElement): HTMLElement | null` → `el.closest('.msg')?.parentElement ?? null` (the mount that holds the `.msg` rows).
- Update the settled-toggle click handler (lines 413–424): after toggling `thoughts-caret--expanded`, call `syncThoughtsCaretPulse(thoughtsScopeFromEl(caret))` instead of directly toggling `thoughts-caret--pulse`.
- In `ThoughtBubbleController.ensureThinkingPanel` (the `!this.stageEl` branch, after the click listener at 266–269): call `syncThoughtsCaretPulse(thoughtsScopeFromEl(caret))` so the live stage becomes the only pulsing caret (de-pulsing the previous turn's settled toggle).
- In `syncExpandedState` (lines 300–304): after toggling `thoughts-caret--expanded`, call `syncThoughtsCaretPulse(thoughtsScopeFromEl(this.caretEl))` so expanding/collapsing the live stage re-evaluates the single-pulse invariant.

**Test** — extend `test/ui/thought-bubbles.test.mjs` (happy-dom):
- `renderThoughtsToggle(wrap, segs)` with no `pulse` → caret has **no** `thoughts-caret--pulse`.
- `renderThoughtsToggle(wrap, segs, { pulse: true })` → caret **has** `thoughts-caret--pulse`.
- Build a mount with three `.msg` rows each holding a settled toggle; call `syncThoughtsCaretPulse(mount)` → exactly the last caret has `thoughts-caret--pulse`, the other two do not.
- Expand the last toggle (dispatch `click`) → it loses `thoughts-caret--pulse`; collapse it again → it regains it.
- Create a live stage (`new ThoughtBubbleController(wrap)` + `appendReasoningDelta`) alongside a prior settled toggle → only the live caret pulses.

**Accept** — In a chat with multiple "Thought for" toggles, only the most recent carrot animates; the rest are static, and the live "Thinking…" stage remains the sole animation while reasoning is active.

---

## Task 2 — Wire sync into render/finalize call sites

**Depends on:** task-1

**Build**
- `src/ui/messages.ts` — import `syncThoughtsCaretPulse` (extend the line-100 import). In `renderChatFromHistory`, after the transcript render loop completes (just before `restoreChatScrollAnchor(scrollAnchor)` at line 582), call `syncThoughtsCaretPulse(area)`.
- `src/tools/loop.ts` — import `syncThoughtsCaretPulse` (extend the line-219 import). In `finalizeAndAnchorThinkingRound` (lines 1350–1365), after the `renderThoughtsToggle` / `anchorPersistedThoughtsOnRow` block, call `syncThoughtsCaretPulse(thoughtsScopeFromEl(opts.wrap))`. Do the same after the two persist-path `renderThoughtsToggle` calls (lines 2677 and 2776) using `thoughtsScopeFromEl(lastWrap)`.
- `src/api/chat.ts` — import `syncThoughtsCaretPulse` (extend the line-68 import). After the `renderThoughtsToggle` call (lines 855–859), call `syncThoughtsCaretPulse(thoughtsScopeFromEl(wrap))`.

**Test** — happy-dom:
- Mount a container with three `.msg` rows, each rendered through the same toggle-creation path the replay uses (`renderThoughtsToggle`), then call `syncThoughtsCaretPulse(container)` exactly as `renderChatFromHistory` will → assert exactly one `.thoughts-caret--pulse` remains (the last row).
- Run `npx tsc --noEmit` → no type errors from the new imports/calls.

**Accept** — After a multi-turn chat loads (or a new turn finalizes), exactly one thinking carrot animates — the newest — and earlier ones are static.

---

## Verification Checklist

- [ ] `npm test` — `test/ui/thought-bubbles.test.mjs` passes (new pulse/sync cases).
- [ ] `npx tsc --noEmit` — clean.
- [ ] Manual: open a chat with 3+ "Thought for" toggles → only the newest carrot pulses; expand/collapse it toggles the animation; earlier carrots are static.
- [ ] Manual: start a new turn with reasoning → the live "Thinking…" stage is the only animation; when it settles into "Thought for X.Xs", that newest toggle becomes the only animation and the prior one goes static.
- [ ] Manual: with `prefers-reduced-motion` on, no caret animates (existing CSS override still holds).