# Fix per-message chat stats chips parity

**Status:** Implemented

Per-message chat chips rarely showed timing metrics and the red token count together because live DOM and persisted history used different stats/usage pipelines, and the token chip required `usage.total_tokens` while many providers only send prompt/completion counts.

## Todos

- [x] Add `normalizeUsageTotals` and call it from `finalizeResponseMeta`
- [x] Preserve `prompt_tokens_per_second` and `draft_acceptance` in `reconcileCompletionStats`
- [x] Persist `finalizeResponseMeta` (using `round_end` `t0`/`tFirst`/`tEnd`) in `chat-transcript-store`
- [x] Derive red-chip total from prompt+completion in `appendStats` for legacy rows
- [x] Add reconcile / transcript-store / appendStats tests for both chip-split cases
- [x] Update `documentation/context.md`

## Root causes

1. **`total_tokens` asymmetry** — live strip synthesized totals; final chips / persisted rows gated on `usage.total_tokens` only.
2. **Live vs persisted diverge** — live used `finalizeResponseMeta`; history stored raw `round_end` stats/usage and ignored client timings.
3. **Reconciler dropped llama-only fields** — `pp` / `draft %` were not copied through `reconcileCompletionStats`.

## Fix summary

- [`normalizeUsageTotals`](../../src/usage/pricing.ts) fills `total_tokens` from prompt+completion.
- [`finalizeResponseMeta`](../../src/api/chat.ts) always normalizes usage; reconcile keeps llama-only chips.
- [`chat-transcript-store`](../../src/chat/chat-transcript-store.ts) persists the same finalized meta on `round_end`.
- [`appendStats`](../../src/ui/messages.ts) uses `normalizeUsageTotals` so old sessions still show the red chip.
- **Follow-up:** Hosted llama.cpp often sends timings without an OpenAI `usage` block. [`fillUsageFromLlamaTimings`](../../src/api/chat.ts) / server [`mergeStreamMeta`](../../server/runner/stream-parse.js) derive prompt/completion from `prompt_n` / `predicted_n`, and [`applySamplerToBody`](../../server/runner/sampler-types.js) requests `stream_options.include_usage`.

## Out of scope

- Bottom strip collapsed-state / board hiding
- Using turn-aggregate `displayMeta` on the final bubble instead of `lastRound`
- Migrating already-saved history rows on disk
