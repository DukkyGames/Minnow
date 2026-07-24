---
name: Email Inbox Productivity Tools
overview: Add familiar inbox selection, bulk actions, context menus, and drag-to-folder workflows without changing Minnow's calm local-instrument design language.
todos:
  - id: selection-state
    content: Add deterministic thread selection and action-target helpers.
    status: completed
  - id: bulk-api
    content: Expose folder-scoped message ids on thread summaries and add a safe mark-all-read endpoint.
    status: completed
  - id: toolbar
    content: Add the inbox master checkbox, standard mail actions, move and snooze menus, and unread-scope Read all.
    status: completed
  - id: row-interactions
    content: Add row checkboxes, quick star, keyboard focus, right-click menus, and drag payloads.
    status: completed
  - id: folder-drop
    content: Turn rail folders into accessible drag targets and route drops back to the active inbox.
    status: completed
  - id: verification
    content: Add deterministic tests, run the Email suite and build, then verify all flows in the browser.
    status: completed
isProject: true
---

# Email Inbox Productivity Tools

## Outcome

Make Minnow Email feel complete for daily inbox triage:

- Select one, several, every conversation on the current page, or every conversation in the folder/view (via the post–select-all banner).
- Use a familiar action toolbar for archive, spam, trash, read state, snooze, star, and move.
- Mark every result in the Unread view as read without selecting page by page.
- Open the same actions from a row context menu.
- Drag one conversation or the current selection onto a folder in the rail.
- Use keyboard navigation and selection without interfering with compose fields.
- Keep mutations mailbox-scoped, reversible where the server supports moving a stable message id back to its source folder, and explicit about partial failure.

## Shape brief

Register: product.

Physical scene: a solo builder clears mail between coding sessions on a desktop monitor in mixed daylight, switching between dense scanning and a focused reader. The interface must stay calm in every Minnow light or dark theme and make standard actions recognizable without decorative chrome.

Color strategy: restrained. Existing `--mn-*` surfaces and the family accent communicate selection, focus, and drop targets. Danger is reserved for trash. No new palette roles, shadows, gradients, or card containers.

Interaction hierarchy:

1. The scope marker becomes a stable list toolbar.
2. A native tri-state checkbox is the first control.
3. With no selection, show refresh, Unread-view Read all, search, and keyboard help.
4. With a selection, replace low-priority controls with the selected count and bulk actions.
5. Every row gets a persistent checkbox and quick star. The subject area remains the open target.
6. The context menu and keyboard shortcuts call the same action functions as the toolbar.

## Product decisions

### Selection semantics

- The master checkbox selects every conversation on the current page. When the folder holds more than one page, a banner offers selecting the whole folder or clearing folder-wide selection.
- A page change, search change, account change, or rail scope change clears selection.
- Shift-click selects the contiguous range from the last selection anchor.
- Right-clicking an unselected row makes that row the action target. Right-clicking a selected row preserves the current group.
- Dragging an unselected row moves only that conversation. Dragging a selected row moves the full selection.
- Bulk actions apply to messages from the active source folder only. They never move Sent or Archive copies merely because those messages share a thread id.

### Toolbar actions

- Always available when appropriate: select all, refresh, search, keyboard help.
- Selected conversations: archive, report spam, trash, mark read or unread, snooze, star or unstar, move to folder, clear selection.
- The read-state label is derived from the selection. If any selected conversation is unread, the primary action is Mark read; otherwise it is Mark unread.
- The star label follows the same rule: Star when any selected conversation is unstarred, otherwise Unstar.
- Read all appears in the Unread scope even with no selection. It acts on all matching unread messages in the current folder and search, not only the visible page.
- Snooze offers deterministic presets: later today, tomorrow morning, next Monday, and one week. The toolbar displays it only for a real mailbox, not unified mode.

### Context menu

- Actions: Open, Mark read or unread, Star or unstar, Archive, Snooze, Move to, Report spam, Trash.
- It uses `role="menu"`, focuses the first item, supports Arrow Up, Arrow Down, Home, End, Enter, Space, and Escape, and restores focus to the invoking row.
- It opens from right-click, Shift+F10, and the Context Menu key.
- It is clamped to the viewport and closes on outside pointer input, resize, scroll, or route remount.

### Drag and drop

- Rows publish a private Minnow Email MIME payload containing account id, source folder, and thread ids.
- Native `text/plain` is only a fallback label and contains no message body.
- Rail folders accept a drag only when the account matches and the folder differs from the source.
- A highlighted folder shows the move destination. Dropping runs the same move action as the toolbar.
- The dragged row and selected rows show a muted moving state. All temporary classes clear on drag end and failed drops.

## Data and API work

### Thread summaries

`listCachedThreads` will include `messageIds` scoped to the requested folder. The client `EmailThreadSummary` type will expose the field. This avoids one request per selected conversation and prevents cross-folder thread mutations.

### Mark all read

Add `POST /api/email/accounts/:id/messages/mark-all-read` with:

```json
{
  "folder": "INBOX",
  "query": ""
}
```

The store resolves unseen message ids in the folder, applies the optional FTS query, and the mail action layer updates flags in bounded chunks. The response reports attempted, updated, and failed counts. Empty results succeed with zero counts.

### Existing bulk endpoint

Reuse `POST /api/email/messages/bulk` for selected rows. Add `spam` as an allowed action so the server resolves the provider's junk folder by special-use role instead of guessing a client-side folder name.

## File ownership for implementation

### Backend and data agent

- `server/email/cache.js`
- `server/email/mail-actions.js`
- `server/email/imap-actions.js`
- `server/email/middleware.js`
- `src/email/client.ts`
- `src/email/client-ext.ts`
- `test/email/mail-store.test.mjs`
- focused mail-action tests

Deliver scoped action ids, spam, and mark-all-read. Do not edit inbox or rail UI.

### Interaction primitives agent

- new `src/ui/email/email-selection.ts`
- new `src/ui/email/email-context-menu.ts`
- focused tests under `test/ui/`

Deliver pure selection helpers and an accessible reusable context menu. Do not edit inbox, rail, panel, or CSS.

### Integration agent

- `src/ui/email/email-inbox.ts`
- `src/ui/email/email-rail.ts`
- `src/ui/email/email-panel.ts`
- `src/ui/email/email-icons.ts`
- `src/styles/email.css`
- integration-focused UI tests

Wire the planned behavior using the backend and primitive contracts. Keep the reader behavior unchanged.

## Error handling

- Disable the action bar while a bulk request is active.
- Keep selection when a request fails so the user can retry.
- On partial failure, reload the page and report the exact failed count.
- On success, clear selection, refresh summary counts, and reload the current page.
- Move, archive, spam, and trash offer Undo by moving stable ids back to the source folder.
- Mark-all-read reports zero as “No unread mail” rather than an error.
- Context and move menus show an empty state when no valid destination exists.

## Accessibility and responsive behavior

- Native checkboxes keep platform semantics and visible `:focus-visible` rings.
- Rows use listbox/option semantics with `aria-selected`; the subject open target remains a real button.
- Icon-only actions have `aria-label`, `title`, and a disabled state.
- Controls meet the existing 40px desktop target and 44px compact target.
- At narrow widths, toolbar labels collapse before controls wrap. Destructive and overflow actions remain reachable from More.
- Hover styling stays behind fine-pointer media queries.
- Reduced-motion mode removes menu entrance and drag feedback animation.

## Verification

### Automated

1. Selection reducer: toggle, select page, clear, shift range, stale-id pruning, and action target resolution.
2. Thread summary action ids: folder scope, shared thread across folders, empty folder, and pagination.
3. Mark-all-read query: unread only, folder only, FTS-filtered, empty result, chunking, and partial failure response.
4. Context menu keyboard traversal and close behavior in Happy DOM.
5. Drag payload validation: malformed payload, account mismatch, same-folder rejection, and selected-group payload.
6. Existing Email suite, TypeScript typecheck, production build, and test coverage check.

### Browser

1. Start Minnow with an isolated `MINNOW_HOME` fixture that contains deterministic cached mail.
2. Open Email and verify default, Unread, Flagged, and folder scopes.
3. Select one row, Ctrl-click several, Shift-click a range, select all, and clear.
4. Exercise every toolbar action and Undo where offered.
5. Open the context menu by pointer and keyboard. Traverse and execute with the keyboard.
6. Drag one row and a multi-selection to a folder. Verify source removal, target count, and drop feedback.
7. Run Read all in Unread with and without a search.
8. Check reader open/close, keyboard shortcuts, focus rings, reduced motion, compact width, and a light and dark theme.
9. Confirm no console errors, failed requests, or external network requests.

## Out of scope

- Cross-account bulk actions in All inboxes.
- IMAP labels that are not represented as folders.
- Permanent delete.
- A custom date-time snooze dialog.
- New email provider authentication.
