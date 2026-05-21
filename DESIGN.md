---
name: Minnow
description: Light-first LM Studio chat client with optional dark mode (OKLCH token inversion), black/paper accent, semantic metric colors.
colors:
  bg: "oklch(100% 0.00011 271.152)"
  surface: "oklch(100% 0.00011 271.152)"
  surface-elevated: "oklch(0% 0 0 / 0.84)"
  border: "oklch(28.094% 0.00003 271.152)"
  border-strong: "oklch(0.34 0.028 250)"
  text: "oklch(31.714% 0.00004 271.152)"
  text-muted: "oklch(0.52 0.028 250)"
  text-hover: "oklch(100% 0.00011 271.152)"
  accent: "oklch(0% 0 0)"
  accent-subtle: "oklch(27.685% 0.00003 271.152)"
  success: "oklch(0.72 0.14 155)"
  warning: "oklch(0.8 0.12 85)"
  danger: "oklch(0.62 0.18 15)"
  overlay: "oklch(0.12 0.02 250 / 0.65)"
  user-bg: "oklch(88.769% 0.2563 138.508 / 0.336)"
  user-bdr: "oklch(0.72 0.12 220 / 0.28)"
  code-bg: "oklch(0.97 0.012 250)"
  code-inline-bg: "oklch(0.94 0.015 250)"
typography:
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.06em"
  mono:
    fontFamily: "'JetBrains Mono', ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  topbar-h: "52px"
  sidebar-w: "240px"
  sidebar-rail: "48px"
  touch-min: "44px"
components:
  send-btn:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.text-hover}"
    rounded: "{rounded.md}"
    size: "44px"
  icon-btn:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    size: "40px"
  icon-btn-hover:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.bg}"
    rounded: "{rounded.sm}"
---

# Design System: Minnow

## Dark theme

`<html data-theme="dark">` (set from Settings → General → Appearance or the inline boot script) overrides [`src/styles/tokens.css`](src/styles/tokens.css): surfaces drop to ~11–12% L (cool 271 hue), text and borders invert L, **accent** becomes near-paper for controls, **surface-elevated** becomes a light wash on dark chrome (hover rows use `--elevated-fg` for readable labels). Semantic **success / warning / danger** stay the same hues for the stats strip. **highlight.js** loads `github-dark` via an injected link when dark; CodeMirror uses `--cm-*` variables tied to the same tokens. `theme-color` meta updates at runtime; PWA manifest colors stay light defaults.

## Overview

**Creative North Star: "The Bench Instrument"**

Minnow reads like a light workbench: white surfaces, ink-black controls, and a thin grid of borders instead of stacked cards. Conversation is the focus; the stats strip and chips are instrumentation layered underneath, not a dashboard selling KPIs. The palette stays restrained: neutrals carry the UI, black handles primary action and selection, and green / amber / red appear only where metrics need semantic color.

The system rejects neon HUD chrome, purple-gradient chat clones, hero metric cards, glassmorphism, and gradient text. Depth comes from borders and subtle gray fills, not drop shadows on every panel.

**Key Characteristics:**

- Light OKLCH neutrals (hue ~271) on `--bg` and `--surface`; no pure `#fff` / `#000` literals in tokens (values are tinted or transparent).
- Black `--accent` for logo mark, send button, active session border, links, and fine-pointer hover fills on icon buttons.
- User messages use a soft green wash (`--user-bg`); assistant messages stay flat on `--bg` with a hairline border.
- JetBrains Mono for stats strip, chips, token bars, and code; system UI stack at 14px elsewhere.
- Flat elevation: mobile sidebar shadow only; code blocks use `oklch(0.97 0.012 250)` lifts, not floating cards.

## Colors

A restrained light palette: cool near-white grounds, graphite text, black accent, semantic metrics unchanged.

### Primary

- **Ink Black** (`oklch(0% 0 0)`): Logo mark fill, send button, active chat row border, streaming cursor, focus outlines, markdown links. Hover on icon buttons inverts to black fill with white icon stroke.

### Secondary

- **Bench Green (user trace)** (`oklch(88.769% 0.2563 138.508 / 0.336)`): User message bubble background only; keeps the thread readable without a second "brand" color fighting the accent.

### Tertiary

- **Metric semantics** (success `oklch(0.72 0.14 155)`, warning `oklch(0.8 0.12 85)`, danger `oklch(0.62 0.18 15)`): Stats strip values, stat chips (`.c` / `.g` / `.y` / `.r`), status dot ok/err, token fill bars. Do not use for chrome or marketing blocks.

### Neutral

- **Sheet White** (`oklch(100% 0.00011 271.152)`): `--bg`, `--surface`, top bar, sidebar, input bar, stats strip, drawer.
- **Graphite** (`oklch(31.714% 0.00004 271.152)`): Primary body text.
- **Ash Label** (`oklch(0.52 0.028 250)`): Muted labels, placeholders, stat names, sidebar section title (tuned for WCAG AA on sheet white).
- **Hairline** (`oklch(28.094% 0.00003 271.152)` / `oklch(0.34 0.028 250)`): `--border` and `--border-strong` dividers, assistant bubble outline, table cells.
- **Hover Veil** (`oklch(0% 0 0 / 0.84)`): `--surface-elevated` for sidebar row hover and stats expand hover (dark wash on light UI).
- **Scrim** (`oklch(0.12 0.02 250 / 0.65)`): Settings drawer and mobile sidebar backdrop.

### Named Rules

**The Ink Accent Rule.** Black accent appears on primary actions, selection, and links. It does not tint large backgrounds except the logo mark and send button.

**The Metric Color Rule.** Green, amber, and red are for measurement only (TPS, TTFT, tokens, errors). Never use them for navigation chrome or decorative gradients.

## Typography

**Display Font:** Not used (product UI, no marketing hero type).

**Body Font:** `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` (14px base, line-height 1.5).

**Label/Mono Font:** JetBrains Mono (400–600 from Google Fonts) for stats strip, per-message chips, token counts, fenced code, and field hints that reference code.

**Character:** Calm technical sans for UI; mono carries numeric instrumentation. No display serif or geometric marketing face.

### Hierarchy

- **Title** (600, 15px, -0.02em tracking): App title in top bar, drawer header.
- **Body** (400, 14px, 1.5): Messages, inputs, drawer fields, chat list names.
- **Label** (600, 11px, 0.06em uppercase): Sidebar "Chats", stats expand label, stat cell names.
- **Caption** (500, 9–12px): Session model id, sidebar stats line, stat chips, field hints.
- **Mono stat** (600, 17px tabular-nums): Stats strip values; chips at 9px uppercase with bold inner span.

### Named Rules

**The 72ch Rule.** Assistant markdown bubbles cap at `min(720px, 72ch)` for readable line length. User bubbles use full width of the column with pre-wrap.

## Elevation

Flat-by-default. Surfaces share `--surface` / `--bg`; separation is borders, not cards.

### Shadow Vocabulary

- **Mobile sidebar** (`box-shadow: 4px 0 24px oklch(0.1 0.02 250 / 0.4)`): Only when the session list is a fixed overlay (≤640px).
- **Focus rings**: `outline: 2px solid var(--accent)`; inputs also set `border-color: var(--accent)` (`--accent-dim` is transparent, so no glow ring).
- **Code / table lift**: Inline code `oklch(0.94 0.015 250)`; fenced `pre` and table headers `oklch(0.96–0.97 0.01–0.012 250)` on the light page.

### Named Rules

**The Flat Chrome Rule.** Top bar, sidebar, input bar, and stats strip do not use box-shadow at rest. If it looks like a floating SaaS card, remove the shadow.

## Components

### Buttons

- **Shape:** `--radius-sm` (6px) icon buttons; `--radius-md` (10px) send and message input.
- **Icon button:** 40×40px, transparent, 1px `--border`. Fine-pointer hover: black fill, white stroke (`--text-hover` on label color).
- **Send:** 44×44px black square; icon stroke near-white. Hover: white fill, black border, dark icon stroke, slightly larger icon (27px).
- **New chat (sidebar):** Outlined black border/text; hover fills black with white text.
- **Drawer clear:** Ghost border; hover border and text `--danger`.

### Chips

- **Style:** 9px uppercase, 1px border `--border-strong`, text `--text-dim`.
- **Semantic variants:** `.c` accent, `.g` success, `.y` warning, `.r` danger with matching border alpha tints.

### Cards / Containers

- **Message bubbles:** `--radius-lg` (14px); user = green wash, no border; assistant = `--bg` + 1px `--border`, one corner squared toward the speaker.
- **Session row:** Transparent default; hover `--surface-elevated` + border; active black border + transparent `--accent-dim` fill.
- **No nested cards** in chat or settings.

### Inputs / Fields

- **Style:** `--bg` fill, 1px `--border`, `--radius-sm`, 14px UI font.
- **Focus:** Border `--accent`; `box-shadow: 0 0 0 3px var(--accent-dim)` (dim token is transparent in current theme, so border carries focus).
- **Composer:** `#msgInput` min-height 44px (16px font on compact ≤600px to avoid iOS zoom).

### Navigation

- **Top bar:** 52px, border-bottom, model select embedded with custom chevron.
- **Session sidebar:** 240px / 48px rail; 200px at 641–899px; mobile overlay with scrim.
- **Settings drawer:** Right sheet `min(420px, 100vw - 16px)`, slide-in 0.22s `--ease-out`.

### Stats strip (signature)

- **Desktop:** Grid of metric cells with mono values and small SVG icons tinted by semantic class.
- **Compact (≤600px):** Collapsed "Metrics" row; tap expands `.stats-strip.is-expanded`.
- **Token bars:** 6px track `--border`; fills use warning (prompt) and success (completion).

## Do's and Don'ts

### Do:

- **Do** use OKLCH tokens from `:root` in `index.html`; keep legacy aliases (`--cyan` → `--accent`) when touching older rules.
- **Do** respect `prefers-reduced-motion` and limit transitions to color, border, opacity, and transform (not layout).
- **Do** use `(hover: hover) and (pointer: fine)` for hover-heavy styles; keep 44px touch targets on session actions.
- **Do** treat stats as instrumentation: mono, tabular nums, compact chips.

### Don't:

- **Don't** use neon cyber HUD patterns (scanlines, glowing dots, Rajdhani wordmarks).
- **Don't** mimic generic ChatGPT clones (cream cards, purple gradients).
- **Don't** build hero-metric dashboards (giant KPI cards with colored top stripes).
- **Don't** use glassmorphism or gradient text (`background-clip: text`).
- **Don't** add colored `border-left` stripes on cards or alerts.
- **Do** keep `theme-color` meta in sync with effective `--bg` (see `initTheme` / `applyResolvedTheme` in [`src/ui/theme.ts`](src/ui/theme.ts)); PWA manifest defaults remain light.
