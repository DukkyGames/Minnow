# Fix failing CI on main

Latest `ci` run on `main` (`d75d0c02`, [run 33914512539](https://github.com/HenriGrimm/Minnow/actions/runs/33914512539)) is green on Ubuntu and macOS. Windows `typecheck + tests` still fails: libuv `UV_HANDLE_CLOSING` while tearing down fake-model HTTP servers in `report-wiring.test.mjs` and `memory-store-turn.test.mjs`.

## Todos

- [x] Product wiki: regenerate `server/product-wiki/catalog.json` so committed hashes match docs
- [x] Orchestrator conformance: stop extra journal events after `run.finished` (`extra ticks appended 1 events`)
- [x] Ubuntu Landlock canary: `minnow-sandbox` usage exit 64 — inspect wrap args vs helper CLI
- [x] Windows worktree lifecycle / related flakes: orphan removal and opaque `'test failed'` files
- [x] End-of-run report: clone writer state instead of mutating live `finished` (P2-G `run.finished` race)
- [x] Snapshot memoisation: keep correctness on CI; skip wall-clock ratios (`macos-latest` flake)
- [x] Windows fake-model teardown: `UV_HANDLE_CLOSING` in report-wiring / memory-store-turn
- [x] Re-run the failing suites locally and update `documentation/context.md` if architecture/behavior changes

## What landed (landlock commit)

1. **Wiki catalog** — `npm run wiki:generate` after the board-testing doc edits.
2. **Conformance extra ticks** — persist the end-of-run report *before* journaling `run.finished` / `board.stopped` / `run.report.written` in one append. Finished ticks are quiescent. Test clock `advance()` awaits async timers.
3. **Landlock exit 64** — raise C `MAX_PATHS` to 1024, compact home reads on overflow, cap scoped `/tmp` sibling grants (`LANDLOCK_MAX_SCOPED_WRITE_GRANTS`), and hard-cap argv. Tests put `MINNOW_HOME` under temp; unbounded `readdir` of `%TEMP%`/`/tmp` blew the helper.
4. **Windows orphans** — `realpathSync.native` so 8.3 `RUNNER~1` paths match git's long path.
5. **Cascade fixture** — throwaway workspace instead of mutating `test/fixtures/sample.fake`.

## Follow-up (this change)

6. **Live `finished` leak** — `collectEndOfRunReport` mutated live `state.finished = true` so `writeReport` would run, then restored it and appended `run.finished`. `GET /api/boards/:id` reads that live flag, so P2-G `waitUntilFinished` returned while the journal still lacked `run.finished`. Windows tests broke the tick loop on the same flag and wrote `journal.jsonl` after `MINNOW_HOME` was deleted. Fix: pass `reportWriterState(live)` (a shallow clone) into the writer; keep live state unfinished until the combined append.
7. **Snapshot memoisation** — drop wall-clock speedup assertions (`1.4x` / tail-only vs full). They flake at ~3ms on CI and locally. Keep `deriveFrom` === `derive`.
8. **Windows fake-model close** — `createFakeModelServer().close()` now drops keep-alive sockets (`closeAllConnections`, `maxRequestsPerSocket = 1`, `Connection: close` on the SSE dump) so Node on windows-latest does not abort `report-wiring` / `memory-store-turn` with `UV_HANDLE_CLOSING`.
