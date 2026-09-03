---
name: my-models-chat-auto-load
overview: Fix My Models chat auto-load so unloaded library rows show Loading model… and bind to a live serve before completions, instead of failing with an immediate 400.
todos:
  - id: loop-library-ensure
    content: "Tool loop — pending load from live serve; ensure with minnow-library + gguf:/mlx:; post-load rebind via resolveLibrarySendBinding"
    status: completed
  - id: eject-refresh-cache
    content: "unloadServe refreshes picker modelCache via fetchModels so dots / Load-Unload stay honest"
    status: completed
  - id: tests
    content: "Coverage in model-select-library + ensure-chat-model-loaded tests (libraryBindingNeedsServeLoad, resolveLibrarySendBinding, stale-cache ensure)"
    status: completed
  - id: docs
    content: "Update documentation/context.md Providers/My Models auto-load paragraph; save this plan"
    status: completed
isProject: true
---

# Fix My Models auto-load on chat

**Date:** 2026-08-04
**Status:** Implemented (client-side); docs and tests updated
**Scope:** Worktree fix for chat send when a **My Models** library row is selected but not currently served

## Problem

Selecting an unloaded **My Models** row and sending a chat turn could hit an immediate **400** with no **Loading model…** status. The turn never waited for a Minnow serve to come up.

## Root causes

1. **Stale picker `modelCache` after eject** — Models-app unload left the cache showing the model as loaded, so chat ensure skipped the load path.
2. **Ensure with remapped ids** — After mapping `gguf:`/`mlx:` to `llama-cpp-local` / `mlx-lm-local`, ensure no longer went through `loadLibraryModelFromPicker`.
3. **No post-load rebind** — Completions still used the synthetic library binding instead of the running serve’s provider/model ids.

## Approach

Client-side in the tool / chat send loop (no server protocol change):

1. Decide **pending load** from **live serve status**, not picker `modelCache` alone.
2. Resolve the library row from `minnow-library` bindings **or** persisted `llama-cpp-local` / `mlx-lm-local` ids after a prior served turn (`resolveLibraryModelIdForChatBinding`).
3. Run ensure via [`loadLibraryModelFromPicker`](../../src/models/model-select-library.ts) with synthetic **`minnow-library`** + library ids.
3. After load, re-resolve the send binding with [`resolveServedBindingForLibraryId`](../../src/models/model-select-library.ts) / [`resolveLibrarySendBinding`](../../src/models/model-select-library.ts) before generations.
4. On Models-app eject, [`unloadServe`](../../src/ui/models/store.ts) calls `fetchModels()` so the picker cache (dots / Load-Unload) stays honest.

## Key files

| File | Role |
|------|------|
| `src/tools/loop.ts` | Library ensure ids + post-load rebind before completions |
| `src/api/ensure-chat-model-loaded.ts` | Ensure path → `loadLibraryModelFromPicker` |
| `src/models/model-select-library.ts` | `loadLibraryModelFromPicker`, `resolveServedBindingForLibraryId`, `resolveLibrarySendBinding` |
| `src/ui/models/store.ts` | `unloadServe` → refresh picker cache |

## Todos

- [x] **loop-library-ensure** — Live serve for pending; ensure with library ids; re-resolve before generations
- [x] **eject-refresh-cache** — `unloadServe` refreshes picker cache via `fetchModels`
- [ ] **tests** — Coverage lives in `model-select-library` + `ensure-chat-model-loaded` tests (tests agent may still be finishing)
- [x] **docs** — `documentation/context.md` Providers/My Models paragraph + this plan

## Out of scope

- Application architecture beyond the client ensure / rebind / eject-cache path
- Server-side serve protocol changes
