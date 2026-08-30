---
name: min-587-model-server-info
overview: "MIN-587 / #842: honest load and inference meters on Local Server and a compact live line in chat. Queue UI is adopted from MIN-647 / PR #1032."
todos:
  - id: load-progress-smooth
    content: Rewrite modelled load % so it climbs inside each phase; share on Local Server card, Models header, and chat
    status: completed
  - id: chat-runtime-details
    content: "Chat: load % while loading; keep prefill %; live token count on generating and Calling {tool}"
    status: completed
  - id: local-server-activity
    content: "Local Server chips: prefill as % when Minnow knows prompt_progress.total; GEN stays token count; llama deferred queue chip only"
    status: completed
  - id: queue-adopt-1032
    content: Adopt PR #1032 for transcript queued bubbles + composer strip + requests_deferred
    status: completed
  - id: switch-if-models
    content: On llama-cpp load start, navigate to Local Server only if Models is the active app
    status: completed
  - id: inspector-loaded-with
    content: Click loaded card always opens inspector (serve id), Inference tab, Loaded with first, selected card state
    status: completed
  - id: filter-idle-logs
    content: Drop update_slots idle lines from the log DOM and the 500-line cap
    status: completed
  - id: docs-context
    content: Update documentation/context.md and the Models manual
    status: completed
  - id: load-progress-overtime
    content: Leak past the current phase ceiling when the log is silent so fitting does not sit at 4% until /health
    status: completed
  - id: load-progress-checkpoints
    content: Retune LOAD_PHASES from a captured b9628 Qwen3.8-27B log; dots map onto the wide weights band; first-load rate so 13 GiB at 7s is not 40%
    status: completed
isProject: false
---

# MIN-587 — Model loading and inference display

**Issue:** [HenriGrimm/Minnow#842](https://github.com/HenriGrimm/Minnow/issues/842). Shared queue slice with MIN-647 / [#922](https://github.com/HenriGrimm/Minnow/issues/922) via [PR #1032](https://github.com/HenriGrimm/Minnow/pull/1032).

## Goal

A developer waiting on a local GGUF needs to trust the numbers: load percent that actually moves, prefill as a percent, live generated-token counts, queued work that is real, and a way to see the flags a serve was started with. Local Server is the home for that instrumentation. Chat shows the same facts as a compact live line so they can stay in Code.

## Approach

- **Load bar:** Checkpoints from a captured b9628 Qwen3.8-27B load. `loading model tensors` owns 16–82 (last line during the silent CUDA copy); dots map onto that band; MTP/CLIP/slots are warmup. `/health` is the only path to 100.
- **Chat:** same modelled percent on `loading_model`; existing `prompt_progress` percent; live `predicted_n` on generating and on `Calling {tool}`. Wire the agent loop (`streamCompletionTurn`) as well as the no-tools `api/chat.ts` path.
- **Local Server chips:** prefill percent when Minnow owns in-flight `prompt_progress`; otherwise keep an honest token count. GEN stays a token count. Queue chip is llama `requests_deferred` only (PR #1032).
- **Navigation:** switch to `#/app/models/server` only when Models is already the foreground app. JIT load from chat stays in Code.
- **Inspector:** click binds by serve id, opens Inference with **Loaded with** first, selected card state. Path mismatch still opens flags from `serve.llamaSettings`.
- **Logs:** drop `update_slots: all slots are idle` before the 500-line cap.

## Out of scope

- MIN-732 spinner reset
- Listing composer follow-ups on Local Server
- Switching to Local Server from Code

## Addendum — MLX on Apple Silicon

Companion plan: the Cursor plan `min-587_mlx_mac`. mlx-lm 0.31.3 has no `/slots`, `/metrics`, `return_progress`, or `timings_per_token`. Substitutions:

- **Load %** — modelled from snapshot size + elapsed time + `recordLaunchLoadPrior`. Client passes `async: true` so `trackLoad` runs during warmup. 100 only when the warmup POST succeeds.
- **Prefill %** — `: keepalive processed/total` SSE comments parsed into `prompt_progress`.
- **Live GEN** — count streamed completion deltas when `timings.predicted_n` is absent.
- **Chips** — one synthesized `ServeActivity` slot from the Minnow overlay. Idle = Ready. No fake `requests_deferred`.
- **Loaded with** — snapshot path, quant, mlx-lm version, port, context from `config.json`. Not spawn tunables.
