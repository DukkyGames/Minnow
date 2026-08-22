---
name: min-2-tool-call-display-switch
overview: Fix MIN-2 — switching away from a chat and back while a tool call is mid-execution (or a file save is in flight) leaves the tool-call row stuck in its spinner state because runChatToolBatch paints the result onto a detached DOM node instead of the row re-rendered from history.
todos:
  - id: w1-retarget-tool-wraps
    content: "Wave 1: Re-target live tool-call rows in runChatToolBatch after a chat switch"
    status: pending
  - id: w1-restore-tool-start-indicator
    content: "Wave 1: Restore the Calling tool… indicator when the stream shell remounts"
    status: pending
  - id: w2-switch-regression-tests
    content: "Wave 2: Regression tests for mid-batch chat switch (tool row + file card)"
    status: pending
  - id: w2-context-doc
    content: "Wave 2: Update documentation/context.md"
    status: pending
isProject: true
---

# MIN-2 — Tool call display lost after chat switch

**Date:** 2026-08-22
**Goal:** A tool-call row (including `save_file` file cards) keeps its live spinner and receives its result even when the user switches chats mid-batch and back.
**Granularity:** medium

## Context

Issue MIN-2 (bug, priority medium): switching away from a chat and back while a tool is being called or a file is being saved causes the tool call display to be lost in that chat.

**Repro:** In chat A, send a prompt that produces tool calls (e.g. `save_file`). While the tool batch is still executing, click chat B, then click back to chat A. The tool-call row is visible but stuck on the running spinner; when the tool finishes, the result (ok/fail glyph, outcome text, code-change badge, diff panel) never appears on the row.

**Root cause (verified in code):**

1. `runChatToolBatch` (`src/tools/chat-tool-batch.ts:240`) captures `const area = getActiveChatMountElement()` **once** at batch start and appends each pre-rendered tool wrap to it (`chat-tool-batch.ts:272-274`). It also stores every wrap in a `wrapById: Map<toolCallId, HTMLElement>` (`chat-tool-batch.ts:238, 253, 257`).
2. When the user switches to chat B, `switchChat` → `paintActiveChatInForegroundShell` (`src/ui/sidebar.ts:1363`) → `renderChatFromHistory` (`src/ui/messages.ts:264`) wipes the transcript (`area.innerHTML = ''` at `messages.ts:403`) and repaints from `chat.history`. The `assistant` tool-call message was already pushed (`src/tools/loop.ts:2475`), so fresh `.tool-call-msg[data-tool-call-id]` rows are created in the **running** state (`messages.ts:498-517`) — but the old wraps captured in `wrapById` are now **detached DOM nodes**.
3. When a tool completes, `onToolDone` looks up the wrap by id (`chat-tool-batch.ts:331-337`) and calls `applyToolOutcome` (`chat-tool-batch.ts:152`), which runs `renderToolResult(toolWrap, …)` on the **detached** wrap (`chat-tool-batch.ts:183-189`). The live row in the transcript keeps spinning forever.
4. The existing resume path (`src/chat/incomplete-tool-resume.ts`) already re-targets wraps via `findToolWrap(toolCallId)` (`incomplete-tool-resume.ts:48-56`) — but it explicitly bails when the turn is still streaming (`isChatStreaming(chat.id)` → `return false`, `incomplete-tool-resume.ts:118`), which is exactly the MIN-2 case. The live batch path has no equivalent re-target.

Secondary gap: the "Calling {tool}…" indicator (`attachToolStartIndicator`, `src/ui/stream-status.ts:203`) is disposed on stream remount (`src/tools/loop.ts:1764`), and `onToolCallStreaming` only re-fires when the announced tool name **changes** (`loop.ts:1087-1089`) — so switching back while `tool_calls` JSON is still streaming loses the indicator until the next tool name.

**Out of scope:** boot/restart resume (already handled by `incomplete-tool-resume.ts`), ask_question parking, board-task tool rows on the Orchestrate board (same `runChatToolBatch` path benefits automatically, but no board-specific work).

## Architecture / Key Files

| File | Role | Action |
|------|------|--------|
| `src/tools/chat-tool-batch.ts` | Tool batch executor; owns `wrapById` + `applyToolOutcome` | MODIFY (W1-A) |
| `src/tools/loop.ts` | Turn loop; registers stream remount listener; `onToolCallStreaming` callback | MODIFY (W1-B) |
| `src/chat/incomplete-tool-resume.ts` | Existing `findToolWrap` re-target pattern; bails when streaming | REFERENCE (reuse pattern, no change) |
| `src/ui/messages.ts` | `renderChatFromHistory` repaint of tool rows from history | REFERENCE (no change expected) |
| `src/ui/sidebar.ts` | `switchChat` → repaint + remount + resume hooks | REFERENCE (no change expected) |
| `src/tools/stream-chat-dom.ts` | Stream shell remount mechanism | REFERENCE (no change expected) |
| `src/ui/stream-status.ts` | `attachToolStartIndicator` / `ToolStartIndicatorHandle` | REFERENCE (no change expected) |
| `test/tools/chat-tool-batch-stall.test.mts` | Existing `runChatToolBatch` happy-dom test style | REFERENCE |
| `test/ui/stream-chat-dom-remount.test.mjs` | Existing remount test style | REFERENCE |
| `documentation/context.md` | Project conventions doc; tracks stream/tool DOM fixes | MODIFY (W2-B) |

## Wave Breakdown

### Wave 1 — Core fix
Tasks in this wave are independent (different files) and may run concurrently.

#### Task W1-A: Re-target live tool-call rows in `runChatToolBatch`
- **Build:** In `src/tools/chat-tool-batch.ts`:
  1. Add an exported helper (mirroring `findToolWrap` in `src/chat/incomplete-tool-resume.ts:48-56`):
     ```ts
     /** Re-target a tool row to its live DOM node after a chat-switch repaint (MIN-2). */
     export function resolveLiveToolWrap(toolCallId: string, cached: HTMLElement): HTMLElement {
       if (typeof document === 'undefined') return cached;
       const live = document.querySelector(
         `.tool-call-msg[data-tool-call-id="${CSS.escape(toolCallId)}"]`,
       );
       return live instanceof HTMLElement ? live : cached;
     }
     ```
  2. In `onToolDone` (`chat-tool-batch.ts:331-337`), resolve the live wrap before calling `applyToolOutcome`, and update the map so later parallel outcomes share it:
     ```ts
     onToolDone: (outcome) => {
       const cached = wrapById.get(outcome.toolCall.id);
       if (!cached) return;
       const toolWrap = resolveLiveToolWrap(outcome.toolCall.id, cached);
       if (toolWrap !== cached) wrapById.set(outcome.toolCall.id, toolWrap);
       applyToolOutcome(options, outcome, toolWrap, argsById.get(outcome.toolCall.id));
     },
     ```
  3. No change needed in `applyToolOutcome` itself — it already calls `renderToolResult` and `attachShellKillUi` on the wrap it receives, so the live wrap gets the result, outcome glyph, code-change badge, diff panel, and Stop button.
  4. Expected diff scope: ~15 lines in `chat-tool-batch.ts` (one helper + one `onToolDone` body rewrite). Do not touch `area` capture or the initial `area.appendChild` path.
- **Test:** New unit tests (see W2-A) that call `resolveLiveToolWrap` with a live row present (returns live), absent (returns cached), and `document` undefined (returns cached). Plus an integration test: pre-render a `.tool-call-msg[data-tool-call-id="a"]` row in the happy-dom mount, run `runChatToolBatch({ toolCalls: [tc('get_datetime', 'a')], paintInChat: false, … })`, and assert the **pre-rendered live row** ends with `tool-call-summary--ok` and a non-empty outcome zone while the detached cached wrap (never in DOM) is not the one painted.
- **Accept:** Running the W2-A integration test passes — the live row in the active mount transitions from `tool-call-summary--running` to `tool-call-summary--ok` after the tool completes, proving the result lands on the visible node.
- **Depends on:** none

#### Task W1-B: Restore the "Calling {tool}…" indicator on stream remount
- **Build:** In `src/tools/loop.ts`:
  1. Track the last announced streaming tool name for the turn in a variable visible to both the `onToolCallStreaming` callback (`loop.ts:2197-2208`) and the remount listener registered at `loop.ts:1755` (e.g. `let lastAnnouncedToolName: string | null = null;` declared near `toolStartIndicator` at `loop.ts:1739`, set inside the callback, and reset in `resetToolStartIndicator`).
  2. In the remount listener (after `resetToolStartIndicator()` at `loop.ts:1764`), if `lastAnnouncedToolName` is set and `isStreamDomVisible(chat.id)`, re-create the indicator:
     ```ts
     if (lastAnnouncedToolName) {
       toolStartIndicator = attachToolStartIndicator({ wrap, bubble, cursor, streamStatus });
       toolStartIndicator.show(lastAnnouncedToolName);
     }
     ```
  3. Expected diff scope: ~10 lines in `loop.ts`. Do not change `streamCompletionTurn`'s `lastAnnouncedToolName` dedupe logic (`loop.ts:1087-1089`) — the remount re-announce is the fix, not the stream callback.
- **Test:** Unit test in the W2-A file (or `test/ui/stream-chat-dom-remount.test.mjs` style): register a remount listener, set the announced tool name state, call `remountStreamDomForChat(chatId)`, and assert a `.tool-start-indicator` exists with label `Calling save_file…` (or whatever name was announced) in the active mount.
- **Accept:** With a chat streaming `tool_calls` JSON for `save_file`, switching away and back shows the "Calling save_file…" indicator again on the remounted row.
- **Depends on:** none

### Wave 2 — Tests and docs
Runs after Wave 1 (needs the W1-A helper to exist).

#### Task W2-A: Regression tests for mid-batch chat switch
- **Build:** Create `test/tools/chat-tool-batch-switch.test.mts` (mirror the happy-dom setup of `test/tools/chat-tool-batch-stall.test.mts` — `Window`, `#chatMessages` mount, `tc()`/`makeChat()` helpers; use the `node-tsx` runner profile). Cover:
  1. `resolveLiveToolWrap` unit tests: live row wins; no live row → cached fallback; `document` undefined → cached.
  2. Integration: pre-render a live `.tool-call-msg[data-tool-call-id="a"]` (via `renderToolCall('get_datetime', {})` + `dataset.toolCallId = 'a'`, appended to the mount), run `runChatToolBatch` with `paintInChat: false` and `tc('get_datetime', 'a')`, then assert the live row has `tool-call-summary--ok` and a visible outcome; assert only one `.tool-call-msg` exists in the mount (no duplicate from the batch).
  3. File-card variant: pre-render a `save_file`-style row (`renderToolCall('save_file', { path: 'a.txt' })` → has `tool-call-msg--file`), assert `resolveLiveToolWrap` returns it (covers the "file being saved" display path without executing a real write).
  4. Backgrounded-completion fallback: no live row in DOM → `resolveLiveToolWrap` returns the cached wrap (result paints detached; history push + later `renderChatFromHistory` repaint renders it from `toolResultMap` — assert the cached wrap receives `tool-call-summary--ok`).
- **Test:** Run the new file plus the existing neighbors:
  ```
  node --import tsx --import ./test/test-loader.mjs --import ./test/assert-dom-safe.mjs --test --test-force-exit --test-timeout=120000 test/tools/chat-tool-batch-switch.test.mts test/tools/chat-tool-batch-stall.test.mts test/ui/stream-chat-dom-remount.test.mjs
  ```
  All pass.
- **Accept:** `npm test` is green with the new file included, and the integration test fails (red) if W1-A's `resolveLiveToolWrap` re-target is reverted — i.e. the test genuinely pins the bug.
- **Depends on:** w1-retarget-tool-wraps, w1-restore-tool-start-indicator

#### Task W2-B: Update `documentation/context.md`
- **Build:** Add a short note under the existing stream/tool DOM section: tool-call rows are re-targeted to the live transcript on chat switch (MIN-2) via `resolveLiveToolWrap` in `src/tools/chat-tool-batch.ts`, mirroring `findToolWrap` in `src/chat/incomplete-tool-resume.ts`; the "Calling {tool}…" indicator is re-announced on stream remount. Match the file's existing heading/format conventions (check how the stream remount fix is documented today).
- **Test:** `grep` the file for `MIN-2` and confirm the note renders under the correct heading; no markdown lint errors.
- **Accept:** `documentation/context.md` mentions the MIN-2 fix with the two touched files.
- **Depends on:** w1-retarget-tool-wraps, w1-restore-tool-start-indicator

## Verification Checklist
- [ ] `npm test` passes (full suite; at minimum the `tools`/`ui` test files listed in W2-A)
- [ ] `npm run build` passes (`tsc && vite build`)
- [ ] `git diff` touches only `src/tools/chat-tool-batch.ts`, `src/tools/loop.ts`, `test/tools/chat-tool-batch-switch.test.mts`, `documentation/context.md` (no generated output staged)
- [ ] Manual smoke: chat A → prompt with `save_file` → switch to B → switch back mid-save → row shows result when the save completes; no stuck spinner

## Notes for Build Agents
- **Reuse, don't reinvent:** `findToolWrap` in `src/chat/incomplete-tool-resume.ts:48-56` is the canonical DOM lookup — copy its selector exactly (including `CSS.escape`). Keep the two in sync.
- **`renderToolResult` is idempotent-ish:** it guards body rebuild with `body.dataset.resultRendered` (`src/ui/tool-messages.ts`), so re-targeting onto a row that history already painted with a result is safe — but in the MIN-2 ordering the live row is always in the pre-result spinner state when `applyToolOutcome` runs, so no double-render occurs.
- **Do not change the `area` capture** at `chat-tool-batch.ts:240` or the initial append at `272-274` — the fix is at outcome time, not batch start.
- **`paintInChat: false` is a valid input** (backgrounded batch start, resume path) — `wrapById` still holds detached wraps; `resolveLiveToolWrap` must fall back to them so history still gets the `tool` row push.
- **Parallel tools:** update `wrapById` after re-target (as specified) so each subsequent `onToolDone` shares the live wrap.
- **Test runner:** use the `node-tsx` prefix args exactly as in `test/test-config.mjs` (`--import tsx --import ./test/test-loader.mjs --import ./test/assert-dom-safe.mjs --test --test-force-exit --test-timeout=120000`); never run `node --test` without `--test-force-exit`.
- **Windows shell:** do not pipe test output through `tail`/`grep`/`wc` in commands — run the runner directly.