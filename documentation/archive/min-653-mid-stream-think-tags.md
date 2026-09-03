# MIN-653 Fix raw think tags leaking mid-stream

## Problem

`InlineContentThinkingRouter` only opens a `<think>` span while `firstContentSent` is false. Interleaved-thinking models (Qwen3.8) emit **think → prose → think again** in one generation. The second opener, its reasoning, and `</think>` are routed to the visible reply.

Repro deltas:

`['<think>', 'plan', '</think>', 'Working.', '<think>', 'now call', '</think>']`

Wrong: prose `Working.<think>now call</think>`. Right: prose `Working.` + thinking `plan` then `now call`.

`!firstContentSent` is intentional: an instruct model that *mentions* `<think>` in a code answer must not have that prose reclassified as reasoning.

## Approach

1. Keep the existing first-span path (live `inThinkTag`, prefix hold-back, MiniMax stray close).
2. After visible prose (`firstContentSent`), re-enter only when a **complete** opener stands at a **delta or line boundary** (start of chunk, or after a newline with optional indent). Mid-sentence `use the <think> tag` stays prose.
3. Buffer that candidate until a **matching close** arrives; only then emit the inner text on the thinking channel. Flush without a close dumps the buffer as prose (tags included).
4. After the first span closes, **re-route** any remainder instead of blindly marking it prose, so a second span in the same chunk (or after a newline) is seen.

## Todos

- [x] Add standalone-opener helper and mid-stream pending buffer on `InlineContentThinkingRouter`
- [x] Re-route remainder after a think close instead of dumping it as prose
- [x] Router tests in `test/api/inline-thinking.test.mts` (repro, protection, split close, incomplete span)
- [x] Two-channel test in `test/providers/xml-tool-calls.test.mts` (tool call inside the second span)
- [x] Update `documentation/context.md`
- [x] Run `node --import ./test/test-loader.mjs --import tsx --test --test-force-exit test/api/inline-thinking.test.mts test/providers/xml-tool-calls.test.mts`
