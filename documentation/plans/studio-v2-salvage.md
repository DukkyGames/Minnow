# Studio v2 P0 — v1 salvage record (MIN-363)

v1 of "Studio" lived unmerged on branch `Minnow-studio`. That branch was **not** merged or
cherry-picked. Instead, a handful of reusable, mode-free pieces were re-typed into fresh
modules under `src/design/` (and one server tool under `server/design/`). Everything with
hub/mode/agent coupling was left behind on `Minnow-studio`.

## Taken (ported, stripped of mode/hub/studio-agent coupling)

| v1 source (`Minnow-studio` branch) | New home | What changed |
| --- | --- | --- |
| `src/ui/studio/element-picker.ts` | `src/design/element-picker.ts` | Renamed the picker's internal DOM hook ids (`mn-studio-picker-*` → `mn-design-picker-*`, `__mnStudioPicker` → `__mnDesignPicker`) and doc comments. Selector strategy (id → short stable-class chain → `nth-of-type`, depth ≤ 6), `execJs`/iframe transport detection, and `data-mn-uid` stamping are unchanged. `data-mn-uid` is the same attribute name written by `PREVIEW_DOM_SNAPSHOT_SCRIPT` in `src/tools/browser-preview-snapshot.ts`, so picks and `browser_click` uid-fallback selectors stay compatible with the existing preview snapshot tool. Still imports `getFilePanelState` from `src/state/file-panel.ts` for cross-origin-preview detection — that's core preview-pane state, not studio/mode state, so it stayed. |
| `src/ui/studio/region-capture.ts` | `src/design/region-capture.ts` | Kept only the capture primitive: `computeCropRect` (pure crop math, `boundingRect × devicePixelRatio` clamped to the page), `cropPngToDataUrl` (offscreen `<canvas>` crop with taint fallback), and a new `captureRegion()` that drives `window.minnow.preview.capturePage()` → decode dimensions → crop → (on taint) upload via `POST /api/browser/screenshot`. **Dropped**: `StudioCaptureController`, `handleStudioElementPick`, `markerAttachments`/`getRegionAttachmentsForSelections`, and all `src/attachments/store.ts` + `src/state/studio-state.ts` wiring — those existed to push captures into the composer and pin them to hub selections, which is mode/hub UI this task explicitly abandons. `CapturedRegion` no longer carries a `markerId`; callers that want marker bookkeeping own that mapping themselves (see `overlay.pinCaptureToMarker(markerId, captured)`, which takes the id as a separate argument). |
| `src/ui/studio/annotation-overlay.ts` | `src/design/overlay.ts` | Parent-owned SVG overlay, unchanged behavior (marker outlines + numbered badges, free-draw rect emission, `mapGuestRect` CSS-scale correction, resize via `ResizeObserver`). Renamed CSS hook classes `studio-annotation-overlay/-markers/-draw` → `mn-design-overlay/-markers/-draw`. Only external dependency is the `CapturedRegion` type from the new `region-capture.ts`. |
| `server/studio/load-aesthetics-reference.js` | `server/design/load-aesthetics-reference.js` | Reads a bundled markdown file, unchanged logic; now points at `src/skills/design/reference/frontend-aesthetics.md`. |
| `src/skills/studio/reference/frontend-aesthetics.md` | `src/skills/design/reference/frontend-aesthetics.md` | Ported verbatim (it's still the frozen `TODO(human)` stub from v1 — authoring the actual cookbook content is out of scope for this port). |
| Wiring for `load_aesthetics_reference` as a plain tool | `server/config/tool-ids.js`, `server/runtime/tools-middleware.js`, `src/tools/definitions.ts`, `src/tools/tool-cache-policy.ts`, `server/settings/registry-manifest.json` | Followed the existing `load_impeccable_context` pattern exactly (same four registration points + a generated settings-registry permission entry), so it's just another `category: 'utility'`, `serverRequired: true` tool available from any chat/work agent — no `studio-*` agent, no mode gating. |
| Tests from `test/studio/` and `test/ui/studio*` covering the above | `test/design/*.test.mts` + `test/design/load-aesthetics-reference.test.mjs` | Retargeted imports to `src/design/*` / `server/design/*`. `region-capture.test.mts` was rewritten (not just renamed) to match the new mode-free `captureRegion()` API — dropped assertions about attachment-store pushes, `captureOnClick` toggling, and studio-state selections; added two new error-path tests (missing capture, `capturePage()` rejection) to keep coverage of `captureRegion`'s error branches. `overlay.test.mts` and `element-picker-*.test.mts` are line-for-line ports with only import paths and renamed CSS classes updated. |

## Abandoned (left on `Minnow-studio`, not ported)

- Studio hub UI, `#/studio` shell/routing, Build/Edit/Review mode UIs and toolbars
  (`src/ui/studio/studio-hub.ts`, `src/ui/studio/modes/*`, `src/ui/studio/preview-studio.ts`,
  `src/ui/studio/studio-canvas.ts`, `src/ui/studio/studio-context.ts`).
- `src/agents/studio/*` and all `studio-build` / `studio-edit` / `studio-review` work-agent
  prompts (`src/chat/prompts/work-agents/studio-*`).
- Per-mode routing / mode registration for studio modes, and `studio-state.ts`'s mode/hub
  fields (`byWorkspace`, `captureOnClick` toggle plumbing, selections list) — anything
  hub-shaped that assumed a single active studio session.
- Single-host repositioning logic tied to the hub's canvas/toolbar layout.
- v1 tests exercising the abandoned pieces: `test/studio/build-mode.test.mjs`,
  `edit-mode.test.mjs`, `edit-payload.test.mjs`, `mode-dispatch.test.mjs`,
  `mode-layout.test.mjs`, `mode-toolbar.test.mjs`, `prompt-allowlist-parity.test.mts`,
  `registry.test.mjs`, `review-findings.test.mjs`, `review-mode.test.mjs`, `runner.test.mts`,
  `tools.test.mts`, `test/ui/preview-studio.test.mts`, `test/ui/studio-canvas.test.mts`.

## Verification

- `npx tsc --noEmit` — 0 errors (clean before and after; the four new/edited `src/` files
  introduce no type errors).
- `node ./node_modules/tsx/dist/cli.mjs --experimental-test-module-mocks --import
  ./test/test-loader.mjs --test --test-force-exit test/design/*.test.mts` — 24/24 pass
  (element-picker selector + payload + transport, overlay, region-capture).
- `node --test --test-force-exit test/design/load-aesthetics-reference.test.mjs` — 2/2 pass.
- `load_aesthetics_reference` registered and callable like any other server tool — see
  `server/runtime/tools-middleware.js` (`load_aesthetics_reference: () =>
  toolLoadAestheticsReference(getAppRoot())`) and `src/tools/definitions.ts`
  (`category: 'utility'`, `serverRequired: true`, no agent/mode restriction).

## Deviations / follow-ups

- `server/settings/registry-manifest.json` is normally regenerated by `npm run
  settings-registry:generate`, but running the generator on this branch also rewrote ~30
  unrelated pre-existing/stale entries (other tools' permission rows, a `general.chat.terminal`
  reorder) that predate this task. To keep this change scoped, the one new
  `integrations.tools.permission.load_aesthetics_reference` entry was hand-inserted in the
  exact shape the generator would produce, immediately after `load_impeccable_context`'s
  entry, instead of committing that unrelated drift. A follow-up should run the full
  generator separately and review that drift on its own.
- `frontend-aesthetics.md` is still the unauthored `TODO(human)` stub carried over from v1 —
  authoring it from the cookbook is explicitly out of scope here.
- `test/config/migration.test.js` has a pre-existing, unrelated failure (session-state fixture
  expects schema `version: 3`, current code writes `version: 5`) verified via `git stash` to
  predate this change; not touched.
