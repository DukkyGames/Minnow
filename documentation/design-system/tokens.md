# Design tokens

All palette values live in [`src/styles/tokens.css`](../../src/styles/tokens.css). Every other stylesheet consumes **`--mn-*`** variables (never raw hex outside `tokens.css`).

## Core palette (`--mn-*`)

26 keys defined in [`CORE_THEME_TOKEN_KEYS`](../../src/appearance/types.ts). Customizable via Settings → Appearance or agent `update_appearance`.

| Token | Role |
|-------|------|
| `--mn-bg` | Page / shell background |
| `--mn-surface-0` … `--mn-surface-2` | Layered surfaces (inputs, panels, elevated rows) |
| `--mn-border`, `--mn-border-strong` | Hairlines and emphasized dividers |
| `--mn-fg`, `--mn-fg-muted`, `--mn-fg-subtle` | Primary, secondary, tertiary text |
| `--mn-fg-on-accent` | Text/icons on filled accent buttons |
| `--mn-accent`, `--mn-accent-soft`, `--mn-accent-border`, `--mn-accent-ink` | Primary brand action color (varies per theme family) |
| `--mn-success` (+ soft, border, ink) | Metric green, ok status |
| `--mn-warning` | Metric amber, prompt token bars |
| `--mn-danger` (+ soft, border, ink) | Errors, destructive hover |
| `--mn-focus-ring` | `:focus-visible` outline |
| `--mn-shadow` | Shadow color base (mobile sidebar, popovers) |
| `--mn-folder` | File-tree folder tint |

## Derived per theme (not in custom editor)

Set in each `data-theme` block; built with `color-mix` where noted.

| Token | Role |
|-------|------|
| `--mn-warning-soft`, `--mn-warning-border` | Warning banners, chips |
| `--mn-overlay` | Drawer / mobile sidebar scrim |
| `--mn-surface-elevated` | Row hover veil |
| `--mn-selection-bg` | Text selection, CodeMirror, xterm |
| `--mn-syntax-command`, `--mn-syntax-name`, `--mn-syntax-inline`, `--mn-syntax-link` | Slash picker, inline code, links |

## Feature-specific (per theme block)

| Token | Role |
|-------|------|
| `--asst-bg`, `--asst-bdr` | Assistant message bubble |
| `--shadow-popover`, `--shadow-sidebar`, `--shadow-drawer`, … | Elevation vocabulary |
| `--tool-call-*` | Tool invocation panels in chat |
| `--thought-bubble-bg`, `--thought-flow-bg`, `--thought-segment-bg` | Thinking UI |
| `--banner-danger-*`, `--settings-warn-banner-*` | Inline warnings |
| `--cm-keyword`, `--cm-title`, `--cm-attr`, `--cm-string` | CodeMirror syntax |

## Layout and motion (`:root`)

Not theme-specific; shared across all palettes.

```css
--radius-sm: 6px;
--radius-md: 10px;
--radius-lg: 14px;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--duration-fast: 0.15s;
--duration-normal: 0.22s;
--duration-slow: 0.35s;
--font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
--font-mono: 'JetBrains Mono', ui-monospace, monospace;
--bp-compact: 600px;
--bp-mobile: 640px;
--bp-wide: 900px;
--topbar-h: 52px;
--sidebar-w: 300px;
--sidebar-rail: 48px;
--file-sidebar-w: 350px;
--file-sidebar-rail: 48px;
--viewer-min-w: 280px;
--split-ratio: 0.55;
--touch-min: 44px;
--chat-msg-max: 900px;
--chat-msg-md-ch: 88ch;
--chat-tool-call-max: 520px;
```

## Typography presets

`--font-ui` and `--font-mono` are the only typography tokens. Stylesheets must use those names — `--mn-font-mono` is not defined, so `var(--mn-font-mono, …)` ignores the user's Appearance → Fonts choice.

Font stacks override via [`src/appearance/fonts.ts`](../../src/appearance/fonts.ts):

- **UI:** `system` plus 30+ Google Sans families (lazy-loaded) and an upload slot. Catalog: [`src/appearance/font-catalog.ts`](../../src/appearance/font-catalog.ts).
- **Mono:** `system` (JetBrains-led stack) plus 20+ Google Mono families including Fira Code, JetBrains Mono, and Cascadia Code (+ upload).

Hierarchy (from DESIGN.md, implemented in CSS):

| Step | Size | Weight | Use |
|------|------|--------|-----|
| Title | 15px | 600 | Top bar title, drawer headers |
| Body | 14px | 400 | Messages, inputs, settings |
| Label | 11px | 600 uppercase | Sidebar sections, stat names |
| Caption | 9–12px | 500 | Model id, hints, chips |
| Mono stat | 17px | 600 tabular-nums | Stats strip values |

## Named rules

**Ink accent rule.** Accent fills primary actions (send, active row border, links). It does not wash large backgrounds except logo mark and send button.

**Metric color rule.** Success/warning/danger are for TPS, TTFT, tokens, errors only.

**72ch rule.** Assistant markdown caps at `min(720px, 72ch)` (`--chat-msg-md-ch` is 88ch for Code workspace).

**Flat chrome rule.** Chrome surfaces do not use box-shadow at rest.
