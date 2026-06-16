# Brain App — UX Review & Visual Elevation Plan

## Context

The new Brain app (knowledge-graph + wiki + maintenance tooling, branch `Brain`) is
functionally complete across nine sections (Graph, Edit, Log, Schema, Proposals,
Ingest, Lint, Code, Settings) but reads as a developer scaffold rather than a finished
product. A live walk-through of every section in the running preview revealed
consistent problems: wasted screen space, redundant chrome, undersized labels, flat
surfaces with no depth, bland empty states, and a graph view that lacks a legend.

The goal (confirmed with the user) is a **full visual elevation** — keep the current
information architecture, but bring the look up to the polish of the reference
dashboards (depth/glow, card surfaces, strong hierarchy, contextual side panels) — and
move the utility sections to a **two-column layout with a contextual right panel**
instead of the current narrow left-pinned column.

## Findings (what's wrong today)

1. **Massive wasted space.** Every non-graph section is a `max-width: 56rem` block
   pinned to the left (`.brain-section`, [brain-page.css:51](src/styles/brain-page.css)),
   leaving 50%+ of a wide screen empty/black. Looks unfinished.
2. **Triple-stacked, redundant chrome.** OS window title shows "Brain", then
   `.brain-page-header` shows a back arrow + "Brain" again ([index.html:1219](index.html)),
   then each section repeats its name as an `<h2>`. The word "Brain" appears 2–3× with
   no added info, and the back arrow duplicates the window chrome's close button when
   embedded.
3. **Undersized, low-contrast text.** Rail labels are 9px uppercase
   ([brain-graph.css:62](src/styles/brain-graph.css)); lots of 11px metadata. Hard to read.
4. **Flat, depthless surfaces.** Inputs/buttons/cards use `var(--mn-bg)` as their
   background (e.g. [brain-page.css:107](src/styles/brain-page.css)) instead of the
   elevated `--mn-surface-1/2` tokens, and nothing uses `--shadow-md/lg`. Everything is
   the same near-black with hairline borders — no hierarchy or depth.
5. **Graph view has no legend.** Node colors encode page/tag/symbol/orphan/active
   (`--brain-node-*` in [brain-graph.css:8](src/styles/brain-graph.css)) but nothing on
   screen explains them (the reference graph app has a "Woman (5) / Man (32)" legend).
   Zoom controls are bare `+ / −` text buttons; the toolbar is an undifferentiated row.
6. **Bland empty/loading states.** Proposals = plain "No pending proposals."; Code =
   "Select a symbol…"; loaders are bare "Loading page…" text. No icon, framing, or CTA.
7. **Utilitarian forms.** Edit/Ingest are bare label+input stacks with no grouping,
   preview, or affordance. Edit has a body textarea but no markdown preview, despite a
   reusable `renderBrainMarkdown()` already existing ([wikilink-markdown.ts](src/ui/brain/wikilink-markdown.ts)).
8. **Inconsistent buttons.** "Save synthesis settings" renders as a full-width green
   slab while sibling actions are small outline buttons — no clear primary/secondary system.

## Design approach

Reuse existing theme tokens everywhere (defined per-theme in
[tokens.css](src/styles/tokens.css)): `--mn-surface-1/2`, `--mn-border`,
`--mn-border-strong`, `--mn-fg`, `--mn-fg-muted`, `--mn-accent`, `--mn-success/warning/danger`,
`--radius-sm/md`, `--shadow-md/lg`. This keeps all four+ themes (dark/light/warm/etc.)
working. Establish a small set of Brain primitives and apply them consistently.

### 1. Brain surface & elevation primitives (brain-page.css)
- Introduce a `.brain-card` surface (background `--mn-surface-1`, 1px `--mn-border`,
  `--radius-md`, `--shadow-md`) and use it for settings groups, form panels, list rows,
  inspector, and empty states.
- Switch inputs/buttons/textareas from `--mn-bg` to `--mn-surface-1/2` so fields read as
  raised. Add focus rings via `outline: 2px solid color-mix(--mn-accent 45%, transparent)`
  (pattern already used in [editor-quick-edit.css:71](src/styles/editor-quick-edit.css)).
- Define a button system: `.brain-action-btn` (secondary, surface bg) and
  `.brain-action-btn.is-primary` (accent) — already exist; add a `.is-ghost` for toolbar
  icon buttons and stop letting one button stretch full-width.

### 2. Consolidate the header (index.html + brain-page.css)
- Collapse to a single rich header bar: drop the standalone "Brain" `<h1>`; show the
  **active section name** + its one-line description inline in the header instead of
  repeating them as an `<h2>`/`.brain-lead` inside each section. Keep the back arrow only
  when not OS-embedded (the page already knows via `isOsEmbedded()` in
  [brain-page.ts:158](src/ui/brain-page.ts)).
- Add room in the header for section-level actions (e.g. graph "New page", Edit "Save")
  so primary actions live in a predictable spot.

### 3. Graph hero (brain-graph.css + index.html + graph-section.ts)
- Add a **legend** chip-row (page / tag / symbol / orphan / active) rendered from the
  `--brain-node-*` tokens, sitting bottom-left of the canvas next to the existing
  first-run hint. Render it in `renderGraphSection()` and keep counts in sync with the
  existing `brainGraphStats` logic ([graph-section.ts:175](src/ui/brain/graph-section.ts)).
- Group the toolbar: search on the left; a segmented zoom/fit control (`− / Fit / +`)
  as one pill; toggle group (Tree, Tags, Orphans) as pressed-state pills; "New page" as
  the single primary on the right. Style zoom as proper icon buttons, not text.
- Deepen the canvas stage: keep the inset glow but layer a subtle radial gradient and a
  stronger border so the graph feels like a focused surface.

### 4. Inspector elevation (brain-graph.css + inspector.ts)
- Turn the right inspector into a card with a clear header zone (title, mono path, tag
  chips), a "Backlinks" section, body preview, and a sticky action footer ("Edit page").
- Render tags as chips (not ` · `-joined text) and give backlinks hover affordance.
- No logic rewrite — `renderBrainInspector()` structure stays; mostly markup classes +
  CSS. Apply the same card treatment to `renderSymbolInspector()`.

### 5. Two-column utility sections (index.html + section TS + brain-page.css)
Replace the single left-pinned `.brain-section` column with a responsive
`.brain-section__cols` grid (`minmax(0,1fr) minmax(320px, 380px)`), collapsing to one
column under ~900px. Per section:
- **Edit:** left = form card; right = **live markdown preview** card rendered with the
  existing `renderBrainMarkdown()` ([inspector.ts:108](src/ui/brain/inspector.ts) shows
  the call pattern), updating on `input`. This fills the empty space with something useful.
- **Ingest:** left = source form; right = guidance card ("how synthesis works" + recent
  ingests if cheaply available, else static help).
- **Schema:** left = editor; right = rendered schema preview / field reference.
- **Code:** already two-column-ish ([brain-page.css:328](src/styles/brain-page.css));
  align it to the new grid + card treatment and fix the empty Explain panel state.
- **Log / Lint / Proposals:** these are list/report views — center them in a comfortable
  capped-width card column (full two-column not needed) so they don't float left.

### 6. Empty, loading & result states (section TS files)
- Build a shared empty-state block (icon + title + one-line guidance + optional CTA) and
  use it for Proposals (`No pending proposals` → "You're all caught up" + link to Ingest),
  Code Explain, empty graph, offline banners, and loaders (skeleton/spinner vs bare text).
  Touch points: [proposals-section.ts](src/ui/brain/proposals-section.ts),
  [code-section.ts](src/ui/brain/code-section.ts), [lint-section.ts](src/ui/brain/lint-section.ts),
  [ingest-section.ts](src/ui/brain/ingest-section.ts), graph offline/empty markup in index.html.

### 7. Settings polish (settings-section.ts + brain-page.css)
- Make each `.brain-settings-group` a real `.brain-card` with consistent heading scale.
- Normalize the oversized "Save synthesis settings" button to the standard primary size;
  keep the vector-blend slider (it reads well).

### 8. Typography, responsive & a11y
- Bump rail labels to ~10–11px and raise the smallest metadata to ≥12px; tighten the
  type scale (section title, subtitle, body, meta) into 3–4 steps.
- Verify the existing breakpoints (900px / 720px in both CSS files) still hold with the
  new grids; the inspector already becomes an overlay <900px ([brain-graph.css:406](src/styles/brain-graph.css)).
- Keep `prefers-reduced-motion` honored (block already exists,
  [brain-graph.css:393](src/styles/brain-graph.css)); ensure new focus rings and
  `aria-current`/`aria-pressed` states remain.

## Files to modify

- `src/styles/brain-page.css` — surfaces, cards, button system, two-column grid, forms,
  empty-state block, typography scale.
- `src/styles/brain-graph.css` — stage depth, toolbar grouping, legend, inspector card,
  rail label sizing.
- `index.html` (~1219–1360 and section markup) — header consolidation, graph legend +
  grouped toolbar markup, per-section two-column wrappers, richer empty/offline markup.
- `src/ui/brain/graph-section.ts` — render/sync the legend; wire grouped zoom controls.
- `src/ui/brain/edit-section.ts` — live preview pane (reuse `renderBrainMarkdown`).
- `src/ui/brain/inspector.ts` — tag chips, card header/footer classes (markup only).
- `src/ui/brain/{proposals,code,lint,ingest}-section.ts` — shared empty/loading states.
- `src/ui/brain/settings-section.ts` — card grouping, button normalization.
- (Maybe) a tiny shared helper for the empty-state block to avoid duplication.

## Verification

1. `preview_start` the existing "Minnow Full-Stack" server (already running on :5173);
   open Brain via the dock.
2. Walk every section with `preview_screenshot` at desktop (1280) and confirm: no large
   empty right gutter, single non-redundant header, legible labels, card depth.
3. Graph: confirm legend renders with correct colors/counts, toolbar groups read
   clearly, zoom/fit/toggles still work (`preview_click`), inspector opens as a card.
4. Edit: type in the body and confirm the live preview updates; Save still persists
   (status line shows "Saved …").
5. `preview_resize` to tablet/mobile and dark+light `colorScheme`: confirm grids
   collapse, inspector overlays, and tokens adapt across themes.
6. `preview_console_logs` clean; run the Brain test suite
   (`test/os/brain-app.test.mts`, `test/os/window-apps.test.mts`) to confirm DOM-id
   bindings and section switching still pass after markup changes.
