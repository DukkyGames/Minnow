# Shape: status icons

Confirmed 2026-09-06. Gate for `/impeccable craft`.

**Register:** product. **Color:** Restrained (existing status chip tints; glyph inherits). **Fidelity:** production-ready. **Breadth:** Issues chips (list, peek, board cards, change-status menus) + Settings statuses table. **Time intent:** ship.

Visual probes skipped: extends type-icon picker and status chips; not a new surface.

## Todos

- [x] Confirm this brief (gate for `/impeccable craft`)
- [x] Persist `icon` on status taxonomy rows (same field as types; validate against the shared picker)
- [x] Settings → Issues statuses table: Icon column + same grid picker as types
- [x] Seed defaults for built-in statuses; resolve missing icons on existing taxonomies (no wipe)
- [x] Status chips: glyph beside label (list, peek, board cards, change-status menus)
- [x] Shared picker: keep type glyphs, add workflow glyphs used by defaults
- [x] Tests + `documentation/context.md` / Issues manual if the shipped surface changes

## 1. Feature summary

Statuses stay labeled chips. Each status also gets a Flaticon Uicons glyph, chosen in **Settings → Issues** the same way types are. Developers scanning the list or peek see **icon + uppercase label**, not icon-only (that stays a type-column trick).

## 2. Primary user action

Read status at a glance, then change it. Settings is where they assign a glyph to a custom status.

## 3. Design direction

- **Color strategy:** Restrained. Chip tints stay as they are (triage warning, in-progress accent, done success). The glyph inherits chip color; no extra metric wash.
- **Scene:** A developer on a large monitor, Issues list plus peek, grouping by status. They are sorting work, not decorating a dashboard.
- **Anchors:** existing type icon picker, Linear status chips (icon + label), Minnow Uicons in `icon.ts` (inbox, check-circle, cross-circle).
- **Theme:** Same Issues chrome (`--mn-*`, 36px rows, existing `.issues-status-chip`).

## 4. Scope

Production-ready shipped UI. List + peek + board cards + status menus + Settings statuses table.

Out of scope:

- Grouping header icons
- Board column-title icons
- Priority icons
- Custom SVG upload
- Animated in-progress spinner

## 5. Layout strategy

Reuse `.issues-status-chip`: inline-flex, glyph then label, ~12–14px icon, existing 10px uppercase type. Settings Icon column matches types (button opens the grid). Menu rows that change status show the same glyph + label, not a second chip style.

## 6. Key states

| State | What the user sees |
| --- | --- |
| Built-in status | Default glyph + label on every status chip |
| Custom status, no icon yet | Fallback `fi-sr-box` until they pick one |
| Unknown status id | Existing dashed unknown chip; fallback glyph |
| Settings row | Icon button; picking writes `icon` and saves taxonomy |
| Restore defaults | Built-in statuses get the mapping below; issue values stay |

## 7. Interaction model

Same as types: click the settings icon cell → grid → select → persist. Clicking a list/peek/board status chip still opens the status menu. Glyph is not a separate hit target.

## 8. Content requirements

No new user-facing copy. Settings column header: **Icon**.

Default mapping:

| Status | Glyph | Why |
| --- | --- | --- |
| Triage | `fi-rr-inbox` | Incoming queue |
| Backlog | `fi-sr-box` | Parked work |
| Todo | `fi-sr-clipboard-list` | Ready list |
| Planned | `fi-sr-calendar` | Scheduled |
| In progress | `fi-sr-bolt` | Active; static, not a spinner |
| Review | `fi-rr-search` | Looking at the work |
| Done | `fi-rr-check-circle` | Closed complete |
| Canceled | `fi-rr-cross-circle` | Closed discarded |

**Picker:** one shared catalog. Keep the current type set; add at least `fi-rr-inbox`, `fi-rr-search`, `fi-rr-check-circle`, `fi-rr-cross-circle` (and `fi-rr-clock` / `fi-rr-play` as extras, not defaults). Types and statuses both pick from that grid.

Media: Flaticon Uicons webfont already imported. No new rasters.

## 9. Recommended references

- `reference/product.md` (earned familiarity)
- `reference/harden.md` after craft (invalid icon, old taxonomy without `icon`)

## 10. Decisions already locked

- Display = icon beside text on every status chip (list, peek, board cards, change-status menus)
- Settable = Settings statuses table, same picker UX as types
- Catalog = shared, extended
- Grouping headers and board column titles stay text-only
- In progress does not spin

## Anti-goals

- Icon-only status chips (types stay icon-only in the list column)
- Extra metric color on the glyph beyond existing chip tint
- Side-stripe or status-dot replacing the chip
- Modal icon picker
