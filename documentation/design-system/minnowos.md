# MinnowOS shell

Electron desktop layer wrapping Minnow apps. Tokens alias the chat palette via **`--os-*`** → **`--mn-*`**.

## Token layer

[`src/styles/minnowos-tokens.css`](../../src/styles/minnowos-tokens.css)

| OS token | Maps to |
|----------|---------|
| `--os-bg` | `--mn-bg` |
| `--os-surface-0` … `--os-surface-3` | `--mn-surface-*` (+ mixed surface-3) |
| `--os-text`, `--os-text-dim`, `--os-text-faint` | `--mn-fg`, muted, subtle |
| `--os-border`, `--os-border-strong` | `--mn-border*` |
| `--os-accent`, `--os-accent-2`, `--os-on-accent`, `--os-accent-soft`, `--os-accent-glow` | Accent family |
| `--os-menubar-h` | 46px (shell menubar) |
| `--os-r-sm/md/lg/xl` | Radii (md = 9px, xl = 20px) |
| `--os-wall-a/b/c` | Wallpaper gradient stops (per theme) |

Core `--os-*` tokens are on `:root` as well as `.mn-os` so wallpaper thumbnails render outside the desktop shell.

## Shell modules

| Module | Role |
|--------|------|
| [`shell.ts`](../../src/os/shell.ts) | OS stage, immersive mode |
| [`window-manager.ts`](../../src/os/window-manager.ts) | Floating app windows |
| [`dock-launcher.ts`](../../src/os/dock-launcher.ts) | Bottom app dock |
| [`menubar.ts`](../../src/os/menubar.ts) | Top menubar + model chip |
| [`desktop-chat.ts`](../../src/os/desktop-chat.ts) | Desktop composer activation |
| [`wallpaper.ts`](../../src/os/wallpaper.ts) | Desktop background renderer |
| [`app-registry.ts`](../../src/os/app-registry.ts) | Launcher metadata for 12+ apps |

## Stylesheets

| File | Scope |
|------|-------|
| [`minnowos-shell.css`](../../src/styles/minnowos-shell.css) | Menubar, dock, stage chrome |
| [`minnowos-desktop.css`](../../src/styles/minnowos-desktop.css) | Desktop chat rail, workspace |
| [`minnowos-windows.css`](../../src/styles/minnowos-windows.css) | Window frames |
| [`minnowos-wallpaper.css`](../../src/styles/minnowos-wallpaper.css) | Wallpaper layers |
| [`minnowos-apps.css`](../../src/styles/minnowos-apps.css) | App launcher tiles |
| [`desktop-workspace-rail.css`](../../src/styles/desktop-workspace-rail.css) | Files / Browser / Preview drawer |

## Wallpaper modes

Prefs in `minnow.os.*` ([`desktop-prefs.ts`](../../src/os/desktop-prefs.ts)):

- underwater (default), minnow fish (boids + glyph), aurora, starfield, grain, mesh, gradient, flat
- custom image (IndexedDB via [`asset-store.ts`](../../src/appearance/asset-store.ts))

Fish wallpaper tints `--mn-accent` via [`minnow-glyph-white.svg`](../../public/logos/minnow-glyph-white.svg).

## CSS namespace

Shell chrome uses `.mn-os-*` prefixes. Do not mix OS rules into chat CSS without scoping under `.mn-os`.
