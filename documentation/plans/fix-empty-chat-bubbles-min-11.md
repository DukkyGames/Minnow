# Fix empty assistant chat bubbles (MIN-11)

## Problem

Orchestrator / tool-heavy turns left visible **Assistant** rows with an empty `.msg-bubble` after streaming ended—usually `revealAssistantProseBubble()` followed by `setAssistantBubbleContent()` with whitespace-only or empty markdown.

## Solution

- [`removeOrphanStreamingRow`](../src/ui/messages.ts) — dispose stream status and remove `.msg--awaiting-prose` shell.
- [`assistantProseHasVisibleContent`](../src/ui/messages.ts) — trim-aware guard before reveal/persist.
- [`loop.ts`](../src/tools/loop.ts) — tool-only rounds remove shell; finalize skips history when no prose/thinking; `finally` sweeps stray awaiting rows.

## Todos

- [x] Reproduce scenario (whitespace tool prose + reveal without content)
- [x] `removeOrphanStreamingRow` + trim checks in `loop.ts`
- [x] Skip persisting empty finalize assistant messages
- [x] UI tests in `test/ui/empty-assistant-bubble.test.mjs`
- [x] Update `documentation/context.md`

## Acceptance

- No `.msg.assistant` with empty `.msg-bubble` and no adjacent tool cards after a turn completes.
- Tool-only turns show tool cards only (stream status during flight).
- Board ↔ Chat toggle still rebuilds via `renderChatFromHistory` (no orphan rows in `#chatArea`).
