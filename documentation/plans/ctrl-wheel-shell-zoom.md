---
name: ctrl-wheel-shell-zoom
overview: Make Ctrl + mouse wheel zoom the Minnow desktop interface in/out by actively handling Electron's `zoom-changed` request event in the existing shell-zoom pipeline (preset steps, config persistence, live Settings select sync), plus docs/copy updates. Browser mode keeps native browser zoom.
todos:
  - id: w1-zoom-handler
    content: "Wave 1: Actively apply shell zoom on zoom-changed (Ctrl+wheel) with preset steps"
    status: pending
  - id: w2-zoom-docs
    content: "Wave 2: Document the Ctrl+scroll-wheel shortcut (manual, ? overlay, settings copy)"
    status: pending
isProject: true
---

# Ctrl + Scroll Wheel Shell Zoom

**Date:** 2026-08-04
**Goal:** Ctrl + mouse wheel zooms the Minnow desktop window in/out using the existing shell-zoom pipeline (config-persisted, clamped 50–300%, live Settings sync).
**Granularity:** medium

## Context

The desktop shell already has a complete zoom system:

- `electron/shell-zoom.ts` — `DEFAULT_SHELL_ZOOM_PERCENT = 80`, `MIN/MAX = 50/300`, `SHELL_ZOOM_PRESET_PERCENTS = [50, 67, 75, 80, 90, 100, 110, 125, 150, 200]`, `clampShellZoomPercent`, `shellZoomFactorFromPercent`, `shellZoomPercentFromFactor`, `applyShellZoom` (sets `applyingShellZoom` to guard re-entry), and `wireShellZoom(win, deps)`.
- `wireShellZoom` applies the configured percent on load / `did-finish-load` and already listens to Electron's `zoom-changed` event — **but the handler only reads back `contents.getZoomFactor()` and writes it to config** (`electron/shell-zoom.ts:75`). Per the Electron docs (webContents `zoom-changed`: *"Emitted when the user is requesting to change the zoom level using the mouse wheel"*), the event is a **request**; Electron does not apply the zoom itself. So Ctrl+wheel is currently a no-op, and the mirror handler writes the unchanged percent back to config.
- Ctrl + plus/minus/0 already work via Electron's default application menu roles (no custom `Menu` in `electron/main.ts`); those natively change the factor but do **not** fire `zoom-changed` (electron/electron#33572), so they are not persisted — pre-existing gap, explicitly out of scope.
- Persistence + UI are fully wired: `SHELL_SET_ZOOM_PERCENT` IPC → `writeShellZoomPercent` (config.json `desktopShell.zoomPercent`) → `applyShellZoom` → `SHELL_ZOOM_PERCENT_CHANGED` → Settings → General → Desktop app "Interface zoom" select updates via `api.onZoomPercentChanged` (`src/ui/settings-desktop-shell.ts:111`).
- No zoom rows exist in `documentation/manual/reference/keyboard-shortcuts.md` (grep: no matches) or the `?` shortcut overlay (`src/ui/shell-keyboard-help.ts`).
- Editor is CodeMirror 6 — no default Ctrl+wheel font zoom, no conflict. No renderer wheel interceptor exists.

**Decision — main process, not renderer:** handle `zoom-changed` in `electron/shell-zoom.ts`. It is the smallest correct change, covers mouse wheel *and* touchpad pinch, requires no renderer/bundle changes, and reuses the existing persistence + notification deps already passed to `wireShellZoom`. Renderer-side wheel interception is unnecessary (Electron applies nothing by default, so nothing to `preventDefault`).

**Step semantics:** snap to the next/previous entry of `SHELL_ZOOM_PRESET_PERCENTS` (clamped at MIN/MAX). Every wheel step therefore lands on a preset that exists in the Settings dropdown, so the select never shows an empty value.

**Browser mode (`MINNOW_BROWSER=1`):** intentionally untouched — the browser's native Ctrl+wheel page zoom applies there.

## Architecture / Key Files

| File | Role | Action |
|------|------|--------|
| `electron/shell-zoom.ts` | Main-process zoom pipeline; `wireShellZoom` zoom-changed handler | MODIFY |
| `test/electron/shell-zoom.test.mjs` | Unit tests for the pure zoom helpers | MODIFY |
| `documentation/manual/reference/keyboard-shortcuts.md` | Shipped user manual keyboard reference | MODIFY |
| `src/ui/shell-keyboard-help.ts` | `?` shortcut overlay entries (`SHELL_SHORTCUTS`) | MODIFY |
| `src/ui/settings-desktop-shell.ts` | Desktop shell settings zoom row copy | MODIFY |

## Wave Breakdown

### Wave 1 — Shell zoom handler

#### Task W1-A: Actively apply shell zoom on `zoom-changed` (Ctrl+wheel)
- **Build:** In `electron/shell-zoom.ts`:
  1. Add an exported pure helper (place after `shellZoomPercentFromFactor`, ~line 36):
     ```ts
     export function nextShellZoomPercent(current: number, direction: 'in' | 'out'): number {
       const clamped = clampShellZoomPercent(current);
       if (direction === 'in') {
         return SHELL_ZOOM_PRESET_PERCENTS.find((p) => p > clamped) ?? MAX_SHELL_ZOOM_PERCENT;
       }
       return [...SHELL_ZOOM_PRESET_PERCENTS].reverse().find((p) => p < clamped) ?? MIN_SHELL_ZOOM_PERCENT;
     }
     ```
  2. Replace the body of the existing `contents.on('zoom-changed', …)` listener in `wireShellZoom` (currently `electron/shell-zoom.ts:75`) — keep the listener registration, change the handler to actively zoom:
     ```ts
     contents.on('zoom-changed', (_event, zoomDirection) => {
       if (applyingShellZoom || contents.isDestroyed()) return;
       if (zoomDirection !== 'in' && zoomDirection !== 'out') return;
       const current = shellZoomPercentFromFactor(contents.getZoomFactor());
       const next = nextShellZoomPercent(current, zoomDirection);
       if (next === current) return;
       applyShellZoom(contents, next);
       void deps.writePercent(next).then((saved) => deps.notifyPercentChanged(saved));
     });
     ```
     The old read-back-and-persist body is removed entirely (it was a no-op — it wrote the unchanged percent back). `applyShellZoom` already sets `applyingShellZoom`, so the guard prevents re-entry.
  3. No changes to `electron/main.ts` (deps already wired), `electron/preload.ts`, `electron/ipc-channels.ts`, `src/`, or `webPreferences.zoomFactor` (`electron/main.ts:429`).
- **Test:** Extend `test/electron/shell-zoom.test.mjs` — import `nextShellZoomPercent` from `../../electron/shell-zoom.ts` and add a `describe('nextShellZoomPercent')` block asserting: in@80→90, in@200→300, in@300→300, in@72→75, out@80→75, out@67→50, out@50→50, out@90→80, out@72→67, out@300→200. Scoped run (exact `tsx-mocks-loader` profile from `test/test-config.mjs`, which auto-discovery assigns to `.test.mjs` files):
  ```
  node --experimental-test-module-mocks --import tsx --import ./test/test-loader.mjs --import ./test/assert-dom-safe.mjs --test --test-force-exit --test-timeout=120000 test/electron/shell-zoom.test.mjs
  ```
  Then `npx tsc --noEmit -p electron/tsconfig.json` (the `zoomDirection` listener param must type-check against Electron 43's `'in' | 'out'` — root `tsconfig.json` includes only `src/` and does not cover `electron/`).
- **Accept:** In the running Electron app (`npm start`): Ctrl + wheel up zooms the window in, Ctrl + wheel down zooms out, each notch stepping through the preset list; Settings → General → Desktop app "Interface zoom" select follows each notch live; after restart the zoom persists (config.json `desktopShell.zoomPercent`).
- **Depends on:** —

### Wave 2 — Shortcut docs & copy

#### Task W2-A: Document the Ctrl+scroll-wheel shortcut
- **Build:**
  1. `documentation/manual/reference/keyboard-shortcuts.md` — add one row in the appropriate shell/window shortcuts table matching the file's existing row format, e.g. `Ctrl + Scroll wheel — Zoom the interface in / out (desktop app)`. (Grep confirms the file currently has no zoom row.)
  2. `src/ui/shell-keyboard-help.ts` — add a `ShortcutDoc` entry to the `SHELL_SHORTCUTS` array (`src/ui/shell-keyboard-help.ts:19`), e.g. `{ section: 'Shell', keys: 'Ctrl + Scroll wheel', label: 'Zoom the interface in / out' }`, matching adjacent entries' shape.
  3. `src/ui/settings-desktop-shell.ts:63` — extend the "Interface zoom" description to mention the gesture, e.g. "Scale the Minnow desktop window. Ctrl/Cmd + and − adjust zoom; Ctrl + scroll wheel zooms in and out; the value here updates to match."
  4. Grep `test/` for `shell-keyboard-help` — if a snapshot test asserts the full `SHELL_SHORTCUTS` list, update it to include the new entry.
- **Test:** `npx tsc --noEmit` passes (covers `src/ui/shell-keyboard-help.ts` and `settings-desktop-shell.ts`). Grep assertions: `documentation/manual/reference/keyboard-shortcuts.md`, `src/ui/shell-keyboard-help.ts`, and `src/ui/settings-desktop-shell.ts` each contain the new "Scroll wheel" text. No new unit tests required (copy/docs).
- **Accept:** In the running app, pressing `?` lists the new Ctrl + Scroll wheel row; Settings → General → Desktop app shows the updated description; the shipped keyboard-shortcuts manual includes the row.
- **Depends on:** w1-zoom-handler

## Verification Checklist
- [ ] Scoped shell-zoom test file passes (command in W1-A) and `npm test` passes (auto-discovers `test/electron/shell-zoom.test.mjs`)
- [ ] `npx tsc --noEmit` passes (src)
- [ ] `npx tsc --noEmit -p electron/tsconfig.json` passes (electron)
- [ ] `npm run build` passes
- [ ] Manual smoke (`npm start`): Ctrl+wheel in/out scales the window; Settings select tracks; `desktopShell.zoomPercent` persists in `~/.minnow/config.json` across restart
- [ ] `npm run test:check-coverage` passes (no orphaned test files)

## Notes for Build Agents
- `electron/shell-zoom.ts` compiles under `electron/tsconfig.json` (NodeNext ESM, `types: ["node", "electron"]`) — root `npx tsc --noEmit` does **not** cover it; always run `npx tsc --noEmit -p electron/tsconfig.json` after editing.
- Windows CRLF repo: use surgical edits via `replace_text_in_file`/`save_file` (line endings auto-match); never rewrite whole files.
- `zoom-changed` fires only for wheel / touchpad-pinch *requests* — not for menu-role zoom shortcuts (electron/electron#33572). Ctrl+plus/minus/0 keep working natively via the default menu; their non-persistence is pre-existing and out of scope.
- Do not touch `webPreferences.zoomFactor` (`electron/main.ts:429`) — it stays the initial factor.
- No renderer bundle impact (no `src/` logic changes), so `budgets.json` performance budgets are unaffected.
- In-app browser previews (`electron/preview-host.ts`) are separate `WebContents`/windows and read their own zoom factors — unaffected by main-window zoom changes; do not add per-preview handling in this plan.
