# MIN-565 — MLX hosted models: unknown context wheel

## Problem

My Models MLX rows and `mlx-lm-local` upstream listings often omit `max_context_length`. The composer context wheel calls `resolveContextLimit`, which depends on `modelCache` / `max_context_length` or `lookupKnownContextLength`. Many MLX community repos are not in the static known-window table and do not match the bundled GGUF catalog, so the wheel shows **Context limit unknown**.

`mlx_lm.server` does not publish context metadata on `/v1/models`, and Minnow intentionally does not treat that endpoint as the library source of truth.

## Root cause

1. [`buildLibrary`](../src/models/library.ts) only set `contextLength` from the GGUF catalog (`entry?.context_length`), not from on-disk MLX `config.json`.
2. [`fetchLibraryModelSelectMerge`](../src/models/model-select-library.ts) copies that into `max_context_length` for the picker cache.
3. Proxy responses for `mlx-lm-local` were not enriched, so any code path keyed on absolute snapshot paths also lacked limits.

## Fix (implemented)

1. **`server/models/mlx-context-length.js`** — parse `max_position_embeddings` (and nested `text_config`, `rope_scaling`) from transformers-style `config.json`.
2. **`detectMlxRepo`** in [`server/models/cached.js`](../server/models/cached.js) — attach `mlx_context_length` on cached scan rows when config parsing succeeds.
3. **`buildLibrary`** — prefer `row.mlx_context_length` over catalog context for MLX rows.
4. **`proxyModels`** — when provider id is `mlx-lm-local`, merge `max_context_length` from cached MLX scans by snapshot path / repo id.

## Verification

- `node --test test/models/mlx-context-length.test.mjs`
- `node --test test/models/mlx-repo-detect.test.mjs`
- `npm run test:models` (or scoped library tests)

## Follow-ups (optional)

- Surface `loaded_context_length` if mlx-lm ever exposes per-model runtime context in API responses.
- Extend `lookupKnownContextLength` for additional families if config.json lacks embedding fields on edge repos.
