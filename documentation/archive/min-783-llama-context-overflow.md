# MIN-783 — llama.cpp context overflow

## Why the chat just stops

This is not a missing llama.cpp flag. Summarize/compact already exists (`applyContextPolicy` → LLM summarize at 90% of the model window). Three stacked bugs keep it from running, then hide the failure.

1. **Pre-send compact often never fires.** The budget is a character estimate (`token-estimate-core.js`, ~3.6 chars/token) against a window that can be the *trained* size, not the loaded `-c`. llama.cpp then measures the real templated request (test fixture: 104264 vs 89088). Tools, chat template, and `max_tokens` are extra mass the 90% margin does not fully cover.

2. **The overflow 400 is treated as a finished turn.** In `server/runner/sub-agent-runner.js`, a stream error with no *this-round* tokens still counted as `hasPartial` if **any prior** assistant row existed. The catch returned a legacy summary; `runTurn` mapped that to `{ outcome: 'no_report' }`; `runChatTurn` painted it as success. The transcript went idle; the only signal was llama-server’s “exceeds the available context size”.

3. **Compact-and-retry was written and never wired.** `src/chat/context/context-overflow-error.ts` already matched llama.cpp’s wording (and OpenAI/Anthropic). `estimate-calibration.ts` and `effectiveLimitOverride` on `apply-policy.ts` existed for the retry. Nothing in the runner imported them.

**MLX / other providers:** the swallow-as-success path is provider-agnostic. Cloud 400s with `context_length_exceeded` would die the same way. Retry itself is not llama.cpp-specific; mlx/OMLX overflow strings are on the same marker list.

## Todos

- [x] Move overflow recognition + estimate calibration into `server/runner`; re-export from `src/chat/context/`
- [x] Wire compact-and-retry in sub-agent-runner `streamErr` catch; stop treating prior assistant history as `hasPartial`; cap 2 retries then fail the turn
- [x] Prefer `loaded_context_length` over `capabilities.contextLength` when the model is loaded; pass `runTurn` limits + local `max_tokens` reserve from `runChatTurn`
- [x] Add runner overflow retry tests and `contextLengthFromModelRow` regression; extend context-overflow-recovery tests
- [x] Update `documentation/context.md` and write this plan

## Out of scope

- Enabling llama.cpp `--context-shift` as a substitute (lossy KV shift; we want Minnow summarize).
- Teaching the server-side board/sub-agent effectors a real `applyContextPolicy` (they currently no-op). Product Code chat is the reported path; the retry hook will still run there once `applyContextPolicy` is real.
- Changing the character estimator’s divisors globally (calibration from the 400 is the cheaper, model-specific fix).
