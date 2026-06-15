# Fix MiniMax inline thinking leak

**Status:** Shipped / built (Phase 5 complete)

## Root cause

Some reasoning models (especially **MiniMax**, Qwen thinker variants, Gemma thought channels) embed chain-of-thought in the assistant `content` field instead of separate `reasoning` / `reasoning_content` / `thinking` SSE deltas. Minnow previously treated all `delta.content` as visible prose, so internal monologue leaked into chat bubbles and persisted history.

MiniMax-specific quirks:

- Untagged reasoning prose (`The user just sent…`, tool-name deliberation) followed by the real reply.
- Stray `</think>` closers without a matching opener.
- Tagged blocks and partial tags split across streaming chunks.

## Target behavior

1. **Live stream:** Route inline reasoning to thought bubbles; only user-visible reply text updates the assistant markdown bubble.
2. **Batch / end-of-turn:** Split polluted `content` into `thinking: string[]` + clean `reply` before persisting.
3. **History:** Re-parse assistant messages on render when `thinking` was not stored.
4. **Provider parity:** Honor `delta.thinking` when present; support gpt-oss Harmony `<|channel|>analysis` / `final` markers.

## Files changed

| Area | File |
|------|------|
| Core parsing + routers | `src/api/inline-thinking.ts` |
| SSE reasoning field | `src/api/reasoning.ts` (`delta.thinking`) |
| Stream wiring | `src/api/chat.ts`, `src/tools/loop.ts`, `src/agents/sub-agent-runner.ts` |
| Render-time repair | `src/ui/messages.ts` (`renderChatFromHistory`) |
| Post-turn split | `src/synthesis/post-turn.ts` |
| Tests | `test/api/inline-thinking.test.mts` |
| Docs | `documentation/context.md` |

## Verification

```bash
npx tsx --import ./test/test-loader.mjs --test test/api/inline-thinking.test.mts
npx tsc --noEmit
```

Manual: stream a MiniMax or Qwen thinking model; confirm **Thinking…** / thought bubbles receive monologue and the visible reply excludes `save_memory`-style deliberation.

## Implementation notes

- `InlineContentThinkingRouter` buffers partial `<think>` open tags across chunks when `thinkingModel` is true.
- `HarmonyChannelRouter` holds incomplete Harmony control-token suffixes to avoid leaking markers.
- `extractInlineThinkingFromContent` only splits when both thinking and reply are non-empty (reasoning-only turns stay intact).
- Tag string literals use concatenation (`'<' + 'redacted_thinking>'`) so authoring tools do not strip `redacted_` prefixes.
