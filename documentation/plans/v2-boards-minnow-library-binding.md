# V2 boards: remap My Models (`minnow-library`) at send time

**Status:** implemented  
**Date:** 2026-08-30  
**Register:** product

## Goal

V2 boards that bind a Minnow-hosted My Models row (`minnow-library` + `gguf:`/`mlx:`) complete Start and run attempts against the live llama.cpp / MLX serve, the same way chat does. The journaled chip stays the picker id.

## Todos

- [x] Add `server/models/library-binding.js`: remap `minnow-library` to `llama-cpp-local` / `mlx-lm-local` via live serves; auto-load via `startServe` when no serve is running
- [x] Call the helper from effector-runner `preflight()` and `start()` so `turnModel` never carries `minnow-library` into `getProvider` / `runTurn`
- [x] Make `getProvider` / `getProviderRuntime` throw a clear synthetic-id error for `minnow-library` instead of ENOENT
- [x] Add unit + effector tests for remap, auto-load miss, and cloud/direct pass-through
- [x] Update `documentation/context.md` and write this plan

## Why chat works and V2 boards do not

`minnow-library` is a **picker id**, not a registry provider. There is no `~/.minnow/providers/minnow-library/profile.json`. Chat never asks the store for that id — it remaps via `resolveLibrarySendBinding` to `llama-cpp-local` or `mlx-lm-local` plus the served model id.

V2 stores the picker binding on `board.model.set` and `resolveAttemptModel` returns it unchanged. `createServerRunnerDeps` then calls `getProvider(providerId)`, which `fs.readFile`s `providers/<id>/profile.json` with no ENOENT handling. Cloud ids have a real profile. `minnow-library` does not.

Serve records even keep `providerId: 'minnow-library'` (llama-cpp-local is upserted only for upstream HTTP). Do not use `serve.providerId` as the completions provider.

Keep the journaled board chip as `minnow-library` + `gguf:`/`mlx:`. Remap only at send time, same as chat.

## Not covered by remaining Orchestrator V2 work

Finishing Orchestrator V2 will not fix this. The broken path is already shipped (MIN-703 P2-F, MIN-744 P9-C). Remaining phases do not mention `minnow-library` remapping. Phase 6 (chat adopts `runTurn()`) will *need* this helper or chat will break the same way. Waiting for P6 leaves V2 boards broken for the rest of Phases 4–5.

## Fix

Server-side helper (Node ESM, no `src/` UI imports) at [`server/models/library-binding.js`](../../server/models/library-binding.js), called from the V2 runner **before** `runTurn` and in `preflight()`.

**Remap (model already loaded):**

- If the pair is not `minnow-library` + `gguf:`/`mlx:`, return it as-is.
- Look up a live serve (`serveMatchesModelId` / `findLiveLlamaCppServeForModel` / `findLiveMlxServeForModel`).
- Return `{ providerId: 'llama-cpp-local', id: modelLabel }` or `{ providerId: 'mlx-lm-local', id: absolute snapshot path }` — same contract as `resolveLibrarySendBinding`.

**Auto-load (chat parity):** if no running serve, resolve the library row from `listCachedModels()` (same `gguf:repo:rel` / `mlx:repo` ids as `buildLibrary`), call `startServe` with `libraryId` so launch prefs apply, wait until `running` (`MODEL_LOAD_TIMEOUT_MS`), then remap.

Do this in **`preflight()`** so a load failure is a **400 on Start** (nothing journaled), not a crashed attempt after `task.attempt.started`. `start()` calls the same helper so it cannot pass preflight and then send `minnow-library`.

Do **not** persist remapped ids back onto `board.model`.

## Defense in depth

If `getProvider` / `getProviderRuntime` is ever called with `minnow-library`, throw `synthetic My Models id — remap to the running serve first` instead of a raw ENOENT.

## Tests

- Unit: helper remaps a running GGUF serve; remaps a running MLX serve; non-library ids pass through; missing serve starts or fails with the chat-style "not loaded" message.
- Effector: `createRunnerEffector` with `minnow-library` + a seeded llama-cpp-local profile + fake live serve does **not** open `providers/minnow-library/profile.json`; `runTurn` receives `llama-cpp-local`.
- Preflight: missing serve without a resolvable library row is a thrown error, not ENOENT.
