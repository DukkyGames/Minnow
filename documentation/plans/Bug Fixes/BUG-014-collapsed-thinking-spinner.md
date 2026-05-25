---
name: BUG-014 — Collapsed sidebar thinking spinner
overview: Stop the collapsed-rail work-agent badge from rotating as a whole during thinking; animate only an outer ring like the expanded status dot.
source: documentation/bug-hunt-session-2026-05-24.md (BUG-014)
related:
  - documentation/bug-hunt-session-2026-05-24.md
  - documentation/context.md (Chat list row dot / collapsed sidebar badge)
  - src/styles/sidebar.css
  - src/ui/chat-item-dot.ts
status: verified-open
severity: minor
todos:
  - id: repro-manual
    content: Collapse sidebar, start chat with work-agent badge (RES/BUI), confirm abbrev rotates during thinking SSE
    status: pending
  - id: css-ring-pseudo
    content: Replace badge-level tool-call-spin with ::after ring on .chat-item-agent-badge (position relative; static label)
    status: pending
  - id: match-dot-spinner
    content: Mirror .chat-item-dot__spinner border colors and reduced-motion rule from expanded dot
    status: pending
  - id: expanded-regression
    content: Confirm expanded sidebar dot spinner unchanged; idle/unread/needs-input collapsed badge fills unchanged
    status: pending
  - id: docs-context
    content: Update documentation/context.md collapsed-badge bullet if implementation details change; mark BUG-014 resolved in bug-hunt doc
    status: pending
isProject: false
---

# BUG-014 — Collapsed sidebar: whole chat icon spins (should be ring only)

**Tracker:** [bug-hunt-session-2026-05-24.md](../../bug-hunt-session-2026-05-24.md) — BUG-014 (Minor, Open)  
**Architecture ref:** [context.md](../../context.md) — Chat list row dot, collapsed sidebar + work-agent badge

---

## Summary

When the chat sidebar is **collapsed** to the narrow rail (`.chat-sidebar.collapsed:not(.mobile-open)`), a chat in **thinking** state (`data-dot-state='thinking'`) applies `animation: tool-call-spin` to the entire **work-agent abbrev badge** (`.chat-item-agent-badge`). The glyph and pill border rotate together, so labels like **RES** / **BUI** appear upside down mid-spin.

**Expected:** Abbrev text stays upright; only an outer **accent ring** animates (same semantics as `.chat-item-dot__spinner` in expanded layout).

**No implementation in this document** — plan only (verification completed 2026-05-24).

---

## Verification (2026-05-24)

| Check | Result |
|-------|--------|
| Bug still present in `main` CSS | **Yes** — `sidebar.css` lines 475–480 animate the badge element |
| Expanded dot pattern | **Correct** — child `.chat-item-dot__spinner` spins; dot container does not |
| Scope | Collapsed rail + `data-dot-state='thinking'` + rows with `.chat-item-agent-badge` only |

### Root cause

```475:480:src/styles/sidebar.css
.chat-sidebar.collapsed:not(.mobile-open) .chat-item-row[data-dot-state='thinking'] .chat-item-agent-badge {
  background: transparent;
  color: var(--mn-accent);
  border: 2px solid var(--mn-border);
  border-top-color: var(--mn-accent);
  animation: tool-call-spin 0.75s linear infinite;
}
```

`tool-call-spin` is a **transform rotate** on the element that owns the border and text. Expanded mode avoids this by injecting a separate ring node:

```404:412:src/styles/sidebar.css
.chat-item-dot__spinner {
  display: block;
  width: 8px;
  height: 8px;
  box-sizing: border-box;
  border-radius: 50%;
  border: 2px solid var(--mn-border);
  border-top-color: var(--mn-accent);
  animation: tool-call-spin 0.75s linear infinite;
}
```

---

## Reproduction

1. Assign a work agent to a chat so the row shows `.chat-item-agent-badge` (abbrev).
2. Collapse the chat sidebar (narrow rail, not mobile drawer).
3. Send a message that enters **thinking** (reasoning SSE / `setSidebarStreamPhase('thinking')`).
4. Observe the rail row: whole pill + text rotates.

---

## Recommended fix

**CSS-only** in `src/styles/sidebar.css`:

1. On thinking collapsed badge: `position: relative`, remove `animation` and thinking border from the badge itself (keep `color: var(--mn-accent)`, transparent or subtle fill).
2. Add `::after` (or `::before`) absolutely positioned ring around the badge box:
   - `inset: -2px` (or match dot 2px border)
   - `border-radius` follows pill (`inherit` or slightly larger than badge)
   - Same ring colors as `.chat-item-dot__spinner`
   - `animation: tool-call-spin 0.75s linear infinite` **only on pseudo**
   - `pointer-events: none`
3. Copy `@media (prefers-reduced-motion: reduce)` behavior from dot spinner (disable animation, slight opacity).

**Do not** add DOM from `chat-item-dot.ts` for collapsed badge unless pseudo-element cannot match pill shape — prefer pseudo for parity with zero TS churn.

---

## Acceptance criteria

- [ ] Collapsed rail, thinking: abbrev text does not rotate.
- [ ] Visible accent ring still spins around the badge.
- [ ] `prefers-reduced-motion: reduce` disables spin on ring.
- [ ] Idle / unread / needs-input collapsed badge colors unchanged.
- [ ] Expanded sidebar thinking dot behavior unchanged.

---

## Files

| File | Change |
|------|--------|
| `src/styles/sidebar.css` | Thinking collapsed badge + pseudo ring |
| `documentation/context.md` | Note ring-only animation after fix |
| `documentation/bug-hunt-session-2026-05-24.md` | Mark BUG-014 resolved when shipped |

---

## Out of scope

- Changing when `data-dot-state='thinking'` is set (`chat-item-dot.ts`).
- Mobile drawer (`.mobile-open`) — uses expanded dot + badge side by side per context.md.


---

## Verification (APPROVED)

**Date:** 2026-05-24

**Notes:** Plan verified against codebase (static review). Bug-hunt entry aligned. Ready for implementation unless plan header marks shipped.

**Linear:** [MIN-60](https://linear.app/minnowai/issue/MIN-60/bug-014-collapsed-sidebar-icon-spins)
