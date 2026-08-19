# Remove Vibe hub intent chips

## Status

Implemented.

## Goal

Drop the empty-chat **Build / Plan / Debug / Explain / Orchestrate** intent row from `#vibeHub`. Mode stays on the composer strip; Orchestrate still opens from the Code sidebar.

## Todos

- [x] Remove `.hub-intents` from `src/ui/hub.ts`
- [x] Delete `src/ui/hub-intents.ts` and its helper tests
- [x] Strip unused `.hub-intent*` CSS
- [x] Assert the hub landing no longer mounts intent chips
- [x] Note the change in `documentation/context.md`
