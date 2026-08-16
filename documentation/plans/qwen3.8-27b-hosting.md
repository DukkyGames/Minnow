# Qwen3.8-27B hosting and provider support

Work from a git worktree on `main` (`/worktree main`). Merge-back is `/apply-worktree`.

Official model: [Qwen/Qwen3.8-27B](https://huggingface.co/Qwen/Qwen3.8-27B). Native VLM (image + video), thinking **on** by default, `reasoning_effort` is **`xhigh` (default) / `medium` / `low`**, `preserve_thinking` on by default, **262,144** native context. HF tags the architecture `qwen3_5` / GGUF `qwen35`. GGUF: `unsloth/Qwen3.8-27B-GGUF` (also `lmstudio-community/Qwen3.8-27B-GGUF`). LM Studio id: `qwen/qwen3.8-27b`.

**Out of scope:** Qwen Cloud / DashScope preset. MLX catalog rows (`mlx-lm` cannot serve `image-text-to-text`). Video `video_url` (images only). Per-model sampler overrides.

## Todos

- [x] Create git worktree from main; run worktree setup if `.cursor/worktrees.json` exists
- [x] Add `Qwen/Qwen3.8-27B` catalog row (vision, 262K, `qwen3_5`, Unsloth GGUF Q4_K_M)
- [x] Bump `LLAMA_CPP_RELEASE_TAG` to a Qwen3.8-capable ggml-org build (`b10448`)
- [x] Pass `--jinja` and sibling `--mmproj` from llama-args / serve.js
- [x] Add qwen3.8 262K lookup, fit bonus, `qwen3_5` geometry + name aliases
- [x] Map `xhigh` ingest/send, `preserve_thinking`, Qwen3.8 default high; LM Studio + local + hosted openai-v1
- [x] Tests, `documentation/context.md`, this plan file

## Implementation notes

- Composer stays **off / low / medium / high**. Ingest maps LM Studio `xhigh` → `high`. Send maps Minnow `high` → wire `xhigh` for Qwen3.8 ids (`qwen3.8` / `qwen3_8`, not `Qwen3-8B`).
- Local llama.cpp serve: `--jinja` always; `--mmproj` when a sibling `mmproj*.gguf` exists (prefers `mmproj-F16.gguf`).
- llama.cpp pin `b10448` (asset names unchanged vs `b9628` for CPU / macOS / Windows CUDA 12.4 / Vulkan). Ubuntu CUDA/ROCm zips are not published on this release; those variants simply are not installable from the manifest.
- Context fallback also keys `qwen3_8` so underscore ids do not inherit generic `qwen3` 131K.
