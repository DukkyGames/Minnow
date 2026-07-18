# Layout shell

Primary chrome shared across Chat and Code workspace views.

## Regions

```
┌─────────────────────────────────────────────────────────┐
│ Top bar (--topbar-h: 52px)                              │
├──────────┬──────────────────────────────────────────────┤
│ Sidebar  │  Messages / workspace                        │
│ 300px    │                                              │
│ (48 rail)│                                              │
├──────────┴──────────────────────────────────────────────┤
│ Stats strip (instrumentation)                           │
├─────────────────────────────────────────────────────────┤
│ Composer (input bar + mode + context ring + send)       │
└─────────────────────────────────────────────────────────┘
```

## Top bar

- **CSS:** [`topbar.css`](../../src/styles/topbar.css)
- **Logic:** model select, status, settings entry
- **Height:** `--topbar-h` (52px)
- Border-bottom only; no shadow at rest

## Session sidebar

- **CSS:** [`sidebar.css`](../../src/styles/sidebar.css)
- **Logic:** [`sidebar.ts`](../../src/ui/sidebar.ts), [`layout.ts`](../../src/ui/layout.ts)
- **Width:** `--sidebar-w` (300px); collapsed rail `--sidebar-rail` (48px)
- **Breakpoints** ([`responsive.css`](../../src/styles/responsive.css)):
  - ≤640px: fixed overlay + scrim (`--mn-overlay`), `--shadow-sidebar`
  - 641–899px: narrower effective width in some layouts
  - ≥900px: full width

## Composer

- **CSS:** [`input.css`](../../src/styles/input.css), [`composer-controls.css`](../../src/styles/composer-controls.css), [`composer-model-trigger.css`](../../src/styles/composer-model-trigger.css), [`mode-selector.css`](../../src/styles/mode-selector.css), [`context-usage.css`](../../src/styles/context-usage.css)
- **Logic:** [`input.ts`](../../src/ui/input.ts), [`composer-send.ts`](../../src/ui/composer-send.ts), [`mode-selector.ts`](../../src/ui/mode-selector.ts), [`context-usage-ring.ts`](../../src/ui/context-usage-ring.ts)
- **Input:** `#msgInput` min-height 44px; 16px font at ≤600px (iOS zoom guard)
- **Context ring:** SVG ring beside send showing context fill

## Stats strip

- **CSS:** [`stats.css`](../../src/styles/stats.css)
- **Logic:** [`stats.ts`](../../src/ui/stats.ts)
- Desktop: grid of metric cells, mono tabular values
- ≤600px: collapsed row; `.stats-strip.is-expanded` on tap
- Token bars: 6px track, warning (prompt) + success (completion) fills

## Settings drawer / page

- **Drawer:** right sheet `min(420px, 100vw - 16px)`, slide 0.22s `--ease-out`
- **Full page:** [`settings-page.css`](../../src/styles/settings-page.css), route `#/settings/...`
- **Controls:** shared primitives in [primitives.md](primitives.md)

## Code workspace additions

| Region | Token | CSS |
|--------|-------|-----|
| File sidebar | `--file-sidebar-w` (350px) | [`file-panel.css`](../../src/styles/file-panel.css) |
| Split viewer | `--split-ratio` (0.55) | [`init-file-panel.ts`](../../src/ui/init-file-panel.ts) |
| Terminal | — | [`terminal.css`](../../src/styles/terminal.css) |

## Breakpoints reference

| Token | Value | Typical use |
|-------|-------|-------------|
| `--bp-compact` | 600px | Stats collapse, composer font bump |
| `--bp-mobile` | 640px | Sidebar overlay |
| `--bp-wide` | 900px | Full sidebar width |

## Motion

- Panel reveal: [`motion.css`](../../src/styles/motion.css) (`minnow-panel-reveal`)
- Durations: `--duration-fast` (150ms), `--duration-normal` (220ms), `--duration-slow` (350ms)
- `prefers-reduced-motion`: transitions stripped in [`global.css`](../../src/styles/global.css)
- No width animation on desktop rails (resize uses pointer capture, not CSS layout transition)
