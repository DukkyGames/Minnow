# Issues peek display

Shape confirmed 2026-08-17: description-first document, collapsed empty sections, compact sticky.

## Todos

- [x] Compact sticky: ID, icon Close, more menu (Delete), borderless title, type/status/priority chips, labels, one workflow row
- [x] Description is the page: no "Description" heading, no boxed editor, toolbar only while focused
- [x] Empty Code / Attachments / Git collapse to one add-row; omit empty Plan and Related
- [x] Activity is a footer caption, not a headed section
- [x] Tests for the peek DOM contract
- [x] Update `documentation/context.md` and the Issues manual (stale click-to-edit copy)

## Sticky

Pinned chrome is identity + dispatch, not a form.

- ID left; Close (icon) and a more menu (Delete) right
- Title is a borderless heading input
- Type / status / priority are the same chips as the list, with the shared context menu (no native `<select>`)
- Labels stay inline
- Send to chat is primary; Send to background stays ghost on the same row

## Scroll

The description is the document. Everything else is secondary and earns space only when it has content.

- No restated empty copy ("No code links yet")
- Empty code: one add row
- Empty attachments: Attach only (drop/paste still work on the panel)
- Empty git: Create branch + Link… (commit/URL fields behind the link control; commits appear only when grep finds some)
- Plan / Related omitted when empty
- GitHub stays absent when the mode is off; unlinked is a single Push control

## Out of scope

Assignee, project, and list-row editing. Those stay on the row.
