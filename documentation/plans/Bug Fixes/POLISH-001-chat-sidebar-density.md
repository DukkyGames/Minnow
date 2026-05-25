# POLISH-001 — Denser chat sidebar session rows

| Field | Value |
|-------|-------|
| **ID** | POLISH-001 |
| **Type** | Polish / UX (not a defect) |
| **Status** | Requested |
| **Source** | [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) — Polish / UX table |
| **Scope** | CSS-only density pass on expanded chat sidebar session list |
| **Related** | POLISH-017 (pin chats — sort/sections; complements denser rows), BUG-014 (collapsed-rail thinking spinner — separate) |

---

## Summary

Session rows in the chat sidebar (`.chat-item-row`) feel tall (~86px measured in bug hunt with title + model + stats). The goal is to **squish** rows so more chats are visible without scrolling: less row padding, tighter list gap, and smaller spacing between meta lines — while preserving readability, hover/active semantics, collapsed-rail behavior, and touch accessibility on coarse pointers.

No DOM or persistence changes are required for this item.

---

## Problem statement

**Observed:** Each session row stacks three visual bands (title/actions, model id, stats preview). Vertical padding and meta `margin-top` add up so a typical row occupies roughly **86px** of list height.

**Desired:** A noticeably denser list on **fine pointer / desktop** (mouse and trackpad), aligned with the existing **file tree row density** pattern (compact default, touch floor under `pointer: coarse`).

**Non-goals for POLISH-001:**

- Pinning / reordering chats (POLISH-017)
- Hiding model or stats lines (would need product decision + possibly TS)
- Changing sidebar width (`--sidebar-w: 240px`)
- Collapsed-rail thinking animation fix (BUG-014)
- New user preference or density slider

---

## Current implementation (audit)

### DOM structure (unchanged)

Built in [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts) — `appendChatRow()`:

```
.chat-item-row
  .chat-item-head
    .chat-item-title-row
      .chat-item-dot
      .chat-item-name
      [.chat-item-agent-badge]
    .chat-item-actions
      .chat-rename-btn
      .chat-delete-btn
  .chat-item-model
  .chat-item-stats
```

List container: `#chatList` with class `.chat-list`. Section headers use `.chat-list-section-head` (e.g. Unassigned).

### Styles today

| Rule | File | Current value | Role |
|------|------|---------------|------|
| `.chat-list` | [`src/styles/sidebar.css`](../../../src/styles/sidebar.css) | `gap: 2px`, `padding: 4px 8px 10px` | List rhythm |
| `.chat-item-row` | `sidebar.css` | `padding: 6px 10px` | Row shell |
| `.chat-item-model` | `sidebar.css` | `font-size: 9px`, `margin-top: 2px` | Meta line 1 |
| `.chat-item-stats` | `sidebar.css` | `font-size: 9px`, `margin-top: 2px`, `line-height: 1.25` | Meta line 2 |
| `.chat-item-name` | `sidebar.css` | `font-size: 11px` | Title |
| `.chat-rename-btn`, `.chat-delete-btn` | `sidebar.css` | `28×28px` (fine); `--touch-min` (coarse) | Actions |
| `.chat-item-row` (coarse) | [`src/styles/responsive.css`](../../../src/styles/responsive.css) | `padding-top/bottom: 10px` | Touch floor |
| Collapsed rail `.chat-item-row` | `sidebar.css` | `padding: 8px 4px` | Icon-only rail |

Documented in [`documentation/context.md`](../../context.md) (Layout → Chat list density).

### Precedent: file tree density (E4)

[`src/styles/file-panel.css`](../../../src/styles/file-panel.css) — `.file-tree-row`:

- Default: `padding: 2px 6px 2px 4px`, `min-height: 0`
- `@media (pointer: coarse)`: `min-height: var(--touch-min)`, larger padding

POLISH-001 should mirror this **split**: compact fine-pointer layout, unchanged coarse-pointer floor.

### Approximate row height (expanded, fine pointer)

| Component | Approx. contribution |
|-----------|----------------------|
| Row padding (6+6) | 12px |
| Title row (28px actions) | 28px |
| Model margin + line | 2 + ~11px |
| Stats margin + line (1.25 lh) | 2 + ~11px |
| **Total** | **~64–66px** + list `gap` |

Bug-hunt **~86px** may include measurement with longer stats text, agent badge, or browser rounding; treat **~86px → ~58–64px** as a reasonable success band (~25–30% reduction) without crushing meta lines.

---

## Proposed changes

CSS-only edits in **`sidebar.css`** and, if needed, **`responsive.css`**. Prefer adjusting existing rules over new tokens unless reuse is obvious.

### 1. Row padding (fine pointer default)

| Selector | From | To (proposed) |
|----------|------|----------------|
| `.chat-item-row` | `6px 10px` | `4px 8px` |

Keeps horizontal inset for border-radius and focus ring; saves **4px** vertical per row.

### 2. List gap and list padding

| Selector | From | To (proposed) |
|----------|------|----------------|
| `.chat-list` `gap` | `2px` | `1px` (or `0` if still readable) |
| `.chat-list` `padding` | `4px 8px 10px` | `3px 6px 8px` (optional, minor) |

### 3. Meta line spacing

| Selector | From | To (proposed) |
|----------|------|----------------|
| `.chat-item-model` `margin-top` | `2px` | `1px` |
| `.chat-item-stats` `margin-top` | `2px` | `1px` |
| `.chat-item-stats` `line-height` | `1.25` | `1.2` (optional) |

Saves **2px** between meta lines. Do **not** reduce meta `font-size` below **9px** without a design pass (already minimal).

### 4. Title row / actions (fine pointer only)

| Selector | From | To (proposed) |
|----------|------|----------------|
| `.chat-rename-btn`, `.chat-delete-btn` | `28×28px` | `24×24px` |
| `.chat-rename-btn`, `.chat-delete-btn` `font-size` | `18px` | `16px` (if glyphs look balanced) |

**Keep** `@media (pointer: coarse)` override at `--touch-min` (44px) — no change to `responsive.css` coarse row padding unless visual QA shows rows still feel short on touch devices.

### 5. Collapsed rail

| Selector | From | To (proposed) |
|----------|------|----------------|
| `.chat-sidebar.collapsed .chat-item-row` | `padding: 8px 4px` | `padding: 6px 4px` |
| `.chat-sidebar.collapsed:not(.mobile-open) .chat-list` | `padding: 6px 4px` | `padding: 4px 4px` |

Verify: agent badge centering, dot hidden when badge present, thinking ring — especially with BUG-014 in mind (do not regress rail hit targets).

### 6. Section headers (optional, same PR)

| Selector | From | To (proposed) |
|----------|------|----------------|
| `.chat-list-section-head` | `margin: 10px 4px 4px` | `margin: 8px 4px 3px` |

Small gain between workspace block and Unassigned section.

### 7. Out of scope alternatives (document only)

- **Single meta line:** concatenate model + stats in `sidebar.ts` — denser but less scannable; defer unless product asks.
- **Stats on hover:** hide `.chat-item-stats` until hover — saves height but hurts at-a-glance token info; not recommended without explicit UX sign-off.
- **CSS variable** `--chat-row-density` — only if other surfaces will share; YAGNI for one polish item.

---

## Files to touch

| File | Change |
|------|--------|
| [`src/styles/sidebar.css`](../../../src/styles/sidebar.css) | Primary density tweaks (rows, list, meta, collapsed rail, optional section head) |
| [`src/styles/responsive.css`](../../../src/styles/responsive.css) | **Only if** QA shows fine-pointer rules leaking into coarse layout; otherwise leave `padding: 10px` coarse floor |
| [`documentation/context.md`](../../context.md) | Update “Chat list density” bullet after implementation with final pixel values |

**No changes expected:**

- `src/ui/sidebar.ts`
- `src/ui/chat-item-dot.ts`
- Tests (no automated layout assertions today)

---

## Accessibility and responsive constraints

1. **Coarse pointer (`pointer: coarse`):** Row vertical padding stays **10px**; action buttons stay **`--touch-min` (44px)** per [`responsive.css`](../../../src/styles/responsive.css).
2. **Focus:** `.chat-item-row:focus-visible` outline unchanged.
3. **Screen readers:** `aria-label` on row still includes name, model, stats — density is visual only.
4. **Mobile drawer (≤640px):** Collapsed sidebar opens full-width overlay; expanded row layout applies — confirm meta lines do not clip with `text-overflow: ellipsis`.
5. **Tablet sidebar (641–899px):** Context notes **200px** width — ensure truncated titles still readable at smaller font sizes (no font change planned).

---

## Verification

### Manual checklist

- [ ] **Desktop expanded sidebar:** Row height visibly reduced; ~8–12 sessions visible vs before in same viewport (subjective).
- [ ] **Hover (fine pointer):** Non-active row uses elevated fill; title and rename/delete readable (light text on dark hover wash).
- [ ] **Active row:** Accent border/background unchanged.
- [ ] **Rename/delete:** Click targets work at 24px; no mis-clicks on row select.
- [ ] **Long chat name / model id / stats:** Ellipsis still applied; `title` tooltip on row still useful.
- [ ] **Agent badge row:** Badge + dot layout in expanded mode; collapsed rail badge centered.
- [ ] **Collapsed rail (desktop):** Dots/badges centered; row tap switches chat.
- [ ] **Mobile:** Open session drawer; rows meet touch height; footer toggles still 44px.
- [ ] **Unassigned section:** Header spacing still separates groups.
- [ ] **Themes:** Light and dark — meta subtle colors still legible.

### Automated

```bash
npx tsc --noEmit
npm test
```

No new tests required unless adding a snapshot-style DOM/CSS contract test is desired later (low ROI for polish).

### Measurement (optional during implementation)

In DevTools, measure `.chat-item-row` **offsetHeight** for a chat with model + stats filled — record before/after in PR notes. Target **~58–64px** fine-pointer row (down from ~86px bug-hunt note).

---

## Implementation todos

- [ ] **Audit baseline** — Measure 2–3 representative `.chat-item-row` heights (with/without stats, with agent badge) in expanded sidebar.
- [ ] **Apply density CSS** — `sidebar.css` per tables in § Proposed changes (fine pointer + collapsed rail).
- [ ] **Coarse-pointer QA** — Touch device or emulator; confirm `responsive.css` floor unchanged.
- [ ] **Collapsed rail QA** — Badge/dot/thinking states; note any BUG-014 interaction.
- [ ] **Mobile drawer QA** — ≤640px overlay list.
- [ ] **Update context.md** — Chat list density bullet with final values.
- [ ] **Mark POLISH-001** in bug-hunt session doc as done when shipped (separate doc edit).

---

## Rollout and risk

| Risk | Mitigation |
|------|------------|
| Rows feel cramped / meta unreadable | Stop at proposed values; do not shrink fonts; revert meta `line-height` if needed |
| Touch targets too small on hybrid devices | Rely on `pointer: coarse` media query, not `max-width` alone |
| Collapsed rail too tight | Keep rail padding ≥6px vertical |
| POLISH-017 adds “Pinned” header | Section head margins already optional tweak; re-check density when pins land |

**Rollback:** Revert `sidebar.css` hunk only; no data migration.

---

## Follow-ups (not POLISH-001)

| ID | Relationship |
|----|----------------|
| POLISH-017 | Pin section at top — more rows visible if POLISH-001 done first |
| BUG-014 | Collapsed rail thinking spinner — visual, not density |
| File tree | Already dense; use as parity reference only |

---

## References

- Bug hunt: [`documentation/bug-hunt-session-2026-05-24.md`](../../bug-hunt-session-2026-05-24.md) (POLISH-001 row)
- Row builder: [`src/ui/sidebar.ts`](../../../src/ui/sidebar.ts)
- Styles: [`src/styles/sidebar.css`](../../../src/styles/sidebar.css), [`src/styles/responsive.css`](../../../src/styles/responsive.css)
- Density precedent: [`src/styles/file-panel.css`](../../../src/styles/file-panel.css) (`.file-tree-row`)
- Architecture note: [`documentation/context.md`](../../context.md) — Layout → Chat list density


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-101](https://linear.app/minnowai/issue/MIN-101/polish-001-chat-sidebar-density)
