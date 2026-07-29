# MIN-523 — Memory saved toast

## Goal

Show a global, actionable confirmation whenever Minnow saves an individual Brain wiki page or memory. The confirmation must identify the saved item, briefly describe it, let the user reject the save or open it, and communicate the remaining grace period.

## Product decisions

- Use a compact fixed card rather than the text-only toast primitive because the feedback has content, actions, and a timer.
- Keep one card visible at a time and queue concurrent saves. This avoids stacking over the workspace while ensuring parallel tool saves are not lost.
- Interpret **Reject** as deleting the newly saved item. Failed deletes keep the card visible and surface an explicit error.
- Open wiki pages in Brain Edit. Open legacy memory entries in Brain Memories because their API does not return a page path.
- Use a 10-second default grace period. Pause it while the pointer or keyboard focus is inside the card so users can safely act.
- Include manual Brain saves, `save_memory` and `brain_write_page` tool saves, chat/research capture, and automatic synthesis. Exclude bulk ingest and schema writes because they are not individual memory confirmations.

## UI and accessibility

- Announce the card with a polite status region.
- Keep title and description text-only and clamp long content.
- Use existing `--mn-*` theme tokens, the central icon registry, and the product button vocabulary.
- Animate entry, exit, and the bottom progress line with compositor-friendly properties.
- Disable nonessential transitions when reduced motion is requested; keep the timer line as a static state indicator.
- Ensure both actions have visible keyboard focus and at least a 40px interaction height.

## Implementation todos

- [x] Add a reusable memory-saved card with queue, pause, progress, reject, open, and error states.
- [x] Add payload builders for wiki pages, legacy memories, capture results, synthesis pages, and successful tool results.
- [x] Wire manual Brain page and memory saves.
- [x] Wire successful `save_memory` and `brain_write_page` chat tool outcomes.
- [x] Wire chat/research capture and automatic synthesis writes.
- [x] Add theme-aware responsive styles and import them from the application entry.
- [x] Add deterministic DOM tests for rendering, queueing, expiry, tool parsing, reject, and open behavior.
- [ ] Run type checking, targeted tests, build, and a browser walkthrough.
- [ ] Update `documentation/context.md`.

## Acceptance checks

1. A successful memory save shows its title and a useful plain-text excerpt.
2. The timer line visibly decreases and the card dismisses after the grace period.
3. Hovering or focusing the card pauses expiry; leaving resumes it.
4. Reject deletes the corresponding memory/page and reports failures.
5. Open memory navigates to the correct Brain surface.
6. Failed tool calls do not show a saved card.
7. Multiple near-simultaneous saves are shown in order.
8. The card remains usable on narrow viewports and with reduced motion.
