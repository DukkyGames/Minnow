---
name: BUG-017 — Model picker truncation
overview: Fix top-bar model combobox so long model names are readable in the closed trigger and in the open menu, without breaking topbar layout on narrow viewports.
source: documentation/bug-hunt-session-2026-05-24.md (BUG-017)
status: shipped
severity: minor
todos:
  - id: repro-baseline
    content: Reproduce with a long canonical id (e.g. qwen/qwen3.6-35b-a3b) and capture trigger vs menu vs tooltip behavior
    status: completed
  - id: product-decision
    content: Confirm chosen UX (recommended hybrid below) — trigger readability + full labels in open menu
    status: completed
  - id: css-trigger
    content: Adjust trigger label CSS and/or .model-wrap width flex so closed state shows more of formatModelLabel optionText
    status: completed
  - id: css-menu
    content: Remove or relax ellipsis on .model-select-option-label; ensure menu min-width shows full row text
    status: completed
  - id: layout-topbar
    content: Reconcile .model-wrap max-width (340px / 380px) with .topbar-end flex so picker can grow without crowding status pill
    status: completed
  - id: a11y-tooltips
    content: Verify title tooltips on trigger and rows remain full canonical id + quant/load after CSS changes
    status: completed
  - id: tests
    content: Extend model-select-picker / topbar tests for long labels and menu non-truncation expectations
    status: completed
  - id: docs-context
    content: Update documentation/context.md top-bar model row bullet when shipped; mark BUG-017 resolved in bug-hunt doc
    status: completed
isProject: false
---

# BUG-017 — Model picker truncates name (ellipsis)

**Tracker:** [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — BUG-017 (Minor, Open)  
**Architecture ref:** [context.md](../../context.md) — Top bar model row, `formatModelLabel`, custom combobox

---

## Summary

The top-bar **model combobox** shows humanized labels (e.g. `Qwen3.6 35B a...`) with **CSS ellipsis** instead of letting users read the full friendly name or canonical id in the **closed trigger**. The open dropdown **also** ellipsizes row labels. Native `title` tooltips already expose the full id + metadata on hover, but the bug report expects the **visible** label to be readable without relying on hover alone.

**No implementation in this document** — plan only.

---

## Verification log (2026-05-24)

| Item | Result |
|------|--------|
| Bug still present in `main` | **Yes** — ellipsis CSS unchanged |
| Root cause matches plan | **Yes** — intentional CSS + width cap, not label pipeline |
| `formatModelLabel` / `syncModelSelectPicker` | Full `optionText` in DOM; `title` has canonical id + quant + load |
| Fixture long label | `Qwen3.6 27B · Q4_K_M` (23 chars) — exceeds ~340px trigger budget with padding/chevron |
| Automated guard | **None** — `model-select-picker.test.mts` asserts dots/titles only, not visible truncation |
| Related Linear | MIN-7 (Done) — hover contrast; **did not** remove menu/trigger ellipsis |

**Linear:** [MIN-62](https://linear.app/minnowai/issue/MIN-62/bug-017-model-picker-truncates-name) — priority Medium (3), labels `bug`, `ui`.

---

## Reproduction

| Step | Action |
|------|--------|
| 1 | Run Minnow with `npm start` and an LM Studio (or compatible) provider that lists a model with a **long** id or humanized label (e.g. `qwen/qwen3.6-35b-a3b` → `Qwen3.6 35B A3b` + optional quant suffix). |
| 2 | Select that model in the top-bar picker. |
| 3 | Observe the **closed** trigger (`#modelSelectTriggerText`) in `.topbar-end`. |
| 4 | Open the menu (`#modelSelectMenu`) and compare row labels to trigger text. |
| 5 | Hover trigger and a menu row — confirm `title` shows full canonical id (already wired in [`syncModelSelectPicker`](../../../src/ui/model-select-picker.ts)). |

**Expected (product):** Full model name readable in the control and/or menu without ellipsis clipping essential text.  
**Actual:** Ellipsis on trigger (and typically on menu rows) within a capped-width `.model-wrap`.

---

## Root cause (confirmed in code)

Truncation is **intentional CSS**, not a missing label pipeline.

| Layer | File | Mechanism |
|-------|------|-----------|
| Closed trigger text | [`src/styles/model-select.css`](../../../src/styles/model-select.css) `.model-select-trigger-text` | `overflow: hidden; text-overflow: ellipsis; white-space: nowrap` |
| Menu row label | Same file `.model-select-option-label` | Same ellipsis + `flex: 1; min-width: 0` |
| Width cap | [`src/styles/topbar.css`](../../../src/styles/topbar.css) `.model-wrap` | `max-width: 340px` (380px at `min-width: 900px` in [`responsive.css`](../../../src/styles/responsive.css)) |
| Flex shrink | `.model-wrap` | `flex: 0 1 auto; min-width: 0` inside `.topbar-end` |
| Label source | [`src/lib/format-model-label.ts`](../../../src/lib/format-model-label.ts) | `optionText` is already shortened vs raw id; truncation still applies when text exceeds pixel budget |
| DOM sync | [`src/ui/model-select-picker.ts`](../../../src/ui/model-select-picker.ts) | `triggerText.textContent = selectedOpt.text`; `title` from `option.title` or value |

The hidden native `#modelSelect` is visually hidden; the custom trigger is what users see ([`index.html`](../../../index.html) — `.model-select-native` + `#modelSelectTrigger`).

**Already in place (do not regress):**

- `formatModelLabel` builds `title` with full id, quant, and load state ([`buildModelOptionHtml`](../../../src/api/models.ts)).
- `syncModelSelectPicker` copies `title` to `#modelSelectTriggerText` and each `.model-select-option` / `.model-select-option-label`.
- Menu `min-width: max(100%, 20rem)` widens the popover vs the trigger but **does not** disable ellipsis on row labels.

---

## Design constraints

1. **Top bar density:** `.topbar-end` shares space with refresh button, optional Load/Unload, and `.status-pill` ([`topbar.css`](../../../src/styles/topbar.css)). Uncapped width can squeeze workspace/actions on tablet.
2. **Bench-instrument look:** Picker styling follows DESIGN.md / single-line inputs — any multi-line trigger affects `--topbar-h` alignment.
3. **Mobile:** `@media (max-width: 640px)` removes `.model-wrap` max-width cap but keeps ellipsis on text ([`responsive.css`](../../../src/styles/responsive.css)).
4. **Accessibility:** Keep `aria-labelledby`, listbox roles, and meaningful `title` / focus behavior; if visible text grows, ensure focus ring and chevron (`::after`) still align.
5. **Canonical id vs display:** `option value` and `chat.modelId` stay canonical; only **display** changes.

---

## Recommended approach (hybrid)

Prefer a **two-surface** fix: optimize the **closed** trigger for the common case, and guarantee **full text in the open menu** (where users pick models).

| Surface | Recommendation | Rationale |
|---------|----------------|-----------|
| **Open menu** | Remove `text-overflow: ellipsis` on `.model-select-option-label`; allow `white-space: normal` (wrap) or `nowrap` with `overflow: visible` and let menu grow to `max-content` up to a sensible `max-width` (e.g. `min(90vw, 32rem)`) | Selecting a model is the primary place to read full names; matches bug steps |
| **Closed trigger** | Increase usable width: raise `.model-wrap` max-width modestly on desktop (e.g. 340→420px band) **or** let `.model-select-inner` use `flex: 1` with a higher `min-width` inside `.topbar-end` while `status-pill` gets `flex-shrink: 1` + ellipsis | Improves everyday readability without exploding top bar |
| **Trigger ellipsis** | Keep single-line ellipsis on trigger **only if** still needed after width tweak; optional follow-up: show `primary` only in trigger and quant in `title` (data already in `formatModelLabel`) | Shorter visible string without losing metadata in tooltip |
| **Tooltips** | Keep as secondary affordance (required for canonical id when display is shortened) | Low cost; already implemented |

**Defer unless needed:** marquee-on-hover, expandable trigger height (two lines), or horizontal scroll inside trigger — higher UX/layout risk for minor severity.

---

## Alternatives considered

| Option | Pros | Cons |
|--------|------|------|
| Tooltip only | Zero layout risk | Does not satisfy “full name visible”; fails keyboard/touch users |
| Remove all ellipsis | Full text everywhere | Top bar overflow; status pill and actions collide |
| Widen trigger only | Simple CSS | Menu rows still clipped if ellipsis left on `.model-select-option-label` |
| Shorter labels in `formatModelLabel` | Less truncation | Hides quant in visible UI; may confuse users who rely on quant in label |
| `title` on trigger only | Already done | Bug explicitly calls out closed label |

---

## Implementation plan (when approved)

### Phase 1 — Menu (highest impact)

1. In [`model-select.css`](../../../src/styles/model-select.css), update `.model-select-option-label` (and optionally `.model-select-menu`):
   - Drop ellipsis; allow wrap **or** `white-space: nowrap` with menu `width: max-content; max-width: min(90vw, 32rem)`.
   - Ensure selected/hover row height accommodates wrapped text (`align-items: flex-start` if wrapping).
2. Manually verify long quant strings (`Q4_K_M`) and loaded dot alignment.

### Phase 2 — Trigger width and ellipsis

1. In [`topbar.css`](../../../src/styles/topbar.css) / [`responsive.css`](../../../src/styles/responsive.css):
   - Tune `.model-wrap` / `.model-select-inner` flex and `max-width` so trigger gains ~20–30% readable width on desktop without overlapping `.topbar-actions`.
   - Consider `status-pill` `min-width: 0` + ellipsis on `#sText` if status copy competes (pattern already used for long status messages per context.md).
2. Re-evaluate whether `.model-select-trigger-text` still needs ellipsis after width change; relax only if layout tests pass.

### Phase 3 — Optional label split (if still truncated)

1. In [`model-select-picker.ts`](../../../src/ui/model-select-picker.ts) (or `formatModelLabel` consumer), set trigger text to `primary` only while menu rows keep full `optionText` — only if product agrees quant can move to tooltip-only on trigger.

### Phase 4 — Tests and docs

1. [`test/ui/model-select-picker.test.mts`](../../../test/ui/model-select-picker.test.mts): fixture with a long `optionText`; assert menu label text is present in full in DOM (no `…` in `textContent` for menu; define trigger expectation after CSS choice).
2. Optional: happy-dom `getComputedStyle` check that menu label does not use `text-overflow: ellipsis` (brittle but guards regression).
3. Smoke: `test/ui/topbar-layout.test.mjs` unchanged structurally; visual check at 641px and 900px breakpoints.
4. Update [context.md](../../context.md) top-bar bullet (remove/improve “reduces ellipsis clipping” wording to match actual behavior).
5. Mark BUG-017 **Fixed** in [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md).

---

## Files to touch (implementation)

| File | Change |
|------|--------|
| [`src/styles/model-select.css`](../../../src/styles/model-select.css) | Menu label overflow; possible menu width |
| [`src/styles/topbar.css`](../../../src/styles/topbar.css) | `.model-wrap` / `.topbar-end` flex balance |
| [`src/styles/responsive.css`](../../../src/styles/responsive.css) | Breakpoint-specific max-width |
| [`src/ui/model-select-picker.ts`](../../../src/ui/model-select-picker.ts) | Only if trigger/menu label split |
| [`test/ui/model-select-picker.test.mts`](../../../test/ui/model-select-picker.test.mts) | Regression coverage |
| [`documentation/context.md`](../../context.md) | Shipped behavior note |
| [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) | Status → Fixed |

**Out of scope:** Settings model routing selects (`.settings-select`), fork dialog, Reef widget model binding — different components; file only if same ellipsis pattern is reported there.

---

## Verification checklist

- [ ] Long model id: closed trigger shows materially more characters than before (or full `optionText` if width allows).
- [ ] Open menu: each row shows **full** `optionText` without mid-string `…`.
- [ ] Hover: `title` still shows canonical id + quant + load state on trigger and rows.
- [ ] Narrow viewport (≤640px): no horizontal scroll on entire top bar; menu remains usable.
- [ ] Desktop (≥900px): status pill and topbar action icons remain visible and clickable.
- [ ] Load dot + chevron alignment unchanged for wrapped menu rows.
- [ ] `npm test` — `model-select-picker` and topbar layout tests pass.
- [ ] `npx tsc --noEmit` clean.

---

## Open questions (align before coding)

1. **Trigger vs menu priority:** Is fixing the **open menu** alone acceptable, or must the **closed** trigger show the entire string without ellipsis?
2. **Quant in visible label:** Should ` · Q4_K_M` stay in the trigger, or move to tooltip-only to reduce truncation?
3. **Max width budget:** What is the maximum acceptable width for `.model-wrap` on a 1280px-wide window before crowding workspace control?

---

## Related work

- **feature-12-13 (model-picker-right-dots):** Shipped — load dots and custom menu; ellipsis predates or accompanies that work.
- **BUG-002:** Benchmark streaming — unrelated; same top-bar model binding.
- **context.md** already notes menu `min-width: max(100%, 20rem)` — implementation should align documentation with actual non-truncating menu labels after fix.


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-62](https://linear.app/minnowai/issue/MIN-62/bug-017-model-picker-truncates-name)
