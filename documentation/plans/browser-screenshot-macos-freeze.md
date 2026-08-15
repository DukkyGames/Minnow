# Browser screenshot freeze / crash on macOS

## Status

Timeout + vision feed-back implemented. Remaining freeze hardening (hidden/0×0 refusal, capture mutex, Design Mode skip) is still open.

## Todos

- [ ] Confirm repro: Design Mode on, preview collapsed, overlay open, and “happy path” (preview visible)
- [x] Bound `capturePage` with a timeout so a hang cannot stall IPC / the tool loop forever
- [ ] Refuse capture when the guest is hidden, 0×0, or destroyed — return an error instead of CopyFromSurface on a dead surface
- [ ] Do not re-show a hidden `WebContentsView` and capture on the same tick (current IPC handler)
- [ ] Hold hide/0×0 bounds until an in-flight capture finishes (mutex with `PREVIEW_HIDE` / layout sync)
- [ ] Skip native capture in Design Mode for `browser_screenshot` / before-after diffs (region-capture already does this)
- [ ] Prefer compositor-safe capture: `capturePage(undefined, { stayHidden: true })` plus `incrementCapturerCount`, or CDP `Page.captureScreenshot` after a paint
- [x] Feed screenshot PNG bytes to vision models (dataUrl on the tool attachment + user `image_url` follow-up)
- [x] Tests: timeout, screenshot follow-up on VLM, no-vision hint
- [x] Update `documentation/context.md` when the capture contract changes

## Symptom

Calling the screenshot tool can freeze or crash a Mac (WindowServer / GPU wedged, or Minnow hung until force-quit). This matches Electron’s `CopyFromSurface` path, not a Node PNG encode bug.

## Callers of native `capturePage`

All three go through `ipcRenderer.invoke('minnow:preview:capture-page')` → `previewCapturePageBase64` → **unbounded** `wc.capturePage()`:

| Caller | Design Mode guard? |
|--------|--------------------|
| `browser_screenshot` (`src/tools/browser-preview-tools.ts`) | No — always captures |
| Design region crop (`src/design/region-capture.ts`) | Yes — skips native capture (test: “hanging native capturePage”) |
| Before/after diffs (`src/design/before-after-integration.ts`) | No |

The team already documented that native `capturePage()` on a hidden `WebContentsView` **blocks until the view is shown again**. Region capture was patched; the tool the agent actually calls was not.

## Why this can freeze a Mac

`webContents.capturePage()` uses Chromium `RenderWidgetHostView.copyFromSurface`. On macOS that copies an IOSurface through WindowServer / the GPU process.

Known failure modes (Electron issues #6015, #27891, #36376, #31992):

1. **Promise never settles** when the renderer is occluded, hidden, or has no surface. Minnow has **no timeout**.
2. **GPU / browser-process deadlock** if `OnCapturePageDone` runs on the wrong thread (historical Electron bug; still reported on occluded views).
3. **WindowServer freeze** when capturing a surface that is destroyed or resized to 0×0 mid-copy — Minnow hide does exactly that (see below).
4. This machine is **Darwin 25** (macOS 26). Electron apps already stress WindowServer on 26 (`electron/electron#48311`, `_cornerMask`). A stuck `CopyFromSurface` on top of that is a plausible whole-desktop freeze, not just an app hang.

A JS `Promise.race` timeout **unblocks the tool loop** but cannot unstick WindowServer if the GPU copy already deadlocked. The real fix is: never start `capturePage` on a hidden/0×0/in-transition view.

## Concrete bugs in our code

### 1. Unbounded capture (no timeout, no paint wait)

```97:114:electron/preview-guest-actions.ts
export async function previewCapturePageBase64(wc: WebContents): Promise<string> {
  // ...
  for (let attempt = 0; attempt < PREVIEW_CAPTURE_MAX_RETRIES; attempt++) {
    const image = await wc.capturePage();
    // retries only run if capturePage *returns* empty — a hang never retries
  }
}
```

Load-idle wait is capped at 3s. Guest `requestAnimationFrame` and `capturePage` are not. Empty-PNG retries (3×) make a slow/hung capture worse.

`capturePage` is also called with **no rect and no `{ stayHidden }`**. Electron’s documented hidden-window path is `incrementCapturerCount` + `stayHidden: true`. We do not use it.

### 2. Hide sets 0×0, then capture still runs

```678:686:electron/preview-host.ts
function hidePreviewHostEntry(entry: PreviewHostEntry): void {
  entry.visible = false;
  entry.view.setVisible(false);
  entry.view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  // ...
}
```

Visibility sync hides the guest whenever Design Mode, an overlay, wiki, chrome popover, or another app covers the pane (`shouldShowElectronPreviewHost()`). There is **no lock** with `PREVIEW_CAPTURE_PAGE`. A hide mid-copy is the WindowServer-freeze scenario.

### 3. Capture IPC re-shows then captures immediately

If `!entry.visible`, the handler restores `lastBounds`, `addChildView`, `setVisible(true)`, then calls `capturePage` **on the same turn** — no `paint` event, no frame delay. A view that just went 0×0 → real bounds often has no compositor surface yet; `CopyFromSurface` waits forever or copies a dying IOSurface.

If `lastBounds` is missing, it captures the **hidden 0×0** view anyway.

### 4. Design Mode + `browser_screenshot`

Design Mode swaps the native guest for an iframe and **hides** the `WebContentsView` (MIN-365). `prepareElectronPreviewForCapture()` then runs layout sync, which hides the native view on purpose. `browser_screenshot` still invokes native `capturePage`. That is the exact hang region-capture already special-cased.

UI Designer / tester / Build agents call `browser_screenshot` routinely (`tool-groups.ts` `browser` group).

### 5. Before/after diffs

File-save → reload pairing calls `preview.capturePage()` with no Design Mode skip and no “preview visible” check. A save while Design Mode is on, or while the pane is collapsed, hits the same hang without a user-visible tool call.

## Proposed fix (priority order)

1. **Fail closed** — if the guest is destroyed, `!entry.visible`, or bounds width/height ≤ 0, return `''` / throw a clear error. Never `capturePage` a 0×0 view.
2. **Timeout** — `Promise.race` around `capturePage` (~2–3s). On timeout, log and return empty; do not retry the hung call.
3. **Capture mutex** — while capture is in flight, `PREVIEW_HIDE` / layout sync must not 0×0 the same view (defer hide until capture settles or times out).
4. **No show-and-grab** — if the view must be shown first, wait for `webContents` `paint` (or a bounded double-rAF **after** show) before `capturePage`. Better: capture hidden via `{ stayHidden: true }` + `incrementCapturerCount` so Design Mode / overlays are not fought.
5. **Design Mode** — `browser_screenshot` and before/after skip native capture the same way region-capture does (friendly error, or later: rasterize the iframe guest).
6. **Renderer prep** — `prepareElectronPreviewForCapture` should not hide-then-capture. If Design Mode is on, abort before IPC.

## Out of scope / do not do

- Do not shell out to macOS `/usr/sbin/screencapture` (TCC prompts, captures the whole desktop, worse WindowServer risk).
- Do not raise Electron solely for this unless 43.x is missing a known `capturePage` fix; the hang is triggered by our hidden/0×0/race usage.
- A timeout alone is not a complete fix if hide-during-copy continues.

## Verification

- Unit: `previewCapturePageBase64` timeout; hidden/0×0 short-circuit; retries do not follow a timeout.
- Unit: `browser_screenshot` / before-after skip Design Mode iframe guest.
- Manual on macOS 26: screenshot with preview visible; preview collapsed; Design Mode on; wiki/overlay open; rapid overlay toggle during capture. Mac must stay interactive; tool returns an error instead of hanging.
