# Feature 17 — Chat scroll during stream — verification

**Feature ID:** `feature-17-chat-scroll-during-stream`  
**Epic:** C3 — stick-to-bottom + Jump to latest

## Automated

```bash
npm test
```

Includes `test/ui/chat-scroll.test.mjs` (`isChatAtBottom` threshold math, scroll listener pin toggle, jump re-pin).

## Manual QA

1. **Baseline stream:** Send a long prompt; stay at bottom → transcript follows automatically.
2. **Detach during prose:** Scroll up mid-stream → viewport stable; chip visible; new tokens do not pull you down.
3. **Re-attach:** Click **Jump to latest** → tail visible; auto-follow resumes until scroll up again.
4. **Thinking phase:** Scroll up during thought-only phase → no yank on reasoning/typewriter ticks.
5. **Tool loop:** Scroll up while tools run → tool cards append without yank; jump works.
6. **User send:** After scrolling up, send a new message → pins to bottom and follows new reply.
7. **Chat switch:** Switch sidebar chat → loads at bottom (forced).
8. **Mobile:** Narrow layout — chip not hidden under composer.
9. **Terminal unchanged:** Terminal output still pins at 24px independently.

## Plan review (ship)

- [x] `src/ui/chat-scroll.ts` — 80px threshold, `stickToBottom`, jump chip
- [x] No duplicate `scrollBottom` in `loop.ts` / `chat.ts`
- [x] `initChatScroll()` in `main.ts` after terminal init
- [x] `#chatJumpLatest` in `index.html` + styles
- [x] `documentation/context.md` updated
