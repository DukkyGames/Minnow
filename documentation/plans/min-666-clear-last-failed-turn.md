# MIN-666 — Clear last failed turn

## Problem

The error chrome after a failed chat turn exposes a single action, **Clear last failed turn**. That action rewinds to the last user message and immediately retries (`resendFromIndex` → `forkFromUserIndex`). People who wanted to keep the visible transcript and retry lose context. Continue is the action they actually need.

## Goal

Keep **both** actions, with clearer jobs:

- **Continue** — retry the failed turn with full history (do not drop context).
- **Clear** — drop only the failed **assistant** output, not the user message that started it.

Neither control wipes earlier successful turns. Continue must send real history (aligns with MIN-641).

## Todos

- [x] Add `CONTINUE_AFTER_FAILURE_INSTRUCTION` and a helper that only injects it when history does not already end on a user row
- [x] Add `clearFailedAssistantOutput` — drop `failed: true` assistant rows after the fork user message; keep the prompt, earlier turns, and completed tool rows
- [x] Add `continueFailedTurn` / `clearFailedAssistantTurn` (hydrate first; Continue never truncates)
- [x] Error chrome: **Continue** + **Clear** (replace the single rewind-and-retry button)
- [x] Persist the same actions on a tail `failed: true` chip so they survive a history re-render
- [x] Tests: Continue outbound keeps visible transcript; Clear keeps the user prompt; neither wipes earlier turns
- [x] Update `documentation/context.md` and the chat manual

## Non-goals

- Removing Clear entirely
- Changing Undo, truncated-Continue, or ⋮ regenerate
