# MIN-B5 — Brain app shell + wiki-side UI sections

**Phase 3c of 7. The Brain app in the OS shell, plus all wiki-facing UI sections.**

## Goal

Add the Brain app to the Minnow OS shell and build the wiki-facing UI: **Wiki, Edit, Log, Schema,
Proposals, Ingest, Lint, Settings**. The Code section is a separate issue (MIN-B8).

## Why

Agents can use the wiki after MIN-B4, but a human needs to browse, edit, and maintain it. This issue
delivers the app and the eight wiki sections, modeled closely on the existing Models app so it matches
house conventions and avoids FOUC.

## Depends on

**MIN-B3** (the `/api/brain/*` routes). Can run in parallel with MIN-B4.

## App-shell wiring (standard checklist — follow the Models app)

- **`src/os/app-registry.ts`**: add `{ id:'brain', name:'Brain', icon:'brain', … }`.
- **`src/os/types.ts`**: add `'brain'` to `AppId`; add `brainSection?` to `LaunchOptions`.
- **`src/os/icons.ts`**: add `'brain'` to `OsIconName` and a `PATHS['brain']` glyph.
- **`src/os/app-host.ts`**: add `brain:'brainView'` to `APP_LAYER_IDS`; include brain in
  `closeAllAppPages()`; add `case 'brain'` in `openAppPage()` → `openBrain(...)`.
- **`index.html`**: add `<main id="brainView" class="brain-page">` mirroring `modelsView`.
- **`src/main.ts`**: add `window.openBrainFromTopbar` (near the existing topbar openers ~line 202) and
  `brainPage.initBrainPage()` (near the other `init*Page()` calls ~line 329).
- **FOUC (Correction 7)**: add base rules to **`src/styles/global.css:106`** (where settings/benchmark
  do it):
  ```css
  .brain-page { display: none; }
  .brain-page.is-open { display: flex; }
  ```
  Do this in `global.css`, **not** only in the lazy `brain-page.css`, or the page flashes unstyled.

## UI files

- `src/ui/brain-page.ts` — top-level controller, modeled on `src/ui/models-page.ts`. Port:
  `parseHashSection`, `setActiveSection`, `openBrain`, `initBrainPage`, and a lazy `renderBrainSection`.
- `src/ui/brain/` — one module per section.
- `src/styles/brain-page.css` — lazy-loaded section styles (base `.brain-page` rules live in
  `global.css`, see FOUC note).
- `src/brain/client.ts` + `src/brain/types.ts` — typed client for `/api/brain/*`.
- Routing: `#/app/brain[/<section>]`.

## Sections

- **Wiki** — tree + rendered page viewer. Clickable **path-based** wikilinks; backlinks from
  `catalog.links[]`. Reuse `src/markdown/renderer.ts`, wrapped to rewrite `[[folder/slug]]` → in-app
  anchors that navigate the tree.
- **Edit** — frontmatter + body editor; save via `PUT /page`.
- **Log** — render `log.md` (read).
- **Schema** — view/edit `schema.md` (`GET`/`PUT /schema`).
- **Proposals** — reuse `src/ui/memory-proposals-panel.ts`.
- **Ingest** — submit a source to `POST /ingest`; show touched pages.
- **Lint** — run `POST /lint`; render the health report (orphans, stale, contradictions).
- **Settings** — reuse `src/ui/settings-memory-synthesis.ts` (keep `config.memory.*` /
  `config.synthesis.*`). (Code-index settings under `config.brain.code.*` are added in MIN-B7.)

## Verification (preview workflow — required)

1. `npm run dev`; open `#/app/brain`.
2. Confirm migrated entries appear under **Wiki → facts/**; `index.md`/`log.md`/`schema.md` exist; **no
   console errors; no FOUC** (the page must not flash unstyled on first open).
3. Create a page with a `[[facts/<slug>]]` link; edit it; verify the tree updates, backlinks resolve,
   and the change lands in `log.md`.
4. Screenshot the Wiki section as proof.

## Acceptance criteria

- [ ] Brain app opens from the shell at `#/app/brain`; deep links to sections work; no FOUC.
- [ ] All eight wiki sections render and round-trip against `/api/brain/*`.
- [ ] Path-based wikilinks and backlinks resolve correctly in the viewer.
- [ ] Typecheck + lint clean.

## Out of scope

- The **Code** section (MIN-B8) — add a registered-but-empty placeholder if routing needs it, or omit.
- Anchors / Explain panel (MIN-B9).
