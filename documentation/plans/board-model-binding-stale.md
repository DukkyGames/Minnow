# Board model binding (chip vs Start)

## Why

The board model chip can show the menubar default while Start still sees an unbound journal. Re-picking the same model on the board picker journals `board.model.set` and unblocks Start; the menubar does not.

## Todos

- [x] Seed the journal from the displayed chip (`ensureBoardModelBound` on create, first paint, Start / startTask; retry when `#modelSelect` fills in)
- [x] Accept optional `providerId`/`id` on `POST /api/boards` and journal `board.model.set` at create
- [x] Relax `resolveAttemptModel`: keep model-id-only bindings; infer `gguf:`/`mlx:` → `minnow-library` or the first enabled provider catalog hit
- [x] Unit tests (`test/orchestrator/model-binding.test.mjs`, `board-model-bind.test.mts`) and phase9 create/start coverage
- [x] Update `documentation/context.md`

## Behavior

1. **Client.** If `state.model` already has both ids, do nothing. Otherwise decode `#modelSelect` (composite key, then catalog lookup) and `POST /api/boards/:id/model`. Create also sends that pair on `POST /api/boards`. Do not snapshot later menubar changes onto a bound board.
2. **Server.** Override → Autopilot planner pair → active chat. A non-empty model id is enough. Throw the existing "no model bound" error only when every source lacks an id.

## Out of scope

- Persisting the menubar default into `config.json`
- Changing Settings → Autopilot empty-option behavior
