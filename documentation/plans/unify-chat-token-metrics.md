# Unify chat token metrics

**Status:** Implemented

Every chat surface was computing “tokens” differently, so the same turn showed ~69,423 on the context ring, 67486 on the message chip, 61,692 as last-turn API prompt, and em-dashes in the metrics strip.

## Todos

- [x] Choose one last-turn measurement (provider usage, normalized)
- [x] Add `resolveLastTurnMetrics` as the single reader
- [x] Stop `showCachedModelInfo` from wiping the metrics strip
- [x] Paint strip, ring USED, chips, and hub from that snapshot
- [x] Ground context-ring USED in last-turn `total_tokens` (scale breakdown to match)
- [x] Tests for resolver, strip persistence, context budget
- [x] Update `documentation/context.md`

## Correct measurement

Provider `usage` is ground truth for a completed round:

- `prompt_tokens` — last request size
- `completion_tokens` — last decode
- `total_tokens` — `prompt + completion` when the provider omitted it (`normalizeUsageTotals`)

**Display map**

| Surface | Number |
| --- | --- |
| Message chip | That row’s round `usage.total_tokens` (normalized) |
| Metrics strip TOTAL / Prompt / Completion | `resolveLastTurnMetrics(chat)` — `lastStats` merged with the last assistant row when the stored snapshot is incomplete |
| Context ring USED | That same `total_tokens`, plus pending composer / attachments / in-flight tool JSON |
| Breakdown section rows | Character estimates, **scaled** so core rows sum to last-turn total |

Character ÷ calibrated-rate estimates stay for first turns (no API usage yet) and for the breakdown pie. They must not be a second “used” total once the provider has reported tokens.

A tool-loop turn still stores **per-round** usage on each bubble (MIN-772). The strip is the last user turn: latest prompt + completions recorded on `lastStats`. After a single-round turn those match the last chip.

## Root causes

1. **Strip wipe** — `showCachedModelInfo` called `updateStrip({}, {}, modelInfo)` on every catalog / capability refresh, blanking TPS, TTFT, tokens, and cost while leaving quant from cache.
2. **`hasNumeric` too strict** — strip ignored `prompt_tokens` / `completion_tokens`, so a prompt-only `lastStats` painted as empty.
3. **`buildLastStatsSnapshot` skipped `normalizeUsageTotals`** — chips filled `total_tokens` from prompt+completion; the strip did not.
4. **Context USED ignored API usage** — `lastTurnPromptTokens` was a footnote; the ring fill summed an independent estimate (~7k above the last prompt in the report).
5. **No hydrate from history** — message rows had usage; `lastStats` did not, so the strip stayed blank after rebuild / reload.

## Out of scope

- Tokenizer-accurate estimates for first turns
- Changing ledger billing (still per-round `recordTokenUsage`)
- Migrating already-saved `lastStats` rows on disk beyond read-time hydrate
