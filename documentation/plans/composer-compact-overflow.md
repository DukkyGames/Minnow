# Composer compact overflow (hub + active chat)

Shape brief for collapsing the Code composer toolbar when the chat column is too narrow. Applies to both `.input-bar--hub` (new chat) and `.input-bar` (active chat).

## Feature summary

When the composer controls row is squeezed, the labelled mode segments, Local/branch chips, reasoning, context-doc/map/brain toggles, model chip, and Tools sliders fight for one row. Hub currently lets the mode strip shrink (`min-width: 0`) and clip; active chat hides labels but still overlaps. Compact density keeps mode, context wheel, and model on the row, and moves everything else behind a new overflow cog.

## Primary user action

Type a message. Mode, model, and context usage stay glanceable. Secondary composer settings stay one click away and never clip the mode control.

## Design direction

- **Register:** product. **Color strategy:** Restrained (existing `--mn-*` tokens; no new palette).
- **Scene:** A developer at a desk with Code split so the chat column is ~650–720px, afternoon indoor light, focused on sending the next turn. The composer is a bench instrument, not a dashboard.
- **Anchors:** Cursor composer overflow menu, VS Code compact editor toolbar, Linear density (one row, no wrapping chrome).
- **Theme:** Existing family themes (default swamp-dark). Do not introduce a compact-only color language.

## Scope

- **Fidelity:** production-ready, shipped in Code.
- **Breadth:** both Code composers (hub + active chat). Not Super Plan, Research, Chat-app, or companion composers unless they reuse `#composerControls`.
- **Interactivity:** shipped-quality component (resize, keyboard, popover).
- **Time intent:** polish until it ships.

## Decisions (confirmed)

1. **Trigger:** width threshold, not live overflow measuring. Compact whenever `#composerControls` is narrower than **880px**, even if a few extra icons would still fit. Hysteresis: leave compact only above **920px** so the row does not flicker.
2. **Compact visible row:** mode dropdown (current mode icon + label + chevron), context usage wheel, model name + icon, new overflow **cog**. Nothing else on the row.
3. **Wide row:** keep labelled General / Build / Plan / Debug segments when they fully fit (above the threshold). Tools sliders stay on the trail as today.
4. **New overflow cog**, separate from Tools. Compact: Tools is a section inside the cog popover, not its own trail button. Wide: Tools sliders remain on the trail; the cog is hidden.
5. **Mode must never clip.** Compact dropdown is `flex-shrink: 0` with intrinsic width. Hub must stop giving `.mode-segmented` `min-width: 0` / `flex: 1 1 auto` in compact. No `overflow-x: auto` clipping of segments.

## Layout strategy

Wide (≥920px leave / >880px enter):

`[ General | Build | Plan | Debug ]  Local  main  thinking  effort  docs  map  brain  wheel  ···  model  tools`

Compact (<880px):

`[ Plan ▾ ]  (wheel)  ···  (model icon + truncated name)  (cog)`

The cog popover is a fixed-position settings sheet above the button (same family as the existing tools popover: border, `--mn-bg`, no glass, no modal). Vertical rows, not a second toolbar. Nested menus (Local, branch, Tools list) open from those rows; do not clip inside `overflow: hidden` on `.composer-controls__trail`.

## Key states

| State | What the user sees |
|---|---|
| Wide | Current labelled segments + inline chips + trail Tools. Cog hidden. |
| Compact | Mode dropdown + wheel + model + cog. Overflowed controls not on the row. |
| Compact + cog open | Popover with Local, branch, thinking, reasoning effort, context docs, code map, brain notes, Tools (existing permissions UI), plus Orchestrate plan / board-view / work-agent when those controls are visible. |
| Compact + mode menu open | Current mode highlighted; General / Build / Plan / Debug. Super Plan stays a top-bar destination, not a fifth item. |
| Board-managed chat | Mode control stays hidden (today). Compact row is wheel + model + cog. |
| Expert scope | Mode + thinking already hidden. Compact still collapses the rest behind the cog. |
| Resize across threshold | Instant layout swap (opacity/visibility, no layout animation). Open popovers close on swap. |
| Reduced motion | No transform choreography; popover appears/disappears. |

## Interaction model

- **Threshold** via `ResizeObserver` on `#composerControls`. Class `composer-controls--compact` on the row (and/or `.input-bar`).
- **Mode dropdown** only in compact: one button, `aria-haspopup="listbox"`, same `setChatMode` path as segments. Keyboard: Arrow/Home/End/Enter/Escape, same as a listbox.
- **Cog:** `fi-rr-settings` (gear), `aria-label="Composer settings"`, `aria-expanded`, `aria-controls` the overflow popover. Click-outside and Escape close. Do not reuse `#btnComposerTools` as the host.
- **Tools in compact:** render the existing tools popover body as a section inside the overflow sheet (or port the list into a compact section). Opening Tools from the cog must not also show the trail sliders button.
- **Context wheel** stays a live control on the row (breakdown still opens above the ring).
- **Model trigger** stays on the row; label may ellipsize, logo + chevron never shrink away.

## Content / copy

- Cog: `aria-label="Composer settings"`; tooltip `Composer settings`.
- Mode dropdown: `aria-label` stays `Operating mode, {label} selected`.
- Overflow section labels reuse existing control names (Local, branch, Reasoning effort, Tools). No new marketing copy.

## Anti-goals

- Not a hamburger that hides mode or model.
- Not wrapping the toolbar onto two rows.
- Not icon-only mode segments that clip on the hub.
- Not merging overflow into the existing Tools sliders button.
- Not a modal.

## Implementation todos

- [x] Add compact class + ResizeObserver threshold (880 / 920 hysteresis) shared by hub and active chat
- [x] Compact mode control: dropdown from current mode; never shrink/clip; keep labelled segments when wide
- [x] New overflow cog + popover; move Local, branch, thinking, effort, docs/map/brain, Tools (and other visible extras) into it when compact
- [x] Compact trail: only model chip + cog; hide inline Tools sliders while compact
- [x] CSS: remove hub `min-width: 0` clip path in compact; popover `position: fixed` to escape overflow
- [x] Tests for threshold, mode dropdown, and “mode never clips”; update `documentation/context.md`

## Recommended Impeccable references (craft)

`reference/adapt.md`, `reference/layout.md`, `reference/interaction-design.md`, `reference/harden.md`

## Open questions

None that block implementation. Threshold 880/920 is an asserted default from the 665px / 710px overflow screenshots; tune only if QA shows the wide strip still clips just above 920px.

---

## Polish brief (compact row + overflow sheet)

Visual pass on the shipped compact overflow. Trigger, parking, and wide-row behavior stay. The compact row and cog sheet need a real layout, not a dump of toolbar widgets.

### Feature summary

A developer in a ~650–720px Code chat column should still type a message without fighting chrome. Compact keeps mode, model, context usage, and a settings cog **inside** the composer card. The cog opens one settings sheet: labeled rows for parked toggles, then the full Tools catalog in the same scroll.

### Primary user action

Send the next turn. Glance mode, model, and context. Open the cog only for Local/branch, reasoning, injection toggles, or tool permissions.

### Design direction

- **Register:** product. **Color strategy:** Restrained (`--mn-*` only).
- **Scene:** Same as above: split Code column, afternoon indoor light, next-turn focus.
- **Anchors:** Cursor composer overflow, VS Code compact toolbar, Linear settings rows.
- **Visual probes:** skipped. This is a density pass on an existing surface, not a new visual lane.

### Confirmed topology (2026-08-18)

1. **Cog stays inside the composer card**, on the compact row. It does not sit in the send column or stack above Send. Hub and active-chat `.composer-controls` stay in the composer column (`grid-column: 1`), not `1 / -1`.
2. **Swap cog and context wheel** vs the first compact layout:
   `[ Mode ▾ ]  (cog)  ···  (model, may ellipsize)  (wheel)`
   Board-managed (no mode): `(cog)  ···  (model)  (wheel)`.
3. **Parked toggles are labeled rows** in the sheet: icon + name + control. Wide toolbar stays icon-only.
   - Reasoning (effort select on the same row when the model uses levels)
   - Context documents
   - Code map
   - Brain notes
4. **Keep the full Tools catalog** in the sheet. Flatten it: one popover scroll, no nested bordered panel, no inner `max-height` / inner scrollbar. Header row is `Tools` + Enable all, then groups, then Web search / cache / All tool settings as the last section of the same sheet.

### Layout strategy

**Compact row (inside the card, column 1 only):**

```
[ Mode ▾ ]  (cog)          (model · provider)  (wheel)     |  [Send]
[ textarea + inset actions                             ]
```

- Mode never shrinks. Cog is `flex-shrink: 0`.
- Compact **moves the cog in the DOM** to sit after the mode dropdown (flex `order` 1–4: mode, cog, trail/model, wheel). Do not use `display: contents` on the trail — that dropped the cog onto a second row.
- Model takes leftover space and ellipsizes; logo + chevron stay.
- Wheel is the last compact control, still live (breakdown opens above the ring).
- Send stays a single glyph in the send stack. No cog above it.

**Overflow sheet (single scroll, ~26rem, max 70vh):**

1. Local + branch chips (wrap row, unchanged controls)
2. Labeled toggle rows (tight 8px sibling gap)
3. Optional Orchestrate / board / work-agent rows when those wraps are visible
4. Hairline, then Tools header + Enable all
5. Tool groups (existing Full / Ask / Off segments; group summary padding 10px 12px)
6. Web search, cache checkbox, All tool settings

Sheet uses `display: contents` (or equivalent unwrap) on `.composer-tools-popover` while parked so its header, list, and footer are siblings of the toggle rows. `.tools-list--composer` overflow is visible; only `.composer-overflow-popover` scrolls.

### Key states

| State | What the user sees |
|---|---|
| Compact | Mode, cog, model, wheel inside the card. Send alone in the send column. |
| Compact + cog open | One sheet above the cog. Labeled rows, then flattened Tools. One scrollbar. |
| Compact + tools group open | Group expands in the same sheet; sheet grows then scrolls. |
| Wide | Unchanged labelled segments + inline chips + trail Tools. Cog hidden. Labels on injection toggles stay hidden. |

### Interaction model

Unchanged: cog toggle, click-outside, Escape, close on compact/wide swap. Tools fill still runs when the sheet opens. Nested Local/branch menus stay `position: fixed`.

### Anti-goals

- Nested cards or a second scroll inside the sheet
- Glass, extra shadow vocabulary, or a compact-only palette
- Moving mode or model behind the cog
- Two-row composer chrome
- Changing 880 / 920 thresholds in this pass

### Implementation todos

- [x] Constrain compact (and hub) composer-controls to the composer column so the cog never sits above Send
- [x] Compact row order: mode, cog, model, context wheel (DOM move + flex order; not display:contents)
- [x] Overflow labeled rows for reasoning / docs / map / brain (wide stays icon-only)
- [x] Flatten Tools into the overflow sheet: one scroll, no nested panel, Tools + Enable all on one header row
- [x] Sheet width/padding/group density; drop inner tools `max-height`
- [x] Tests for compact order + overflow flattening; update `documentation/context.md`

### Recommended Impeccable references

`reference/layout.md`, `reference/quieter.md`, `reference/interaction-design.md`, `reference/harden.md`

---

## Bugfix: sheet behind chats sidebar

The cog sheet used `position: fixed; z-index: 36` while still a descendant of `#mainColumn`. That column sets `container-type: inline-size`, which creates a stacking context. `.chat-sidebar` is a flex sibling at z-index 36, so the sheet painted under the chats list. End-aligning a ~26rem sheet to the left-side cog also placed it at ~171px, overlapping the 300px sidebar.

### Todos

- [x] Portal `#composerOverflowPopover` to `document.body` while open (same pattern as the model menu)
- [x] Raise sheet stacking to `z-index: 1200` (above sidebar 36 / resizer 37)
- [x] Clamp placement into `#mainColumn` when the sheet fits; viewport-clamp otherwise
- [x] Tests for clamp math + portal restore; note in `documentation/context.md`

---

## Redesign brief (two-page sheet, 2026-08-19)

Confirmed: the cog is this-turn controls. Tools is a second page. Compact row stays `[Mode ▾] [cog] [model] [wheel]`. Probe B (inline controls) + C trimmed (no Web search / cache on the Tools page).

### Feature summary

The compact cog opens a two-page composer sheet. Page 1 is this-turn controls with live editors. Page 2 is Tools permissions, reached only from a chevron row. Web search and cache stay in Settings and in the wide Tools popover.

### Primary user action

Change reasoning or a context toggle for the next send, then close. Opening Tools is a deliberate second step.

### Design direction

- **Register:** product. **Color:** Restrained (`--mn-*` only). Sage accent only on selected High, ON, and Full.
- **Scene:** Developer at a desk with Code split so the chat column is about 650–720px, afternoon indoor light, focused on the next turn.
- **Anchors:** Linear settings rows (page 1), VS Code / Cursor overflow drill-in (page chrome), existing Minnow Full / Ask / Off (page 2).

### Layout

**Page 1:** Local + branch, labeled reasoning / docs / map / brain rows (Low | Medium | High when the model has levels), optional Orchestrate extras, then a Tools nav row.

**Page 2:** Back + Tools + Enable all. Quiet status line. Group rows that expand in place. All tool settings. No web search, no cache.

Escape closes the whole sheet from either page. Back returns to page 1.

### Todos

- [x] Page 1: identity + inline rows; Tools is a nav row only
- [x] Reasoning: segments when levels apply; toggle when on/off only
- [x] Page 2: back header, group rows, quiet status, Enable all, All tool settings
- [x] Hide Web search + cache in the compact Tools page only
- [x] Keyboard: drill-in, Back, Escape closes, focus restore
- [x] Tests + `documentation/context.md` + design-system layout-shell note

