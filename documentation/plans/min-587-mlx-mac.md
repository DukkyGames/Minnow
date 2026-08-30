---
name: min-587-mlx-mac
overview: Extend MIN-587 load and inference meters to MLX on Apple Silicon using mlx-lm 0.31.3 signals (async warmup, SSE keepalive prefill, streamed token counts) instead of llama.cpp /slots /metrics.
todos:
  - id: async-mlx-load
    content: "Make mlx-lm startServe async like llama.cpp: return starting immediately, warmup in background, pass libraryId, record load prior, 100% on warmup not /health"
    status: completed
  - id: mlx-load-progress
    content: Track MLX loads in the Models store with a time+size modelled bar (no llama log phases); show on Local Server, header, and chat loading_model
    status: completed
  - id: keepalive-prefill
    content: "Parse mlx-lm `: keepalive processed/total` SSE comments into prompt_progress; reuse llamaRuntimeStatusView + in-flight overlay for chat PP% and Local Server chips"
    status: completed
  - id: live-gen-tokens
    content: Synthesize live generated-token counts from streamed completion deltas when timings.predicted_n is absent (chat + Calling {tool})
    status: completed
  - id: mlx-activity-chips
    content: Synthesize ServeActivity for mlx-lm from Minnow-owned in-flight overlay/gen count (Ready when idle; no fake requests_deferred chip)
    status: completed
  - id: inspector-loaded-with
    content: Click MLX loaded card opens Inference; Loaded with shows snapshot path, quant, mlx-lm version, port, context from config.json
    status: completed
  - id: docs-tests
    content: Update context.md, Models/chat manuals, MIN-587 plan; Windows-stubbable tests for async serve, keepalive parse, chips, load progress
    status: completed
isProject: false
---

# MIN-587 for MLX on Mac

**Issue:** [MIN-587](https://linear.app/minnowai/issue/MIN-587/model-server-info-improvement). Companion to the llama-centric plan in [`min-587-model-server-info.md`](min-587-model-server-info.md).

Implemented in this worktree. llama.cpp `/slots` / `/metrics` are not used. mlx-lm 0.31.3 keepalive comments and completion deltas drive the same UI surfaces.

## Manual Mac checklist

- Cold 7B load shows a moving % then Ready.
- First chat prefill % then live tokens.
- JIT from Code stays in Code.
- Models-foreground load switches to Local Server.
- Click card shows Loaded with (snapshot, quant, mlx-lm version, port, context).
