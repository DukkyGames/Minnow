# Files sidebar close icon — chevron right when open

**Summary:** When the file tree sidebar is expanded, show a **right-pointing chevron** on the collapse control (collapse toward the workspace), matching chat sidebar affordance semantics.

**Backlog:** [`documentation/plans/to-fix.md`](../to-fix.md) — line 8

---

## Problem statement

The file sidebar toggle always shows a **document / file-tree icon** (`ICON_FILE_TREE`), even when the panel is open. Users expect a directional chevron indicating “push closed to the right,” consistent with the chat sidebar (`ICON_CHEVRON_LEFT` when open, `ICON_CHEVRON_RIGHT` when collapsed).

---

## Current behavior

| State | Chat sidebar (`#btnSidebarCollapse`) | File sidebar (`#btnFileSidebarCollapse`) |
|-------|--------------------------------------|----------------------------------------|
| Desktop expanded | Chevron left (collapse left) | File tree SVG always |
| Desktop collapsed | Chevron right | File tree SVG always |
| Mobile | Chevron left/right based on overlay | File tree SVG; labels “Close/Open file tree” |

**Key paths:**

- Chat: `src/ui/layout.ts` `applySidebarVisuals()` — toggles `ICON_CHEVRON_LEFT` / `ICON_CHEVRON_RIGHT` from `src/constants.ts`
- File: `src/ui/file-layout.ts` `applyFileSidebarVisuals()` — always `btn.innerHTML = ICON_FILE_TREE` (line ~54)
- Markup: `index.html` `#btnFileSidebarCollapse` on `#fileSidebar` header
- Styles: `src/styles/file-panel.css` (`.file-sidebar-toggle`)

---

## Proposed solution

### 1. Mirror chat sidebar icon logic

In `applyFileSidebarVisuals()`:

| Layout | `fileSidebarCollapsed` / mobile open | Icon | `aria-label` |
|--------|-----------------------------------|------|----------------|
| Desktop | expanded (`!collapsed`) | `ICON_CHEVRON_RIGHT` | Collapse file tree |
| Desktop | collapsed | `ICON_FILE_TREE` or `ICON_CHEVRON_RIGHT` | Expand file tree — **prefer chevron right when collapsed rail** (match chat: collapsed shows chevron right pointing “expand”) |
| Mobile | overlay open | `ICON_CHEVRON_RIGHT` | Close file tree |
| Mobile | overlay closed | `ICON_FILE_TREE` | Open file tree |

Align exactly with chat sidebar pattern in `layout.ts`:

- Expanded → chevron points into collapse direction (file panel is left of workspace → **right** chevron to collapse).
- Collapsed rail → chevron indicates expand direction.

### 2. Optional dual icon

Keep small file glyph + chevron for brand recognition — only if design wants; to-fix asks specifically for chevron when open, so **v1: chevron when open, file icon when fully closed/collapsed** is sufficient.

### 3. CSS

- Ensure `icon-svg` size matches `.file-sidebar-toggle` hit target.
- No change to `onclick="toggleFileSidebarLayout()"`.

---

## Implementation todos

- [ ] Import `ICON_CHEVRON_RIGHT` (and left if needed) in `file-layout.ts`
- [ ] Update `applyFileSidebarVisuals()` icon branch logic per table above
- [ ] Verify desktop collapsed rail vs expanded width states
- [ ] Verify mobile overlay open uses right chevron
- [ ] Update `documentation/context.md` top bar / file tree bullet (chevron when open)
- [ ] Add DOM test in `test/ui/file-sidebar-toggle.test.mjs` (or extend existing file panel tests)

---

## Files to change

| File | Change |
|------|--------|
| `src/ui/file-layout.ts` | Chevron vs file icon logic |
| `src/constants.ts` | Already exports chevrons — no change expected |
| `src/styles/file-panel.css` | Optional alignment tweak |
| `test/ui/file-sidebar-toggle.test.mjs` | Assert innerHTML contains chevron path when open |
| `documentation/context.md` | UX note |

---

## Testing plan

1. Desktop: expand file sidebar — button shows right chevron; click — sidebar collapses.
2. Desktop: collapsed — icon per spec (chevron or file tree); expand works.
3. Mobile ≤640px: open overlay — right chevron; close — restores open icon.
4. Visual: compare with chat sidebar — directions feel consistent.
5. `npm test` UI test if added.

---

## Risks / open questions

- **Brand:** Losing file icon on open panel — acceptable per user request?
- **Viewer open:** `viewerOpen` split pane — icon state independent of viewer (no change).
- **Top bar:** Former `#btnFileTreeToggle` removed — no regression there.
