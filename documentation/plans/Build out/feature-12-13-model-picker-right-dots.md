# Feature 12–13: Model picker far right + loaded/unloaded dots

**Feature ID:** `feature-12-13-model-picker-right-dots`  
**Backlog:** [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) — Epic A, **A4**  
**To-fix:** [`documentation/plans/to-fix.md`](../to-fix.md) lines 12–13 — move model select far right; remove model/loaded count from status; restore loaded/unloaded dots  
**Wave:** 1 (Top bar polish; ships before Wave 7 **A3** load/unload — Phase 4 hooks A3 when available)  
**Size:** M  
**Status:** Implemented  
**Depends on:** **A1** (`feature-01-topbar-grouped-actions`), **A2** (`feature-10-model-display-names`); **coordinates with A3** (`feature-11-12-load-unload-model`) for dot refresh after load/unload (not blocking v1 layout + dot)

---

## Summary

Move the model `<select>` to the **far right** of the top bar (immediately left of the status pill), stop using the status pill as a model inventory readout (`"N models, M loaded"`), and restore **green / grey dots** that reflect each model’s `state` (`loaded` vs not). The status pill (`sDot` / `sText` via `setStatus`) remains for **transient app feedback** only: loading, errors, workspace changes, streaming, settings saves—not model counts or per-model load state.

---

## Problem statement

| Area | Today | Problem |
|------|--------|---------|
| **Layout** | `index.html` order: brand → sidebar → workspace → **model** → files → refresh → terminal → settings → status. `.model-wrap` has `flex: 1` in `topbar.css`, so the picker grows in the **middle** of the bar while `.status-pill` uses `margin-left: auto`. | Model control does not read as “far right”; actions and picker are visually split. |
| **Status pill** | After a successful `fetchModels()`, `models.ts` calls `setStatus('ok', \`${models.length} models, ${nLoaded} loaded\`)`. | Redundant once load state is shown on the picker; clutters the only global status channel. |
| **Load state UX** | Options render `` `${m.id}${tag} (${stateLabel})` `` with `stateLabel` = `loaded` / `not loaded`. No dedicated dot UI. | Text-heavy dropdown; backlog asks for circles like earlier product intent (dots), not `(loaded)` suffixes once A2 friendly names land. |
| **Chevron** | `.model-wrap::after` draws a dropdown triangle at `right: 12px`. | Competes with space for a **left-aligned state dot** inside the control. |

---

## Goals

1. **Topbar order (with A1):** `brand` (left) → **grouped icon actions** → **`topbar-end`**: model picker → status pill (right edge).
2. **Model picker position:** Rightmost interactive control before the status pill; no `flex: 1` growth into the center.
3. **State dots:** Visible **loaded** = green (`--success`), **unloaded** = grey (`--text-muted`); driven by `LmModelRecord.state === 'loaded'` from `modelCache`.
4. **Status pill scope:** Remove model-count success message; keep spin/err during fetch; leave other `setStatus` call sites unchanged (workspace, chat loop, settings, etc.).
5. **Accessibility:** Selected model load state exposed to assistive tech (e.g. `aria-label` on the select or `title` on the dot).

## Non-goals

- Implementing load/unload buttons (A3)—only **refresh dot** after A3 calls `fetchModels()`.
- Friendly display names (A2)—plan assumes option **values** stay canonical `m.id`; label formatting is A2’s module.
- Custom combobox / full redesign of model selection (optional stretch; not required for acceptance).
- Changing provider APIs or `fetch-models.ts` normalization.

---

## Schema / API / migration

| Area | Change |
|------|--------|
| `config.json` / session schema | **None** |
| Server / provider APIs | **None** — reads existing `LmModelRecord.state` from list endpoint |
| Migrations | **None** |

---

## Target UX

### Desktop / tablet (≥641px)

```text
[logo] Minnow  |  [≡][folder][file][↻][>_][⚙]     ·············     [●] [Model name ▼]  [● Ready]
 ^brand block^     ^topbar-actions (A1 cluster)^   ^flex spacer^   ^model-wrap^      ^status-pill^
```

- **Green dot** when the **selected** model is loaded.
- **Grey dot** when the selected model is not loaded (or `state` missing / unknown).
- Status text examples after model refresh: `Ready` (ok), or empty with `idle` dot—**not** `12 models, 3 loaded`.
- During fetch: status `spin` + `Loading models…` (unchanged).

### Mobile (≤600px)

- Same **relative order** inside `topbar-end`: dot + select, then compact status (existing `max-width` ellipsis on `#sText`).
- `responsive.css` rules updated for `.topbar-end` / `.model-wrap` instead of only `.model-wrap { max-width: none }`.

---

## Current implementation reference

### `index.html` (`header.topbar`)

- Model block at lines 116–119 (between workspace and file-tree buttons).
- Status pill at lines 139–142 with `margin-left: auto` behavior from CSS.

### `src/styles/topbar.css`

- `.model-wrap { flex: 1; max-width: 340px; }` — root cause of center-weighted picker.
- `.model-wrap::after` — chevron pseudo-element.
- `.status-pill { margin-left: auto; }` — should move to parent `.topbar-end` after refactor.

### `src/api/models.ts`

- `fetchModels()` populates `#modelSelect`, fills `modelCache`, sets count status on success (line 88).
- Option template includes `(loaded)` / `(not loaded)` in label text (lines 65–71).
- `showCachedModelInfo()` reads select value + cache for stats strip only.

### `src/ui/status.ts`

- `setStatus(state, msg)` toggles `#sDot` classes (`ok` | `err` | `spin`; default grey when no modifier).
- `idle` is used elsewhere (e.g. mode selector) with empty message—no `.s-dot.idle` in CSS today (falls back to default grey).

### Data model

- `LmModelRecord.state` in [`src/types.ts`](../../../src/types.ts); LM Studio list uses `'loaded'`; OpenAI-v1 normalize defaults `state: 'loaded'` in [`src/providers/fetch-models.ts`](../../../src/providers/fetch-models.ts).

---

## Design decisions

### 1. Layout: `topbar-end` wrapper (coordinate with A1)

After **A1**, the topbar is three zones: `.topbar-brand` | `.topbar-actions` | `.topbar-spacer` + `.topbar-end`. A4 only changes **inside** `.topbar-end` and model CSS; it does not reorder the action cluster.

```html
<div class="topbar-spacer" aria-hidden="true"></div>
<div class="topbar-end">
  <div class="model-wrap" data-model-state="loaded|unloaded|unknown">
    <span class="model-state-dot" id="modelStateDot" aria-hidden="true"></span>
    <label class="visually-hidden" for="modelSelect">Model</label>
    <select id="modelSelect" onchange="onModelSelectChange()"></select>
  </div>
  <div class="status-pill" role="status" aria-live="polite">
    <div class="s-dot" id="sDot" aria-hidden="true"></div>
    <span id="sText">Loading models…</span>
  </div>
</div>
```

If A1 is not merged yet, land the same structure in one PR (see [`feature-01-topbar-grouped-actions.md`](feature-01-topbar-grouped-actions.md)).

CSS sketch:

```css
.topbar-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.topbar-end {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  flex-shrink: 0;
  min-width: 0;
}
.model-wrap { flex: 0 1 auto; max-width: 340px; min-width: 120px; }
.status-pill { margin-left: 0; }
```

If A1 lands first, extend its markup/CSS rather than duplicating cluster work.

### 2. State dot: selected-row only (recommended for M)

Native `<option>` styling for per-row dots is **inconsistent** across browsers. Ship:

- A `<span class="model-state-dot" id="modelStateDot" aria-hidden="true">` inside `.model-wrap`, **left of** the `<select>`.
- `data-state="loaded|unloaded|unknown"` on `.model-wrap` for CSS modifiers.
- JS helper updates dot whenever selection or cache changes.

**Stretch (optional):** Custom listbox in a follow-up if product requires dots in the **open** list; defer unless A2’s custom dropdown is already introduced.

### 3. Option labels vs dots

After A2, option text should be **display name only** (no `(loaded)` suffix). Until A2 ships, this feature may still remove `(not loaded)` / `(loaded)` text when the dot is present to avoid duplication—**coordinate in implementation order: A2 label helper + A4 dot in same PR or A2 immediately before A4.**

### 4. Chevron vs dot

- Move chevron: keep `::after` but increase select **left padding** (e.g. `padding-left: 28px`) for dot; shift chevron if needed (`right: 10px`).
- Or replace `::after` with an inline SVG chevron in markup if pseudo-element collision is awkward.

### 5. Post-fetch status message

Replace:

```ts
setStatus('ok', `${models.length} models, ${nLoaded} loaded`);
```

With one of (pick one and use consistently):

| Option | Call | Rationale |
|--------|------|-----------|
| **A (recommended)** | `setStatus('ok', 'Ready')` | Matches [`src/tools/loop.ts`](../../../src/tools/loop.ts) success path. |
| **B** | `setStatus('idle', '')` | Clears text; dot on picker carries load semantics. |

Do **not** reintroduce counts in `sText`. `nLoaded` variable can be deleted if unused.

### 6. Module placement

New small module keeps `models.ts` focused on fetch/populate:

- [`src/ui/model-state-dot.ts`](../../../src/ui/model-state-dot.ts) — `updateModelStateDot(modelId?: string): void`, `isModelLoaded(record?: LmModelRecord): boolean`.

Export `updateModelStateDot` for `sidebar.ts`, future A3 load/unload handler, and tests.

---

## Implementation plan

### Phase 0 — Prerequisites checklist

- [ ] **A1** merged or done in same branch: `topbar-actions` + `topbar-end` structure in `index.html`.
- [ ] **A2** `format-model-label.ts` (or equivalent) available for option labels.
- [ ] **A3** load/unload triggers `fetchModels()` or `updateModelStateDot` after success.

### Phase 1 — Markup and CSS (layout + dot chrome)

- [ ] Reorder `index.html` so `#modelSelect` lives inside `.topbar-end` after the action cluster.
- [ ] Add `#modelStateDot` (or `.model-state-dot`) before `<select id="modelSelect">`.
- [ ] Update `topbar.css`: remove `flex: 1` from `.model-wrap`; add `.topbar-end`, `.topbar-actions`; dot rules:

```css
.model-state-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--text-muted);
}
.model-wrap[data-model-state="loaded"] .model-state-dot { background: var(--success); }
.model-wrap[data-model-state="unloaded"] .model-state-dot { background: var(--text-muted); }
```

- [ ] Adjust `.model-wrap` to `display: flex; align-items: center; gap: 8px;`.
- [ ] Update `responsive.css` breakpoints for `.topbar-end` / narrow widths (preserve ≤380px refresh hide).

### Phase 2 — `model-state-dot.ts` + wiring

- [ ] Implement `isModelLoaded(record?: LmModelRecord): boolean` — true only when `record?.state === 'loaded'`.
- [ ] Implement `updateModelStateDot(modelId?: string)`:
  - Resolve id from arg or `#modelSelect` value.
  - Lookup `modelCache.get(id)`.
  - Set `data-model-state` on `.model-wrap` to `loaded` | `unloaded` | `unknown` (no selection / empty cache).
  - Set `title` on dot: e.g. `Loaded in LM Studio` / `Not loaded` (provider-agnostic wording).
  - Mirror into `select` `aria-label`: `Model: {displayName}, loaded` (use A2 formatter when present).
- [ ] Call `updateModelStateDot()` at end of `fetchModels()` success path (after selection resolved).
- [ ] Call from `onModelSelectChange()` in [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts).
- [ ] Call from `syncModelSelectForActiveChat()` after value sync.
- [ ] Remove `setStatus('ok', … models, … loaded)` from [`src/api/models.ts`](../../../src/api/models.ts); apply chosen default (Phase 0 table).
- [ ] Remove `(loaded)` / `(not loaded)` from option `innerHTML` when A2 labels are wired (single source: dot + friendly name).

### Phase 3 — `status.ts` hygiene (optional but recommended)

- [ ] Add typed union `StatusState = 'idle' | 'ok' | 'err' | 'spin'` on `setStatus` parameter.
- [ ] Add `setReadyStatus()` helper wrapping `setStatus('ok', 'Ready')` to avoid string drift.
- [ ] Document in comment on `setStatus`: topbar pill is for **operational messages**, not model inventory.

### Phase 4 — A3 integration hook

- [ ] After load/unload success in A3 handler, ensure `fetchModels()` or at minimum `updateModelStateDot()` runs so dot matches server `state`.
- [ ] While load/unload in flight, optional `setStatus('spin', 'Loading model…')` on status pill (A3-owned); clear back to `Ready` on completion.

---

## File change matrix

| File | Changes |
|------|---------|
| [`index.html`](../../../index.html) | `topbar-actions`, `topbar-end`, `#modelStateDot`, move model + status |
| [`src/styles/topbar.css`](../../../src/styles/topbar.css) | Layout, dot, select padding, chevron position |
| [`src/styles/responsive.css`](../../../src/styles/responsive.css) | Mobile `topbar-end` / model width |
| [`src/api/models.ts`](../../../src/api/models.ts) | Option build, drop count status, call `updateModelStateDot` |
| [`src/ui/model-state-dot.ts`](../../../src/ui/model-state-dot.ts) | **New** — dot sync logic |
| [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts) | `onModelSelectChange`, `syncModelSelectForActiveChat` → dot update |
| [`src/ui/status.ts`](../../../src/ui/status.ts) | Optional helpers / types |
| [`documentation/context.md`](../../context.md) | Note topbar layout + model state dot (post-implementation) |

---

## Build

Must pass before merge (same gate as other Wave 1 UI features):

```bash
npm run build    # tsc && vite build
npm test
```

No new runtime dependencies. `index.html` markup changes ship through Vite; no `server.js` changes for this feature.

---

## Testing plan

### Automated

| Test | Path | Assert |
|------|------|--------|
| `isModelLoaded` / `resolveModelState` | `test/ui/model-state-dot.test.mts` | `state: 'loaded'` → loaded; `undefined` / `'not-loaded'` → unloaded; missing cache → unknown |
| `fetchModels` status side effect | `test/api/models-status.test.mts` (or mock DOM) | Success path does **not** set text matching `/\d+ models/` |
| Topbar structure fixture | extend [`test/fixtures/feature01/topbar-zones.json`](../../../test/fixtures/feature01/topbar-zones.json) or new `test/fixtures/topbar-model-end.html` | `#modelSelect` inside `.topbar-end` after action cluster; `#modelStateDot` present |

Run: `npm test`.

### Manual QA

1. `npm start`, LM Studio running with mix of loaded and unloaded models.
2. Confirm topbar: actions grouped left-of-end; model select abuts status pill on the right.
3. Select a loaded model → **green** dot; select unloaded → **grey** dot.
4. Refresh models → status shows `Loading models…` then `Ready` (or idle)—**never** `N models, M loaded`.
5. Trigger workspace change → status shows workspace message; dot unchanged and still correct for selection.
6. Send chat → status shows `Generating reply…` / `Ready`; dot still reflects model `state`.
7. Mobile width 375px: dot visible, select truncates, status text ellipsized.
8. With A3: load/unload model → dot updates without requiring manual refresh (if API returns new `state`).

---

## Acceptance criteria (backlog A4 + edge cases)

### Functional

1. Model control is **rightmost** interactive control before the compact status pill (inside `.topbar-end`, after `.topbar-actions` / spacer).
2. **Green** dot when selected model `state === 'loaded'`; **grey** when not loaded or unknown.
3. Status pill **never** shows model inventory (`N models, M loaded`) after successful `fetchModels()`.
4. Status pill still shows operational messages: loading models, errors, workspace, streaming, settings (existing `setStatus` callers).
5. `onModelSelectChange` and `syncModelSelectForActiveChat` keep dot in sync with selection.
6. Option labels do not duplicate load state as `(loaded)` / `(not loaded)` once A2 formatter is wired (dot is source of truth).
7. `aria-label` / `title` on select or dot reflects load state for the selected model.

### Technical

8. `npm run build` exits 0.
9. `npm test` passes, including new `model-state-dot` tests; `fetchModels` error paths unchanged (`Cannot reach {provider}`, empty list).
10. [`documentation/context.md`](../../context.md) updated after ship (topbar layout + model state dot).

### Verifier sign-off

Report **PASS** only if criteria **1–10** hold and manual **U1–U8** in [`documentation/plans/verification/feature-12-13.md`](../verification/feature-12-13.md) are checked in a clean session (implementer and verifier may differ).

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| A1 markup conflict | Implement A4 against A1 branch or land A1 first; only add dot + drop count status if blocked. |
| Duplicate state (A2 text + dot) | Remove `(loaded)` suffix when dot ships; document in A2 plan. |
| OpenAI-v1 providers always `loaded` | Dot always green; acceptable per `normalizeModelsForUi`. |
| `select` accessibility | Update `aria-label` when dot/title changes; keep visible `<label for="modelSelect">`. |
| Chevron overlaps dot | Flex layout + padding; test Firefox + Safari. |

---

## Open questions (resolve before coding)

1. **Post-fetch idle message:** `Ready` vs empty `idle`—product preference? Default: **`Ready`** for parity with chat loop.
2. **Per-option dots in dropdown:** required for v1? Default: **selected-row only**; revisit with custom listbox if users ask.
3. **A1 split:** If A1 not ready, minimal A4 layout change: move model DOM after settings + `topbar-end` without full action regroup—acceptable interim?

---

## Implementation todos

| ID | Task | Owner phase |
|----|------|-------------|
| T1 | Align with A1 `topbar-actions` / `topbar-end` markup in `index.html` | Phase 0–1 |
| T2 | CSS: remove model `flex:1`, style `model-state-dot`, fix chevron/padding | Phase 1 |
| T3 | Add `src/ui/model-state-dot.ts` + unit tests | Phase 2 |
| T4 | Wire `fetchModels`, `onModelSelectChange`, `syncModelSelectForActiveChat` | Phase 2 |
| T5 | Remove model count `setStatus`; strip `(loaded)` from options per A2 | Phase 2 |
| T6 | Update `responsive.css` for mobile topbar-end | Phase 1 |
| T7 | A3 callback refreshes dot after load/unload | Phase 4 |
| T8 | `npm run build` + `npm test` green | Build gate |
| T9 | Manual QA + update `documentation/context.md` topbar section | Done gate |
| T10 | Add `documentation/plans/verification/feature-12-13.md` sign-off checklist | Done gate |

---

## Related plans

| ID | Title |
|----|--------|
| A1 | `feature-01-topbar-grouped-actions` |
| A2 | `feature-10-model-display-names` |
| A3 | `feature-11-12-load-unload-model` |

---

## Verifier handoff

[`documentation/plans/verification/feature-12-13.md`](../verification/feature-12-13.md) contains:

- **Plan audit** — backlog A4 + agent deliverable template (pre-implementation)
- **Commands** — `npm run build`, `npm test`
- **Automated** — table from § Testing plan
- **Manual U1–U8** — from § Manual QA
- **Implementation result** — PASS/FAIL when shipped

## Verification record (implementation)

| Date | Result | Notes |
|------|--------|-------|
| 2026-05-20 | PASS | Model picker in `.topbar-end` with `#modelStateDot`; status `Ready` after fetch |
