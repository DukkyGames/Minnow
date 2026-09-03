# Hybrid GGUF KV memory estimate (Qwen3.5 / 3.6 / 3.8)

## Problem

The Models inspector Load tab warned **~25 GB VRAM (0.12 GB per 1k ctx)** for
`Qwen3.5-9B-Q8_0` at the default 125k context. After load, nvidia-smi on a 24 GB
4090 showed **~14.6 GB**.

Reproduced from the file on disk:

| Term | Inspector (broken) | llama.cpp actual |
|------|--------------------|------------------|
| Weights (Q8_0) | 8.87 GiB | 8.87 GiB |
| KV at 125k f16 | **15.3 GiB** (all 32 layers) | **~3.8 GiB** (8 full-attention layers) |
| Compute + CUDA | ~0.8 GiB | ~0.8–1.8 GiB |
| **Total** | **25 GB** | **~14 GB** |

Qwen3.5 / 3.6 / 3.8 are Gated DeltaNet hybrids: **one full-attention layer every
four**, the rest linear-attention with a constant-size state. The family table
already encodes that (`qwen3_5.swaPeriod = 4`), but the Load tab prefers the
GGUF header. Those files ship `qwen35.full_attention_interval = 4` and **no**
`sliding_window_pattern`, so `geometryFromGgufMetadata` fell through to
“every layer grows a cache” (`swaPeriod = 1`).

Family fallback never ran for the 9B size anyway — the table only listed 27B,
and 9 vs 27.78 is outside the 30% log-distance window.

## Todos

- [x] Read `{arch}.full_attention_interval` and `{arch}.nextn_predict_layers` from the GGUF header
- [x] Count linear-attention layers from `blk.*.ssm_conv1d` tensors when the interval key is missing
- [x] Apply family hybrid period (`swaWindow === 0`, `swaPeriod > 1`) when the header is silent
- [x] Add the verified Qwen3.5-9B size (32 layers, 4096 embd, 4 KV heads, dim 256)
- [x] Tests: header parse, geometry, 125k estimate in the 13–15 GB band not 25
- [x] Update `documentation/context.md`

## Non-goals

- Changing the 125k default context (covered by `local-models-llama-cpp-parity.md`)
- Fitting SSM recurrent state to the last gigabyte of nvidia-smi (driver/WDDM slack)
