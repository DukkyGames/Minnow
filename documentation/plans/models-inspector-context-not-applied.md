# Models inspector context length not applied on load

## Problem

The Models inspector Load tab showed **Context length 2,048**, but llama-server logged:

`n_ctx_seq (125184) < n_ctx_train (262144)`

125184 is Minnow's `DEFAULT_CONTEXT_TOKENS` (125000) rounded up to llama.cpp's 256-token alignment. The UI value was not the argv `-c` the process started with.

## Root cause

- [x] Diagnose: 125184 == align-256(125000), not 2048
- [x] My Models row **Load** and picker auto-load called `loadModel(model)` with no settings; only the inspector footer passed the draft
- [x] Drafts lived in `inspector.ts` as a private `Map`, so other entry points could not read them
- [x] Context `<input type="range">` used `min=2048` and `step=1000`, so 125000 is not on the step grid (`value ≠ min + n×step`). Browsers may snap the thumb/value independently of the label
- [x] Changing the slider after a model is already running does not reload it — no copy explained that

## Fix

- [x] Shared per-model launch drafts (`src/models/launch-settings.ts`)
- [x] `loadModel` applies those drafts for every GGUF serve when the caller omits `settings`
- [x] Context slider step=1 (any integer in range is a valid HTML value); number field as source of truth
- [x] Warn on the Load tab when the running serve's `-c` differs from the draft
- [x] Tests + `documentation/context.md`

## Todos

- [x] Extract `getLaunchSettings` / `resolveLlamaServeSettings`
- [x] Apply drafts in `store.ts` `loadModel`
- [x] Fix inspector slider + running-vs-draft hint
- [x] Tests: launch-settings, llama-args user ctx wins over profile, slider grid
- [x] Update context.md
