# MIN-630 — Drag from tab to chat

## Goal

Drag a Code editor tab or in-app browser tab onto the chat transcript or composer and pin a durable **link chip** on that chat (file path or URL). The chip is the same class as other chat links (`.code-ref-link`), survives reload, and is not only this-turn composer context.

## Assumptions

- File-tree drops stay this-turn attachments (existing MIN-410 behavior).
- Tab drops pin a standing link on the chat instead of queueing a one-turn attachment.
- Clicking a file chip opens the viewer; clicking a URL chip opens the in-app browser.
- Empty browser tabs (no URL / workspace source) are not linkable.
- Attachment-snapshot editor tabs (`.minnow/attachments/…`) are not linkable.

## Todos

- [x] Persist `Chat.links` through session normalize / reload
- [x] Tab drag MIME payloads (`viewer-tab` / `preview-tab`) without breaking tab reorder
- [x] Drop targets: chat transcript + composer
- [x] Durable chip strip using `.code-ref-link`
- [x] Inject pinned links into the system prompt (paths/URLs, not file bodies)
- [x] Tests + docs
