---
name: Feature 10 — Model display names
overview: Derive human-readable model labels from canonical LM Studio ids for the top-bar model select; keep option values and session modelId unchanged; expose loadState for A4 dots.
todos:
  - id: f10-formatter
    content: Add src/lib/format-model-label.ts (slug, humanize, formatModelLabel, buildModelOptionHtml)
    status: pending
  - id: f10-fixtures-tests
    content: Add test/fixtures/format-model-label.json and test/lib/format-model-label.test.mts; wire npm test
    status: pending
  - id: f10-integrate
    content: Refactor fetchModels() in src/api/models.ts to use buildModelOptionHtml
    status: pending
  - id: f10-verify-docs
    content: Manual UAT; documentation/plans/verification/feature-10.md sign-off; update context.md
    status: pending
isProject: false
---

# Feature 10 — Model display names

**Implementation build plan** for implementer and verifier sub-agents.

**Feature ID:** `feature-10-model-display-names`  
**Backlog:** [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) — Epic A, **A2**  
**To-fix:** [`documentation/plans/to-fix.md`](../to-fix.md) line 10 — “clean up model list names”  
**Wave:** 1 (Top bar and chat polish)  
**Size:** S  
**Status:** Implementation plan (not yet implemented)  
**Depends on:** None  
**Coordinate with:** **A1** (`feature-01-topbar-grouped-actions`) — same `#modelSelect` real estate; **A4** (`feature-12-13-model-picker-right-dots`) — will replace `(loaded)` text with status dots; keep `state` in formatter API for A4  
**Blocks:** **A3** (load/unload) and **A4** (picker layout) benefit from readable labels first  
**Prototype folder:** None — use [`documentation/context.md`](../../context.md), [`src/styles/topbar.css`](../../../src/styles/topbar.css)

---

## Overview

Replace raw LM Studio model paths in the top-bar `<select>` with **human-readable labels** derived from `id`, while preserving **canonical `modelId`** as `option value` and in session/chat state.

| User pain | Target outcome |
|-----------|----------------|
| Options look like file paths (`qwen/qwen3.6-27b · Q4_K_M (loaded)`) | Primary label reads like a product name (`Qwen3.6 27B`) |
| Hard to scan quant and load state in a wall of path text | Quant and state as compact suffixes; **full `id` on hover** via `title` |
| Same mental model as other local LLM UIs | Tooltip shows canonical id + quant + state for power users |

**Out of scope (other features):**

- Load/unload controls (**A3**)
- Moving picker to far right, removing `N models, M loaded` status copy, per-model green/grey dots (**A4**)
- Custom listbox / combobox component (Phase 2 — only if native `<select>` fails acceptance after ship)
- Provider API changes, `LmModelRecord` schema changes, settings-page model lists
- Renaming models server-side in LM Studio

---

## Problem

### Current rendering (`src/api/models.ts`)

```65:71:src/api/models.ts
    sel.innerHTML = models
      .map((m) => {
        const loaded = m.state === 'loaded';
        const tag = m.quantization ? ` · ${m.quantization}` : '';
        const stateLabel = loaded ? 'loaded' : 'not loaded';
        return `<option value="${m.id}">${m.id}${tag} (${stateLabel})</option>`;
      })
      .join('');
```

- **Visible text** equals raw `m.id` (often `vendor/slug-quant-params`).
- **Value** is correct (`m.id`) — must not change.
- **No `title`** on `<option>` — no hover affordance for full path.
- **innerHTML** interpolation: plan should **HTML-escape** `id` and label text when building options (defense in depth if provider returns odd characters).

### Layout constraints (`topbar.css`)

```49:72:src/styles/topbar.css
.model-wrap {
  position: relative;
  flex: 1;
  min-width: 0;
  max-width: 340px;
}

.model-wrap select {
  width: 100%;
  ...
  overflow: hidden;
  text-overflow: ellipsis;
}
```

Closed select truncates with ellipsis — shorter primary labels are desirable. Native `<option>` cannot style quant/state as muted spans; suffixes stay plain text until **A4** custom listbox (if any).

### Data available today (`LmModelRecord`)

| Field | Source | Use in labels |
|-------|--------|----------------|
| `id` | LM Studio / proxy | Parse → friendly primary; `value` + tooltip |
| `quantization` | API | Optional suffix (` · Q4_K_M`) |
| `state` | API | Suffix `(loaded)` / `(not loaded)` until **A4** dots |

No `display_name` field from API — labels are **derived client-side**.

---

## Design — `src/lib/format-model-label.ts`

Pure module (no DOM): unit-testable, reusable if settings or work-agent UI later lists models.

### Public API

```ts
/** Input for one model row in the picker. */
export interface ModelLabelInput {
  id: string;
  quantization?: string;
  state?: string;
}

/** Decomposed label parts for UI and tests. */
export interface ModelLabelParts {
  /** Humanized name from id slug, e.g. "Qwen3.6 27B". */
  primary: string;
  /** Quantization from API when present, e.g. "Q4_K_M". */
  quant?: string;
  /** Normalized load state for suffixes and A4 dots. */
  loadState: 'loaded' | 'not_loaded' | 'unknown';
  /** Text inside <option> (may include quant + state). */
  optionText: string;
  /** Native tooltip: full id + metadata. */
  title: string;
}

/** Strip vendor/path prefix and humanize the slug segment. */
export function slugFromModelId(id: string): string;

/** Turn slug into display primary (no quant/state). */
export function humanizeModelSlug(slug: string): string;

/** Full label pipeline for one model row. */
export function formatModelLabel(input: ModelLabelInput): ModelLabelParts;
```

### Parsing — `slugFromModelId(id)`

1. `trim()`; if empty → `''`.
2. If `id` contains `/`, take the **last** segment (handles `qwen/qwen3.6-27b` and rare deeper paths).
3. Else use full `id`.
4. Do **not** strip file extensions unless present in real ids (LM Studio ids rarely include `.gguf` in `id`).

### Humanize — `humanizeModelSlug(slug)`

Deterministic string rules (no network, no locale):

| Step | Rule | Example |
|------|------|---------|
| 1 | Lowercase slug for matching only; preserve version digits as in source | `qwen3.6-27b` |
| 2 | Split on `-` and `_` into tokens | `qwen3.6`, `27b` |
| 3 | **Brand token** (first token): if starts with known family prefix (`qwen`, `llama`, `mistral`, `gemma`, `phi`, `deepseek`, `codellama`, `granite`, `mixtral`, `nomic`), capitalize first letter only → `Qwen`, `Llama`, … | `qwen3.6` → `Qwen3.6` |
| 4 | **Size token**: trailing `b` with leading digits → uppercase `B` (`27b` → `27B`, `8b` → `8B`) | |
| 5 | **Version token**: leave `3.6`, `2.5`, `v01` as-is when embedded in brand token | `Qwen3.6` |
| 6 | Join tokens with single space | `Qwen3.6 27B` |
| 7 | Fallback: if no split helpful, replace `-`/`_` with spaces and title-case first character | `my-custom-model` → `My custom model` |

**Explicit fixture targets** (tests must lock these):

| `id` | `primary` |
|------|-----------|
| `qwen/qwen3.6-27b` | `Qwen3.6 27B` |
| `lmstudio-community/Meta-Llama-3.1-8B-Instruct-GGUF` | `Meta Llama 3.1 8B Instruct GGUF` |
| `mock-model-fixed` | `Mock model fixed` |
| `some-vendor/foo_bar-7b` | `Foo bar 7B` |

Prefer predictable rules over perfect vendor grammar; lock expected strings in `format-model-label.json`.

### Compose — `formatModelLabel(input)`

1. `slug = slugFromModelId(input.id)`
2. `primary = humanizeModelSlug(slug)`; if `primary` empty after trim, fallback `primary = input.id` (never show blank option).
3. `quant = input.quantization?.trim() || undefined`
4. `loadState`: `state === 'loaded'` → `'loaded'`; `state === 'not loaded'` or other explicit unloaded values → `'not_loaded'`; else `'unknown'` (OpenAI-v1 normalized rows default `loaded` in `fetch-models.ts` — still show loaded suffix for consistency).
5. **`optionText`** (Phase 1 — native select):
   - Base: `primary`
   - If `quant`: append ` · ${quant}`
   - If `loadState === 'loaded'`: append ` (loaded)`
   - If `loadState === 'not_loaded'`: append ` (not loaded)`
   - Omit state suffix when `unknown` (edge case)
6. **`title`**: `` `${input.id}${quant ? ` · ${quant}` : ''}${loadState === 'loaded' ? ' — loaded' : loadState === 'not_loaded' ? ' — not loaded' : ''}` ``

**A4 handoff:** export `loadState` so a future custom picker can render a dot instead of `(loaded)` without re-parsing `optionText`.

### HTML helper (same file or `src/lib/escape-html.ts` if shared)

```ts
export function buildModelOptionHtml(m: ModelLabelInput): string;
```

- Calls `formatModelLabel`.
- Escapes `m.id`, `optionText`, and `title` for attribute/text contexts.
- Returns `` `<option value="${escapedId}" title="${escapedTitle}">${escapedText}</option>` ``.

Keep **one** implementation path — `fetchModels()` only uses `buildModelOptionHtml` (no duplicated string templates).

---

## UI strategy — native `<select>` first

| Approach | Verdict |
|----------|---------|
| **Phase 1 (this feature)** | Keep `#modelSelect` native; update option text + `title`; rely on existing ellipsis |
| **Phase 2 (only if needed)** | Custom listbox in `.model-wrap` + `topbar.css` — triggered if manual UAT shows unreadable labels at ≤380px **after A1** layout |

Rationale: backlog allows custom dropdown “if too cramped”; current CSS already ellipsizes. Shorter primary labels (`Qwen3.6 27B` vs full path) likely satisfy acceptance without new components.

### Optional `topbar.css` tweaks (Phase 1)

| Change | Reason |
|--------|--------|
| None required for MVP | Ellipsis + shorter text may suffice |
| Consider `font-size: 12px` at `max-width: 380px` on `.model-wrap select` | Only if UAT shows clipping after label change |

No new classes required unless Phase 2 listbox ships.

---

## Schema / API changes

**None.**

- `option value` remains canonical `m.id`.
- `chat.modelId`, `modelCache`, inference paths unchanged.
- `setStatus('ok', \`${models.length} models, ${nLoaded} loaded\`)` unchanged (**A4** owns status copy).

---

## Exact file list

### Required (implement)

| File | Action |
|------|--------|
| [`src/lib/format-model-label.ts`](../../../src/lib/format-model-label.ts) | **New** — parsing, humanize, `formatModelLabel`, `buildModelOptionHtml` |
| [`src/api/models.ts`](../../../src/api/models.ts) | Use `buildModelOptionHtml` in `fetchModels()` map; no change to selection logic |

### Optional (Phase 1)

| File | Action |
|------|--------|
| [`src/styles/topbar.css`](../../../src/styles/topbar.css) | Minor select font-size at narrow breakpoints if UAT requires |

### Tests (add)

| File | Action |
|------|--------|
| [`test/fixtures/format-model-label.json`](../../../test/fixtures/format-model-label.json) | Static `id` / `quantization` / `state` → expected `primary`, `optionText`, `title` |
| [`test/lib/format-model-label.test.mts`](../../../test/lib/format-model-label.test.mts) | Unit tests via `tsx --test` |
| [`package.json`](../../../package.json) | Add `test/lib/format-model-label.test.mts` to `npm test` `tsx --test` glob |

### Verification doc (implementer creates on ship)

| File | Action |
|------|--------|
| [`documentation/plans/verification/feature-10.md`](../verification/feature-10.md) | Commands, manual checks, PASS/FAIL |

### Docs (on ship)

| File | Action |
|------|--------|
| [`documentation/context.md`](../../context.md) | Note `src/lib/format-model-label.ts` + friendly top-bar model labels |

### Explicitly not changed (unless regression)

| File | Why |
|------|-----|
| `index.html` | Same `#modelSelect` id and `onchange` |
| `src/providers/fetch-models.ts` | No API shape change |
| `src/app-state.ts`, `src/types.ts` | Cache/types unchanged |
| `src/ui/sidebar.ts`, `src/tools/loop.ts`, `src/api/chat.ts` | Still read `.value` as canonical id |

---

## Acceptance criteria

### Functional

1. After `fetchModels()`, each `<option value="…">` **value** is still the canonical LM Studio `id`.
2. Visible option text for `qwen/qwen3.6-27b` with quant `Q4_K_M` and `state: 'loaded'` reads like **`Qwen3.6 27B · Q4_K_M (loaded)`** (primary matches backlog example; quant/state suffixes allowed).
3. Hover (or long-press where supported) shows **`title`** containing full `id` and quant/state (e.g. `qwen/qwen3.6-27b · Q4_K_M — loaded`).
4. Changing model still updates `chat.modelId`, stats strip, and send path — same `modelId` string as before.
5. OpenAI-v1 providers (normalized `state: 'loaded'`) still list models with sensible labels.
6. Empty/weird `id` falls back to showing raw `id` (no blank options).

### Technical

7. `npm run build` exits 0.
8. `npm test` includes new `format-model-label` tests — PASS.
9. Option HTML built through escaped helper (angle brackets in ids cannot break DOM).
10. [`documentation/context.md`](../../context.md) updated after ship.

### Verifier sign-off

Verifier reports **PASS** only if criteria 1–10 hold and manual **U1–U4** in `documentation/plans/verification/feature-10.md` are checked.

---

## Build plan

### Todos

- [ ] **F10-1** Add `src/lib/format-model-label.ts` with `slugFromModelId`, `humanizeModelSlug`, `formatModelLabel`, `buildModelOptionHtml` (+ minimal HTML escape).
- [ ] **F10-2** Add `test/fixtures/format-model-label.json` with ≥8 cases (qwen path, flat id, quant on/off, loaded/not loaded, empty slug fallback, special chars for escape test).
- [ ] **F10-3** Add `test/lib/format-model-label.test.mts`; wire into `package.json` `npm test`.
- [ ] **F10-4** Refactor `fetchModels()` in `src/api/models.ts` to `buildModelOptionHtml(m)`; verify `sel.value` / `ac.modelId` behavior unchanged.
- [ ] **F10-5** Manual UAT: desktop + ≤380px width; confirm ellipsis shows primary name, tooltip shows full id.
- [ ] **F10-6** Run `npm run build` && `npm test`; write `documentation/plans/verification/feature-10.md`.
- [ ] **F10-7** Update `documentation/context.md` (models section + layout pointer).

### Implementation order

1. **Red:** fixture + tests for formatter (no `models.ts` yet).
2. **Green:** implement `format-model-label.ts` until tests pass.
3. **Integrate:** single-line change in `fetchModels()` option map.
4. **Verify:** manual LM Studio list with at least one `vendor/slug` id and one flat id.

### `fetchModels()` integration sketch

```ts
import { buildModelOptionHtml } from '../lib/format-model-label';

sel.innerHTML = models.map((m) => buildModelOptionHtml(m)).join('');
```

Selection block (lines 77–85) stays as-is.

---

## Test plan

### Unit — `test/lib/format-model-label.test.mts`

Run: `npx tsx --test test/lib/format-model-label.test.mts`

| # | Case | Assert |
|---|------|--------|
| T1 | Fixture row: `qwen/qwen3.6-27b` + quant + loaded | `primary`, `optionText`, `title` match JSON exactly |
| T2 | Flat id `mock-model-fixed` | Sensible `primary`; `title` contains full id |
| T3 | No quant | `optionText` has no ` · ` quant segment |
| T4 | `state` not loaded | `(not loaded)` in `optionText`; `loadState === 'not_loaded'` |
| T5 | `slugFromModelId` with multiple `/` | Uses last segment |
| T6 | Empty / whitespace id | Fallback does not throw; `primary` uses raw id |
| T7 | `buildModelOptionHtml` with `id` containing `<>&"'` | Escaped attribute/text; no raw `<` in output |
| T8 | `humanizeModelSlug` size tokens | `8b`, `27b` → `8B`, `27B` |

**Fixture discipline:** expected strings are **static** in JSON (no runtime string building in tests).

### Regression — existing suite

- `npm test` full suite — no changes expected to provider proxy tests (`mock-model-fixed` id unchanged).
- Smoke: start app (`npm start` + `npm run dev`), refresh models, send one message with selected model — confirms value/id wiring.

### Manual UAT (verification doc)

| ID | Steps | Expected |
|----|-------|----------|
| U1 | Load models with `qwen/…` style ids | Dropdown shows humanized primary, not full path |
| U2 | Hover closed select / option | Tooltip shows full canonical `id` |
| U3 | Select model, send chat | Request uses same `model` id as before feature |
| U4 | Narrow viewport ≤380px | Label truncates with ellipsis; no layout overlap with status pill |

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Humanize rules look wrong for some vendors | Fixture-driven tests; easy to add cases without touching UI |
| Native `<select>` cannot mute quant suffix | Accept plain text for A2; **A4** may introduce listbox + CSS |
| **A4** removes `(loaded)` text | `formatModelLabel` already exposes `loadState`; add `optionTextLoaded?: boolean` flag later |
| HTML injection via model `id` | `buildModelOptionHtml` escapes attributes and text |

---

## References

- Backlog **A2:** [`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md)
- To-fix line 10: [`to-fix.md`](../to-fix.md) — display name, not path
- Current fetch/render: [`src/api/models.ts`](../../../src/api/models.ts)
- Model row type: [`src/types.ts`](../../../src/types.ts) (`LmModelRecord`)
- Top-bar styles: [`src/styles/topbar.css`](../../../src/styles/topbar.css)
- Related layout plan: [`feature-01-topbar-grouped-actions.md`](feature-01-topbar-grouped-actions.md)

---

## Verifier handoff

Create or update [`documentation/plans/verification/feature-10.md`](../verification/feature-10.md):

- **Plan review:** Confirm this doc matches backlog **A2** and the [per-agent deliverable template](../product_backlog_agents_48a41af9.plan.md#per-agent-deliverable-template) (problem, file list, schema, acceptance, test plan, todos).
- **Automated:** `npm run build`; `npm test` (includes `test/lib/format-model-label.test.mts`); optional `npx tsx --test test/lib/format-model-label.test.mts`
- **Manual:** U1–U4 in verification doc; backlog example id `qwen/qwen3.6-27b` shows primary `Qwen3.6 27B` (quant/state suffixes OK until **A4**)
- **Sign-off:** PASS only when acceptance criteria 1–10 and U1–U4 are checked; `src/api/models.ts` must not render raw `m.id` as option label text
