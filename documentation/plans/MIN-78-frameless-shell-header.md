# MIN-78 — Frameless shell header with integrated window controls

## Summary

Replace double chrome (native OS title bar + `#osMenubar`) in the Electron desktop shell with a single integrated menubar header. Windows and Linux get custom min / max / close controls on the menubar right edge; macOS uses native traffic lights inset into the menubar left.

## Shipped implementation

| Area | Files |
|------|--------|
| Main process | [`electron/main.ts`](../../electron/main.ts) — `frame: false` (Win/Linux), `hiddenInset` + `trafficLightPosition` (macOS); IPC handlers; `WINDOW_MAXIMIZED_CHANGED` push |
| IPC channels | [`electron/ipc-channels.ts`](../../electron/ipc-channels.ts) |
| Preload | [`electron/preload.ts`](../../electron/preload.ts) — `window.minnow.window` API |
| Types | [`src/electron.d.ts`](../../src/electron.d.ts) |
| Control factory | [`src/os/window-control-buttons.ts`](../../src/os/window-control-buttons.ts); `restore` icon in [`src/os/icons.ts`](../../src/os/icons.ts) |
| Floating windows | [`src/os/window-frame.ts`](../../src/os/window-frame.ts) — uses shared factory (no visual change) |
| Menubar wiring | [`src/os/menubar-window-controls.ts`](../../src/os/menubar-window-controls.ts), [`src/os/menubar.ts`](../../src/os/menubar.ts) |
| Styles | [`src/styles/minnowos-shell.css`](../../src/styles/minnowos-shell.css) — drag regions, control cluster, macOS left inset |
| Tests | [`test/os/menubar-window-controls.test.mts`](../../test/os/menubar-window-controls.test.mts) |

## Platform behavior

- **Windows / Linux:** `.mn-os-mb-window-controls` after the menubar clock; shell close **hides to the system tray by default** (see **Desktop app** in Settings → General; disable close-to-tray to restore quit-on-close). Tray **Quit Minnow** still runs the full shutdown path.
- **macOS:** No custom controls; `padding-left: 72px` on `.mn-os-mb-left` for traffic lights.
- **Browser tab:** No `is-electron-shell` class; menubar unchanged.
- **Maximized:** Restore icon on Win/Linux; main process emits state on `maximize` / `unmaximize` / fullscreen transitions.

## Manual verification matrix

- Win11: Aero snap, double-click menubar maximize, resize edges
- macOS: traffic light overlap vs menubar logo/brand
- Linux: frameless resize on target WMs

## Follow-ups

- Sync `backgroundColor` with theme changes (optional)
- Linux WM-specific resize issues if reported
