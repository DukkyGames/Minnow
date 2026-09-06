# Shape: first-class sub-issues

Confirmed discovery (2026-09-05). Brief confirmed. Implementation landed in the same session.

**Register:** product. **Color:** Restrained (Issues tokens, no per-surface override). **Fidelity:** production-ready. **Breadth:** Issues list, board, peek, row menu. **Time intent:** ship.

## Todos

- [x] Confirm this brief (gate for `/impeccable craft`)
- [x] Peek: Sub-issues section on the parent (list, add new, attach existing, unparent)
- [x] Row / card context menu: Add sub-issue; child rows also get Remove from parent
- [x] Drag an issue onto another issue (list row, board card, open peek) to set `parentId`
- [x] Remove list and board drop-between indicators; stop writing rank from those pointer drops
- [x] Board: drop on empty column still changes status (no insert line)
- [x] Invalid one-level nests: disable or toast with existing `validateParentLink` copy
- [x] Tests for hierarchy UI helpers, drop-to-parent, unparent
- [x] Update `documentation/context.md` and `documentation/manual/apps/issues.md`

## 1. Feature summary

Sub-issues already exist as `parentId` (one level, list nesting, Sub rollup). People cannot see or manage them in peek, and the only in-app create path is a buried `/` command. This work makes parent/child a first-class Issues action: view children on the parent, create or attach from peek and the row menu, parent by dropping one issue on another, and unparent without deleting.

## 2. Primary user action

Open a parent and see its children. Add or drop a child. Remove a child from the parent without destroying the card.

## 3. Design direction

- **Color strategy:** Restrained. Family accent on the drop target and primary add control only.
- **Scene:** A developer on a large monitor, Issues list plus peek, grouping by status, sorting from column headers. They split a parent into children without thinking about manual rank.
- **Anchors:** Linear issue peek (sub-issue list + inline add), Linear drag-onto-issue to parent, Minnow Issues Related list (flat rows, not cards).
- **Theme:** Same Issues chrome as today (`--mn-*`, 36px rows, no nested cards).

Visual probes skipped: this extends the existing Issues vocabulary; it is not a new visual surface.

## 4. Scope

Production-ready shipped UI. List + board + peek + context menu. Interactive, not a mock. Pointer rank-insert is removed in this slice; grouping and header sort remain the order model.

Out of scope:

- Deeper than one level of nesting (store already rejects it)
- Unifying `issueRefs` `parent` / `sub-issue` with `parentId` (Related stays a separate link graph)
- Rewriting the Sub column (it already rollups `parentId` children)
- Board nested cards (board stays flat; parent cards keep the rollup chip)
- Agent `issue_update parent_id` schema (nice follow-up; create still uses `issue_add` + `parent_id`)

## 5. Layout strategy

Peek keeps description first. **Sub-issues** sits with the other document sections (after Plan when present, before Related). It is a titled list, not a card stack.

- Each child: id, title, status. Click opens that issue.
- Trailing unparent control (× or "Remove") on the row. Not Delete.
- Footer add row: **New** (title prompt) and **Existing** (picker). Empty state still shows the section so add is discoverable.
- List already indents `.issues-row.is-child`. Keep that. Sub column shows `done/total` when children exist.
- No insert line between rows or board cards.

## 6. Key states

| State | What the user sees |
| --- | --- |
| Parent, no children | Sub-issues section with short empty copy and New / Existing. Drop target on peek. |
| Parent, 1–N children | List of children; rollup in the Sub column and on the board card. |
| Child peek | No nested Sub-issues editor (one level). Show a Parent line that opens the parent. Menu: Remove from parent. |
| Invalid nest | Control disabled with hint, or toast: unknown parent, self-parent, already a parent, already a child. |
| Drag over valid parent | Row/card/peek highlight (`is-parent-target`), dropEffect `link`. Not the capture veil. |
| Drag over self / illegal | No parent highlight; drop rejected. |
| Drop on empty board column | Status changes. No rank insert line. |
| Capture / file drop | Unchanged. Issue-on-issue drag must not be treated as capture. |
| Filtered parent | Child stays a top-level row in that view (existing `nestSubIssues`). Peek of the parent still lists all children. |

Typical N is 2–8 children. Design for 0 and for ~30 without a new virtualizer.

## 7. Interaction model

**Create.** Row/card menu **Add sub-issue** and peek **New**: `appPrompt` for title, `addIssue({ title, parentId })`, inherit workspace and project from the parent. Same as `/` Sub-issue, minus inserting `#id` in the description (slash path can keep the mention).

**Attach existing.** Peek **Existing**: context menu of eligible issues (not self, not the parent, not a parent that already has children, not a child of someone else unless we reparent). Picking sets `parentId`. Reparenting from another parent is allowed in one step.

**Unparent.** Peek row control and child context menu **Remove from parent**: `parentId: null`. No confirm. Delete stays a separate destructive action.

**Drag.** Dragging an issue (or a multi-selection) onto another issue sets each mover’s `parentId` to the target. Works on list rows, board cards, and the open peek. Invalid movers toast and skip. Dropping on empty board-column space still sets status. List/board **drop-between indicator and rank-from-drop go away**. Alt+↑/↓ rank can remain as a quiet keyboard leftover; it is not part of this UI.

**One level.** `validateParentLink` stays the only rule. A parent with children cannot become a child; a child cannot gain children.

## 8. Content requirements

- Section title: `Sub-issues`
- Empty: `No sub-issues yet.`
- New control: `New`
- Existing control: `Existing`
- Prompt: `Sub-issue title`
- Unparent: `Remove from parent` (menu) / `Remove` (row, `aria-label` includes the child id)
- Menu: `Add sub-issue`
- Child peek parent line: `Parent · KEY-n · title`
- Toasts: existing `validateParentLink` strings; on drop miss, `Drop onto an issue to make it a sub-issue.` is unnecessary if highlight already gated the drop
- Sub column tooltip stays `Sub-issues done / total`

No new illustrations. Status uses existing chips. No metric colors on idle rows.

## 9. Recommended references

- `reference/product.md` (earned familiarity, no invented affordances)
- `reference/interaction-design.md` if present (menus, drop, empty add-row)
- `reference/harden.md` after craft (illegal nest, multi-drag, peek remount)
- `reference/clarify.md` if empty/menu copy feels off in review

## 10. Decisions already locked

- Add = create new **and** attach existing
- Remove = unparent, not delete
- Drop on an issue = parent; **no in-between rank indicator**
- Hierarchy source of truth = `parentId`, not Related `issueRefs`
- Visual lane = current Issues peek/list, not a new aesthetic

## Anti-goals

- Modal-first add (prompt for a title is enough; picker is the existing context menu)
- Nested cards, side-stripe “child” accents, gradient progress on the rollup
- Making Related and sub-issues the same list
- Keeping a ghost insert line “just in case”
- Deleting children when removing them from a parent
