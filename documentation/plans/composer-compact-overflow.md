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
