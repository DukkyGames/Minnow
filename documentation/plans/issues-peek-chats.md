# Shape: issue chats in peek

Discovery (2026-09-06). Brief confirmed via `/impeccable craft`.

**Register:** product. **Color:** Restrained (Issues tokens, no per-surface override). **Fidelity:** production-ready. **Breadth:** Issues peek (detail scroll). **Time intent:** ship.

## Todos

- [x] Confirm this brief (gate for `/impeccable craft`)
- [x] Peek **Chats** section: linked `chatIds` as rows (title, running/done, mode)
- [x] Same list: board row when the issue or a linked chat has a board
- [x] Click/Open: Code chat (`switchChat`); board row opens the orchestrate board
- [x] Empty: section always visible; **New** / **Existing**; workflow toolbar unchanged
- [x] Unlink removes the id from `chatIds` (does not delete the chat)
- [x] Footer meta no longer the only chat affordance (drop the dead `N chat(s)` count or keep a quiet duplicate only if tests require it)
- [x] Tests for list membership, streaming/mode display, unlink, attach, missing chats
- [x] Update `documentation/context.md` and `documentation/manual/apps/issues.md`

## 1. Feature summary

Issues already store `chatIds` (Send to chat, capture, pipeline) and sometimes `boardChatId`, but peek only prints a footer count. People cannot get back to those threads from the card they started them on. This work lists those chats (and any board tied to the issue or to those chats) in the peek scroll, with running/done and mode visible, and Open as the follow-through.

## 2. Primary user action

Scan whether a linked chat is still running, then open it (or its board) without hunting the Code sidebar.

## 3. Design direction

- **Color strategy:** Restrained. Accent on the open control and live-run state only.
- **Scene:** A developer on a large monitor, Issues list plus peek, after Send to chat. They glance at the card to see if the agent is still going, then jump into that thread.
- **Anchors:** Linear issue peek related lists; Minnow Sub-issues / Related / Code rows (flat rows, not cards); Code sidebar session row (title + live state).
- **Theme:** Same Issues chrome (`--mn-*`, 36px-class rows, no nested cards). App light/dark follows the shell; this surface does not pick its own theme.

Visual probes skipped: this extends the existing Issues peek vocabulary; it is not a new visual surface.

## 4. Scope

Production-ready shipped UI. Peek only (fullscreen Issues and Code-embedded Issues share `issues-detail.ts`). Interactive: list, status, open, New, Existing, unlink. Tests + user-facing docs.

Out of scope:

- Embedding a transcript in peek
- A second composer or chat UI inside Issues
- Scanning every chat for `#ISS-n` mentions that are not in `chatIds`
- Changing Send to chat / Send to background / Send to board in the workflow toolbar
- Board nested cards or a new orchestrate surface

## 5. Layout strategy

Peek keeps description first. **Chats** sits with the other document sections: after Sub-issues, before Related (Related stays issue-to-issue; Chats is session links). Titled list, not a card stack.

**Chat row** (one per live `chatIds` entry, newest last or last-updated first: last-updated, missing ids at the bottom):

- Title (chat name)
- Status: Running / Done (from `isChatStreaming` / sub-agent live state if that is the workflow run)
- Mode: General / Build / Plan / Debug (normalized mode id)
- Primary: click row or Open → `switchChat`
- Trailing unlink (× / Remove), `aria-label` includes the chat name. Does not delete the session.

**Board row** (same list, not nested under a chat):

- When `issue.boardChatId` is set, or a linked chat belongs to an orchestrate board group, show one row per distinct board.
- Label: board / group name, status if the board chat is streaming
- Open → existing board/hub launch (`showBoard` / `openBoardGroup`), not only `switchChat`
- Unlink board chat from the issue only if it is stored on `boardChatId` / `chatIds`; do not delete the board

**Add row** (always, including empty):

- **New**: foreground Send to chat using the existing pipeline (no second mode dropdown here)
- **Existing**: picker of chats not already in `chatIds`; picking calls `appendIssueLinks({ chatId })`

Empty copy still shows the section so add is discoverable.

Missing / deleted chats: one stale row (`Chat unavailable`), unlink only.

## 6. Key states

| State | What the user sees |
| --- | --- |
| No chats, no board | Chats section, empty copy, New / Existing |
| 1–N linked chats | Rows with title, Running/Done, mode; Open; unlink |
| Chat streaming | Running (not metric color as decoration; pair with the word Running) |
| Chat done / idle | Done + mode |
| Board on issue or on a linked chat | Extra board row in the same list |
| Stale `chatIds` | Chat unavailable + unlink |
| After New | New id on `chatIds`, Code focused on that chat, peek list updates |
| After Existing | Id appended, peek list updates, stay on Issues |
| Unlink | Id removed; session remains in the sidebar |

Typical N is 1–4 chats. Design for 0 and for ~20 without a new virtualizer.

## 7. Interaction model

**Open chat.** `switchChat(id)` the same way workflow activity already does. Do not remount peek into a transcript.

**Open board.** Distinct from Open chat. Uses the existing orchestrate open path for that group/board.

**New.** Same create+link path as Send to chat (foreground). Mode menus stay on the sticky workflow toolbar.

**Existing.** Context menu or compact picker of current-workspace chats excluding already linked ids.

**Unlink.** `chatIds` filter (existing `issue_unlink` / store helper). No confirm. Deleting a chat in the sidebar should leave a stale row until unlink, or drop the id if the store already prunes on chat delete (match current store behavior; do not invent a second cleanup).

**Workflow toolbar.** Unchanged. Sending still appends `chatIds` as today; the new section is the read/open surface.

## 8. Content requirements

- Section title: `Chats`
- Empty: `No chats yet.`
- New: `New`
- Existing: `Existing`
- Status: `Running` / `Done`
- Board row: `Board` (or the group name if it exists)
- Unlink: `Remove` with `aria-label` `Remove chat {name} from this issue`
- Stale: `Chat unavailable`
- Toasts: attach unknown chat; unlink is silent

No new illustrations. No metric colors on idle rows. No in-peek markdown transcript.

## 9. Recommended references

- `reference/product.md` (earned familiarity)
- Sub-issues peek section (list + New/Existing + unlink)
- `src/chat/issues/pipeline.ts` (`appendIssueLinks`, `switchChat`, `boardChatId`)
- `reference/harden.md` after craft (stale ids, streaming refresh, embedded vs fullscreen peek)

## 10. Decisions already locked (discovery)

- Status first: Running/Done + mode, then Open
- Membership: `chatIds` plus boards linked to those chats or to the issue
- Empty section always on, with New / Existing
- Board is a sibling row, not nested under a chat
- Do not duplicate workflow mode dropdowns in this section
- Production-ready
- Unlink without deleting the session
- Do not embed the transcript in peek

## Anti-goals

- In-peek transcript or a mini composer
- Nested cards, side-stripe “chat” accents, hero counts of “3 chats”
- Treating Related and Chats as one list
- Mention-scan of every session for the issue id
- Modal-first attach (picker/menu is enough)
- Deleting chats when removing them from the issue
