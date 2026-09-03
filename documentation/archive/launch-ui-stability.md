# Launch UI Stability

## Status

Implemented — dual-gate loader, critical-path surgery, deferred feature CSS, and
**workspace-gate cover until Code first paint** (the gate→app pop-in fix).

## Todos

- [x] Dual-gate loader: CSS ready + chrome-ready before `markAppReady`
- [x] Parallelize config cluster; skip duplicate sessions force-load; defer tools/models/Issues
- [x] Move non-shell CSS out of `main.ts`; eager-graph CSS allowlist
- [x] Hold workspace gate as a cover after pick until Code chrome paints; warm init while picker is open
- [x] Boot tests + context notes

## Gate → Code transition

Cold boot used to close the picker as soon as a folder was chosen, then run the
rest of `initApp` while Code was already visible — composer, sidebar, and chat
assembled on screen. Reload felt fine because the dual-gate loader hid that work.

Fix:

1. `beginWorkspaceGateForBoot()` opens the picker and returns `{ whenChosen }` so
   `initApp` can warm UI/config **while** the user picks.
2. `onWorkspaceGateChosen()` launches Code **behind** the gate (`os-workspace-gate-holding`)
   and resolves the wait without closing the cover.
3. After sidebar/chat/composer sync + first paint, `revealAppAfterWorkspaceGate()`
   drops the cover.

## Verification

Cold start → pick workspace: gate stays up briefly, then Code appears fully composed.
Reload after that should remain stable as before.
