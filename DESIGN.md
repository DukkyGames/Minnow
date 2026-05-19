# SpeedChat — Design system

## Color strategy

**Restrained** — OKLCH tinted neutrals (hue ~250) plus one accent (~220) for primary actions and focus. Success / warning / danger for metric semantics only.

## Tokens

| Token | Role |
|-------|------|
| `--bg` | App background |
| `--surface` | Chrome, input bar, stats footer |
| `--surface-elevated` | Assistant bubbles, hover rows |
| `--border` / `--border-strong` | Dividers |
| `--text` / `--text-muted` | Body and labels |
| `--accent` / `--accent-dim` | Primary actions, focus rings |
| `--success`, `--warning`, `--danger` | Metric strip and chips |

Legacy aliases (`--cyan`, `--text-dim`, etc.) map to the above for gradual migration.

## Typography

- **UI:** `system-ui` stack, 14px base, scale ratio ~1.2
- **Mono:** JetBrains Mono for stats strip, token counts, model meta, code-like labels
- Max chat line length ~72ch inside bubbles

## Radius and motion

- Radius: `--radius-sm` 6px, `--radius-md` 10px, `--radius-lg` 14px
- Easing: `--ease-out` cubic-bezier(0.16, 1, 0.3, 1), 200ms transitions
- Respect `prefers-reduced-motion`

## Layout

- Top bar 52px; session sidebar 240px (48px collapsed)
- Stats strip: desktop single row; mobile collapsed summary + expand
- Breakpoints: 600px, 900px

## Bans (enforced)

No scanlines, hero-metric top stripes, logo/status glow, gradient text, or pure #000/#fff.
