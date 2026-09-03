---
name: hosted-model-second-turn-hang
overview: The second My Models message died because a 32k llama.cpp window plus a 32k max_tokens reserve left a 1-token message budget. Cap the local generation reserve, make summarize's truncate fallback real, skip LLM summarize on 1-slot local hosts, and crash when compact cannot shrink.
todos:
  - id: cap-generation-reserve
    content: Cap llama.cpp/mlx generation reserve (and request max_tokens) so a 32k window plus 32k Settings max still leaves a usable message ceiling
    status: completed
  - id: fix-truncate-fallback
    content: Pass policy truncate on the resolved budget when summarize cannot drop turns
    status: completed
  - id: local-extractive-summarize
    content: Use extractive dropMiddle on llama-cpp-local/mlx-lm-local; abort summarize generations on timeout
    status: completed
  - id: fail-budget-exhausted
    content: Map contextBudgetExhausted to a crashed turn in runTurn instead of silent no_report
    status: completed
  - id: tests-docs
    content: Add budget/runner/apply-policy tests and update documentation/context.md
    status: completed
isProject: true
---

# Fix second-turn hang on My Models

## What you were seeing

Turn 1 against a Minnow-hosted model worked. Turn 2 painted **Summarizing context…** in the menubar and **Generating response…** in the bubble, then the spinner disappeared and nothing was written.

That was not a random llama.cpp stall. The generating label is painted **before** the request. The summarize label is the only `onStatus` string in `applyContextPolicy`. The turn then completed as `no_report` (treated as success), so the UI went back to Ready with an empty assistant.

## Why it was always the second message

Three numbers collided on every auto-fit My Models load:

- Preferred serve window is **32768** (`PREFERRED_CONTEXT_TOKENS`).
- Settings / agent `maxTokens` is **32768** (`DEFAULT_AGENT_MAX_TOKENS`).
- Local hosts reserved that full `maxTokens` against the message budget.

`resolveContextBudget` then did `floor(n_ctx * 0.9) - reserved`. For a 32k serve that is `29491 - tools - 32768`, which clamps to **1**.

Turn 1 often still ran because the picker cache is keyed as `minnow-library` / `gguf:…`, so the loaded `n_ctx` was frequently **unknown** on the first send and trimming was skipped. After the first reply, `loaded_context_length` and `chat.modelInfo.context_length` are populated. Turn 2 finally saw 32k, the 1-token ceiling, and a droppable history turn (`minRecentTurns` defaults to 2), so summarize fired.

## Compounding bugs (fixed together)

1. **Generation reserve zeroed the prompt budget** — reserving the full Settings `maxTokens` is correct in spirit (llama.cpp counts prompt + `n_predict` against `n_ctx`) but not when `maxTokens >= n_ctx`.
2. **Summarize's truncate fallback was a no-op** — when nothing can be dropped, `applyLlmSummarizePolicy` called `applyContextBudget` with `enforcementPolicy: 'truncate'` on the agent config, but `applyContextBudget` reads `resolved.policy`, which was still `'summarize'`.
3. **Budget exhaustion was a silent success** — `enforceContextBudget` returning false yielded `{ contextBudgetExhausted: true }`. `runTurn` ignored that object and returned `{ outcome: 'no_report' }`.
4. **LLM summarize fought the only llama.cpp slot** — default `--parallel` is 1. Summarize is a second completion on the same model. Timeout rejected at 45s without aborting the generation.

## Fix

### A. Cap local generation reserve

`localGenerationReserveTokens` / `resolveLocalWindowReserves` in `server/runner/context-budget.js`:

- Keep a minimum prompt floor (`LOCAL_PROMPT_FLOOR_TOKENS` = 4096) as a sanity check on the **message** ceiling after tools.
- Do **not** subtract Settings `maxTokens` from that ceiling. Leftover after the live prompt is applied as `body.max_tokens` only.
- Unknown `n_ctx` reserves 0 (do not subtract the raw Settings max).
- Do **not** change `resolveContextBudget`'s clamp-to-1 last resort.

### B. Make summarize fallback actually truncate

`applyLlmSummarizePolicy` now passes `{ ...resolved, policy: 'truncate' }` into `applyContextBudget` when `droppedTurns === 0`.

### C. Skip LLM summarize on 1-slot local hosts

For `llama-cpp-local` / `mlx-lm-local`, `applyContextPolicy` uses extractive `dropMiddle` instead of a second completion. Cloud / LM Studio keep the LLM path. Summarize timeout now aborts the in-flight `AbortController`.

### D. Surface budget exhaustion as a failed turn

When `enforceContextBudget` returns false, `runTurn` returns `{ outcome: 'crashed', error: 'context budget exceeded' }`. `settleFailedTurn` already shows Continue / Clear.

## Verification

1. New chat, short first message — reply still works.
2. Immediate short follow-up — must stream a reply. Menubar must **not** show Summarizing context on a tiny thread.
3. Composer context wheel should not jump to ~100% solely because `maxTokens` equals `n_ctx`.
4. If the prompt truly cannot fit (tiny ctx + huge tool schema), the bubble must show a failed turn with Continue / Clear, never a silent Ready.
