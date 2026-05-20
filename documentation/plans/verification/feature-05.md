# Feature 05 — Thinking duration display (verification)

**Feature ID:** `feature-05-thinking-duration`  
**Epic:** C4 — Chat UX  
**Build plan:** [`documentation/plans/Build out/feature-05-thinking-duration.md`](../Build%20out/feature-05-thinking-duration.md)

## Automated gate

```bash
npm test
npm run build
```

| Check | Command / file |
|-------|----------------|
| Formatter + tracker | `test/ui/thinking-duration.test.mjs` |
| Stream elapsed suffix | `test/ui/stream-status.test.mjs` |
| Thoughts toggle label | `test/ui/thought-bubbles.test.mjs` |

## Acceptance criteria

| # | Criterion | Status |
|---|-----------|--------|
| 1 | Live **Thinking…** row shows elapsed time (~0.1s resolution) during reasoning | ☐ |
| 2 | First prose token hides live elapsed; stream-status follows existing prose phase | ☐ |
| 3 | Completed reply with `thinking[]` and duration &gt; 0 shows **Thought for X.Xs** | ☐ |
| 4 | Reload / switch chat restores duration label from `thinkingDurationMs` | ☐ |
| 5 | Tool loop accumulates reasoning across rounds (excludes tool execution idle) | ☐ |
| 6 | Prose-only model: no elapsed suffix, no `thinkingDurationMs` | ☐ |
| 7 | TTFT stats unchanged; not written to `time_to_first_token` | ☐ |
| 8 | Abort mid-reasoning: no errors, timers cleared | ☐ |

## Manual QA (M1–M5)

**Prerequisites:** LM Studio Developer → separated reasoning; reasoning-capable model.

| ID | Step | Pass |
|----|------|------|
| M1 | Prompt with visible thoughts → **Thinking… N.Ns** increments → prose → **Thought for N.Ns** → reload persists | ☐ |
| M2 | Prose-only prompt → no elapsed suffix; toggle **Thoughts** or absent | ☐ |
| M3 | Tool loop with reasoning in two rounds → duration reflects both windows | ☐ |
| M4 | Compare TTFT chip vs **Thought for** — differ when model thinks before prose | ☐ |
| M5 | Abort during reasoning → UI recovers, no console interval leaks | ☐ |

## Sign-off

| Field | Value |
|-------|-------|
| **Result** | PASS / FAIL |
| **Date** | |
| **Tester** | |
| **Notes** | |
