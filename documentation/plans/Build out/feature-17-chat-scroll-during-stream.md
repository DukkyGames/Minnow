---
name: feature-17-chat-scroll-during-stream
overview: Let users read chat history while the model streams by mirroring the terminal panel’s stickToBottom pattern on #chatArea, with a Jump to latest chip when detached.
todos:
  - id: chat-scroll-module
    content: Add src/ui/chat-scroll.ts with pin threshold, stickToBottom state, scroll listener, and chip UI
    status: pending
  - id: consolidate-scroll-callers
    content: Route all scrollBottom call sites through chat-scroll (remove duplicates in loop.ts and chat.ts)
    status: pending
  - id: wire-init-and-styles
    content: initChatScroll in main.ts, index.html host, messages.css for jump chip
    status: pending
  - id: tests-and-verify
    content: Unit tests for at-bottom math; manual stream QA; update context.md when shipped
    status: pending
  - id: verify-docs
    content: Complete documentation/plans/verification/feature-17.md (plan review + manual QA on ship)
    status: pending
isProject: false
---

# Feature 17 — Chat scroll during stream

**Feature ID:** `feature-17-chat-scroll-during-stream`  
**Epic:** C — Chat UX and control  
**Backlog:** [`documentation/plans/product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md) — **C3**  
**Wave:** 1 (visible polish; parallel-safe with **A1** per backlog)  
**Size:** S  
**Status:** Build plan (not yet implemented)  
**Depends on:** None (terminal `stickToBottom` pattern already exists)  
**Blocks:** Nothing. **Coordinates with:** **C4** (`feature-05-thinking-duration`) — shared `scrollBottom` call sites must stay pinned-aware; **C1** (`feature-14-stop-generation`) — do not regress abort/finally scroll behavior.

### Backlog alignment (C3)

| Backlog wording | Build plan decision |
| ---------------- | ------------------- |
| Current: `scrollBottom()` forced on every delta; terminal has `stickToBottom` | Mirror terminal pattern in new `src/ui/chat-scroll.ts`; leave terminal at 24px unchanged. |
| Goal: chat `stickToBottom` within ~80px; listener toggles flag; “Jump to latest” when detached | `CHAT_PIN_THRESHOLD_PX = 80`; `#chatJumpLatest` chip in `#mainColumn`. |
| Acceptance: scroll up during stream → no yank; button returns to live tail | **AC1** / **AC2** below + manual U1–U9 in verification doc. |

**Out of scope (v1):** Stop generation (**C1** / `feature-14`), message actions (**C2** / `feature-15-16-17`), scroll offset persistence per `chatId` (**B2**-adjacent), terminal jump chip.

---

## Schema / API

None. Client-only scroll state and DOM; no `sessions.json` / server changes.

---

## Acceptance criteria

| # | Criterion |
| --- | --------- |
| AC1 | While the model streams (prose, thinking/typewriter, tools), scrolling up keeps the viewport stable — new content does not yank the view down. |
| AC2 | When detached, a **Jump to latest** control is visible; activating it scrolls to the live tail and resumes auto-follow until the user scrolls up again. |
| AC3 | When the user is within ~80px of the bottom, streaming updates auto-scroll to the tail (pinned behavior). |
| AC4 | Sending a new user message or starting a new assistant stream row re-pins (`pinChatScroll` / force scroll per call-site table). |
| AC5 | Switching chats via `renderChatFromHistory` opens at the bottom (forced). |
| AC6 | Terminal panel `stickToBottom` (24px) unchanged. |
| AC7 | `npm test` includes `test/ui/chat-scroll.test.mjs` (or `.mts`) for at-bottom math. |

---

## Problem

Today every streaming update forces the chat viewport to the bottom. Users cannot read earlier messages while the assistant is thinking, typing prose, rendering markdown, growing thought bubbles, or running tools.

```18:21:src/ui/input.ts
export function scrollBottom(): void {
  const area = document.getElementById('chatArea')!;
  area.scrollTop = area.scrollHeight;
}
```

That helper is exported from `input.ts` and invoked from many hot paths (SSE deltas, debounced markdown, thought typewriter, tool rows). The terminal panel already solves the same UX with a local `stickToBottom` flag and a scroll listener.

---

## Goal

Implement **chat `stickToBottom`** on `#chatArea`:

| Behavior | Detail |
| -------- | ------ |
| Auto-scroll | Only when the user is within **~80px** of the bottom (backlog threshold; terminal uses 24px on `#terminalOutput` intentionally). |
| Detach | Scrolling up during a stream must **not** yank the viewport back down. |
| Re-attach | A **“Jump to latest”** chip appears when detached; click forces scroll to tail and re-enables stick. |
| New activity | Sending a message or starting a new assistant turn should **pin** again (same as `beginCommandOutput` resetting `stickToBottom` in the terminal). |

---

## Reference implementation — terminal panel

Mirror these pieces from [`src/ui/terminal-panel.ts`](../../../src/ui/terminal-panel.ts):

| Terminal | Chat (proposed) |
| -------- | ---------------- |
| Module flag `stickToBottom` (default `true`) | Same on `#chatArea` |
| `scrollOutputIfPinned()` before assigning `scrollTop` | `scrollChatIfPinned()` |
| `setupOutputScroll()` — `scroll` listener sets flag from distance to bottom | `setupChatAreaScroll()` |
| `beginCommandOutput` → `stickToBottom = true` | `pinChatScroll()` on user send / new stream row |
| Threshold `24px` on output | Threshold **`80px`** on chat (larger padding/gap in `.chat-area`) |

```71:74:src/ui/terminal-panel.ts
function scrollOutputIfPinned(): void {
  if (!outputEl || !stickToBottom) return;
  outputEl.scrollTop = outputEl.scrollHeight;
}
```

```309:315:src/ui/terminal-panel.ts
function setupOutputScroll(): void {
  outputEl?.addEventListener('scroll', () => {
    if (!outputEl) return;
    const atBottom =
      outputEl.scrollHeight - outputEl.scrollTop - outputEl.clientHeight < 24;
    stickToBottom = atBottom;
  });
}
```

**Do not** change terminal behavior in this feature.

---

## Current scroll call sites (audit)

| File | When | Today | After |
| ---- | ---- | ----- | ----- |
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) | Every SSE `handleChunk` (~line 358) | Force bottom | **If pinned** |
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) | Tool call / result DOM append (684, 705) | Force bottom | **If pinned** |
| [`src/tools/loop.ts`](../../../src/tools/loop.ts) | `finally` after send completes (845) | Force bottom | **If pinned** (or force if send ended successfully and user was pinned — same effect) |
| [`src/api/chat.ts`](../../../src/api/chat.ts) | Legacy `sendMessagePlain` stream (391, 496) | Local duplicate `scrollBottom` | Import shared module; **if pinned** |
| [`src/ui/messages.ts`](../../../src/ui/messages.ts) | `renderChatFromHistory` end (176) | Force bottom | **Force** (chat switch / reload) |
| [`src/ui/messages.ts`](../../../src/ui/messages.ts) | `appendBubble` (204) | Force bottom | **Force** if user message; **if pinned** if assistant history replay |
| [`src/ui/messages.ts`](../../../src/ui/messages.ts) | `appendStreamingAssistantRow` (269) | Force bottom | **Force** (new turn from user send) |
| [`src/markdown/renderer.ts`](../../../src/markdown/renderer.ts) | Debounced streaming render (113) | Force bottom | **If pinned** |
| [`src/ui/thought-bubbles.ts`](../../../src/ui/thought-bubbles.ts) | Typewriter / reasoning ticks (342) | Force bottom | **If pinned** |
| [`src/ui/input.ts`](../../../src/ui/input.ts) | Exported `scrollBottom` | Force bottom | Re-export or thin delegate to `chat-scroll` |

**Primary send path:** [`src/chat/messaging.ts`](../../../src/chat/messaging.ts) → `sendMessageWithTools` in `loop.ts` (not `api/chat.ts`).

**Duplicates to remove:** private `scrollBottom()` in `loop.ts` (lines 285–288) and `chat.ts` (69–72).

---

## Design

### New module: `src/ui/chat-scroll.ts`

Single owner for chat viewport scroll behavior.

**Constants**

- `CHAT_PIN_THRESHOLD_PX = 80` — distance from bottom to count as “at bottom”.
- Optional: `CHAT_JUMP_CHIP_ID = 'chatJumpLatest'`.

**State**

- `let stickToBottom = true`
- Cached `chatAreaEl: HTMLElement | null` (resolve `#chatArea` once in `initChatScroll`).

**API (exported)**

| Function | Purpose |
| -------- | ------- |
| `initChatScroll()` | Resolve elements, attach scroll listener, wire jump chip click, call once from `main.ts` after DOM ready. |
| `isChatAtBottom(el?)` | `scrollHeight - scrollTop - clientHeight <= CHAT_PIN_THRESHOLD_PX` |
| `pinChatScroll()` | Set `stickToBottom = true` (do not scroll). Use when user sends or new stream shell is created. |
| `scrollChatIfPinned()` | If pinned, set `scrollTop = scrollHeight`; update chip visibility. |
| `scrollChatToBottom()` | Unconditional scroll + `stickToBottom = true` + hide chip. Use for explicit “jump” and history reload. |
| `isChatScrollPinned()` | Test helper / optional UI. |

**Scroll listener** (on `#chatArea`)

- On `scroll`, set `stickToBottom = isChatAtBottom()`.
- Toggle jump chip: visible when `!stickToBottom`.
- Use `{ passive: true }` for performance.

**Jump chip**

- Markup in [`index.html`](../../../index.html): place inside `#mainColumn`, **after** `#chatArea`, before `#toolApprovalHost` — e.g. `<button type="button" id="chatJumpLatest" class="chat-jump-latest hidden" aria-label="Jump to latest messages">Jump to latest</button>`.
- Position: `position: absolute` within `#mainColumn` so it floats above the message list, centered horizontally, ~16px above the composer / tool-approval strip. **Today** [`.main-column`](../../../src/styles/sidebar.css) has no `position: relative` — add it (or a wrapper) in this feature so the chip anchors correctly.
- Click: `scrollChatToBottom()`.
- Keyboard: focusable button; Enter/Space activate.

**Smooth scroll note:** `.chat-area` sets `scroll-behavior: smooth` in [`src/styles/messages.css`](../../../src/styles/messages.css). Rapid streaming may feel sluggish if every pinned tick uses smooth scrolling. **Recommendation:** for programmatic auto-scroll only, temporarily set `area.style.scrollBehavior = 'auto'`, assign `scrollTop`, then restore previous value in `requestAnimationFrame` — or add a `.chat-area--instant-scroll` utility class during streams. Document choice in implementation; default to **instant** for `scrollChatIfPinned`.

### Back-compat: `input.ts`

Keep `export function scrollBottom()` as an alias to `scrollChatIfPinned()` (or deprecate name in favor of explicit imports). Minimizes churn in `messages.ts`, `thought-bubbles.ts`, `renderer.ts` if those only need pinned behavior — but **audit** each caller against the force vs pinned table above.

---

## Implementation steps

### 1. Create `chat-scroll.ts`

- [ ] Implement threshold helper, flag, pinned/unconditional scroll, chip show/hide.
- [ ] `initChatScroll()` registers listener and chip handler.
- [ ] Comment non-obvious threshold vs terminal (80 vs 24).

### 2. Markup and styles

- [ ] Add `#chatJumpLatest` to `index.html`.
- [ ] Add `.chat-jump-latest` to `messages.css` (or small `chat-scroll.css` imported from `main.ts`): pill button, `var(--surface)` / border, shadow, `z-index` above messages, respects dark tokens.
- [ ] Ensure chip does not overlap tool-approval strip when visible (`#toolApprovalHost`).

### 3. Wire initialization

- [ ] Call `initChatScroll()` from [`src/main.ts`](../../../src/main.ts) immediately after `await initTerminalPanel()` (~L169), before first `renderChatFromHistory`.

### 4. Update call sites

- [ ] `loop.ts`: delete local `scrollBottom`; import `scrollChatIfPinned` / `pinChatScroll`; call `pinChatScroll()` at each `appendStreamingAssistantRow()` (initial send ~L560 and tool-loop continuation ~L717); pinned scroll in `handleChunk` and tool loops; `finally` uses pinned scroll.
- [ ] `chat.ts`: remove duplicate; use shared helpers.
- [ ] `messages.ts`: `renderChatFromHistory` → `scrollChatToBottom()`; `appendBubble` user → force; assistant replay → pinned; `appendStreamingAssistantRow` → `pinChatScroll()` + `scrollChatToBottom()`.
- [ ] `renderer.ts`, `thought-bubbles.ts`: `scrollChatIfPinned()` only.
- [ ] `input.ts`: delegate `scrollBottom` to pinned helper or re-export documented behavior.

### 5. Chat switch / clear

- [ ] On `switchChat` / `createChat` (via `renderChatFromHistory`): `scrollChatToBottom()` so a new chat opens at tail.
- [ ] No need to persist scroll offset per chat in v1.

### 6. Tests

- [ ] `test/ui/chat-scroll.test.mjs` (or `.mts`): jsdom or minimal DOM — `isChatAtBottom` math with fixed `scrollHeight`, `clientHeight`, `scrollTop`; flag toggles when listener fired (mock scroll events).
- [ ] Optional: extend existing UI test setup pattern from [`test/ui/thought-bubbles.test.mjs`](../../../test/ui/thought-bubbles.test.mjs).

### 7. Documentation (on ship)

- [ ] Add a short bullet under chat UI in [`documentation/context.md`](../../../documentation/context.md): stick-to-bottom threshold, jump chip, primary module path.
- [ ] Add [`documentation/plans/verification/feature-17.md`](../verification/feature-17.md) with manual checklist (copy from below).

---

## Manual test plan

1. **Baseline stream:** Send a long prompt; stay at bottom → transcript follows automatically.  
2. **Detach during prose:** Scroll up mid-stream → viewport stable; chip visible; new tokens do not pull you down.  
3. **Re-attach:** Click “Jump to latest” → tail visible; auto-follow resumes until scroll up again.  
4. **Thinking phase:** Scroll up during thought-only phase (no prose yet) → no yank on reasoning/typewriter ticks.  
5. **Tool loop:** Scroll up while tools run → tool cards append without yank; jump works.  
6. **User send:** After scrolling up, send a new message → pins to bottom and follows new reply.  
7. **Chat switch:** Switch sidebar chat → loads at bottom (forced).  
8. **Mobile:** Narrow layout — chip not hidden under composer.  
9. **Terminal unchanged:** Terminal output still pins at 24px independently.

---

## Files touched (expected)

| Path | Change |
| ---- | ------ |
| `src/ui/chat-scroll.ts` | **New** — core logic |
| `src/ui/input.ts` | Delegate `scrollBottom` |
| `src/tools/loop.ts` | Remove duplicate; pinned scroll |
| `src/api/chat.ts` | Remove duplicate; pinned scroll |
| `src/ui/messages.ts` | Force vs pinned per call site |
| `src/markdown/renderer.ts` | Pinned scroll |
| `src/ui/thought-bubbles.ts` | Pinned scroll |
| `index.html` | Jump chip button |
| `src/styles/messages.css` | Chip + optional `main-column` positioning |
| `src/main.ts` | `initChatScroll()` |
| `test/ui/chat-scroll.test.mjs` | **New** |
| `documentation/context.md` | On ship only |
| `documentation/plans/verification/feature-17.md` | On ship — checklist |

---

## Risks and edge cases

| Risk | Mitigation |
| ---- | ---------- |
| Listener fights programmatic scroll | Only set `stickToBottom` from user scroll events; pinned scroll does not flip flag false mid-tick. |
| `scroll-behavior: smooth` lag | Use instant programmatic scroll (see Design). |
| Chip under tool approval | Position above `#toolApprovalHost`; test with approval strip open. |
| Empty `#chatArea` | `isChatAtBottom` true when `scrollHeight <= clientHeight`; hide chip. |
| `renderChatFromHistory` mid-stream | Rare; if streaming flag set, prefer not forcing scroll except on explicit chat switch (current sidebar already blocks some actions while streaming). |

---

## Out of scope (v1)

- Remembering scroll position per `chatId` when switching chats.  
- “New messages below” count badge on the chip.  
- Changing terminal threshold or adding a jump chip to the terminal.  
- Message-actions menu (**C2**).  
- Stop button / abort UX (**C1**).

---

## Definition of done

- [ ] All acceptance criteria pass on desktop and mobile width.  
- [ ] No duplicate `scrollBottom` implementations in `loop.ts` / `chat.ts`.  
- [ ] `npm test` includes new chat-scroll unit tests.  
- [ ] `documentation/context.md` updated when merged.  
- [ ] Verification doc completed.

---

## Related backlog

- **C1/C2** — message actions (separate; do not implement here).  
- **C4** — thinking duration (thought header timer; shares thought bubble scroll calls — must stay pinned-aware).  
- **Wave 1** — ships alongside topbar/model display polish per [`product_backlog_agents_48a41af9.plan.md`](../product_backlog_agents_48a41af9.plan.md).
