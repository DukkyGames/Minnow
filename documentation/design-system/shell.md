# Minnow Shell

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

Core `--os-*` tokens are on `:root` as well as `.mn-os` so wallpaper thumbnails render outside the live shell.

## Workspace-first shell (current)

| Module | Role |
|--------|------|
| [`shell.ts`](../../src/os/shell.ts) | OS stage (`#osStage`), immersive mode |
| [`workspace-gate.ts`](../../src/os/workspace-gate.ts) | `#/workspaces` picker until a folder is chosen |
| [`app-rail.ts`](../../src/os/app-rail.ts) | Left app rail (released apps) |
| [`menubar.ts`](../../src/os/menubar.ts) | Top menubar, model chip, settings entry |
| [`router.ts`](../../src/os/router.ts) | Hash routes, legacy redirects (`#/desktop`, `#/app/chat`) |
| [`app-registry.ts`](../../src/os/app-registry.ts) | Released app metadata (rail, shortcuts, launches) |
| [`wallpaper.ts`](../../src/os/wallpaper.ts) | Stage background renderer |
| [`window-control-buttons.ts`](../../src/os/window-control-buttons.ts) | Frameless Electron chrome |

Released apps mount as **full-stage layers** in `#osAppsLayer`. **Scheduler** is a side-panel overlay; **Settings** opens from the menubar gear.

### Legacy modules (removed in Phase 5 — file map only)

These names may still appear in old CSS comments or git history; they are **not** in the tree:

| Former module | Replaced by |
|---------------|-------------|
| `dock-launcher.ts` | [`app-rail.ts`](../../src/os/app-rail.ts) |
| `desktop-chat.ts` | Code chat rail (`#/app/code/chat`) |
| `window-manager.ts` | Full-stage `#osAppsLayer` + Scheduler side panel |

## Stylesheets

| File | Scope |
|------|-------|
| [`minnowos-shell.css`](../../src/styles/minnowos-shell.css) | Menubar, stage chrome, app rail |
| [`minnowos-rail.css`](../../src/styles/minnowos-rail.css) | App rail tiles |
| [`workspace-gate.css`](../../src/styles/workspace-gate.css) | Workspaces picker |
| [`minnowos-wallpaper.css`](../../src/styles/minnowos-wallpaper.css) | Wallpaper layers |
| [`minnowos-apps.css`](../../src/styles/minnowos-apps.css) | Full-stage app shells |

Legacy window/dock/desktop-chat styles were removed with Phase 5; do not reintroduce floating-window chrome in new UI.

## Wallpaper modes

Prefs in `minnow.os.*` ([`desktop-prefs.ts`](../../src/os/desktop-prefs.ts)):

- underwater (default), minnow fish (boids + glyph), aurora, starfield, gradient, flat
- custom image (IndexedDB via [`asset-store.ts`](../../src/appearance/asset-store.ts))
- retired aliases: `mesh` → `gradient`, `grain` → `flat`

Fish wallpaper tints `--mn-accent` via [`minnow-glyph-white.svg`](../../public/logos/minnow-glyph-white.svg).

## CSS namespace

Shell chrome uses `.mn-os-*` prefixes. Do not mix OS rules into chat CSS without scoping under `.mn-os`.
