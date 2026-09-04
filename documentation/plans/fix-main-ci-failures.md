# Fix failing CI on main

Latest `ci` run on `main` (`733c1f9e`, [run 33851075873](https://github.com/HenriGrimm/Minnow/actions/runs/33851075873)) is red across the product-wiki job and all three OS test matrix lanes.

## Todos

- [x] Product wiki: regenerate `server/product-wiki/catalog.json` so committed hashes match docs
- [x] Orchestrator conformance: stop extra journal events after `run.finished` (`extra ticks appended 1 events`)
- [x] Ubuntu Landlock canary: `minnow-sandbox` usage exit 64 — inspect wrap args vs helper CLI
- [x] Windows worktree lifecycle / related flakes: orphan removal and opaque `'test failed'` files
- [x] Re-run the failing suites locally and update `documentation/context.md` if architecture/behavior changes

## What landed

1. **Wiki catalog** — `npm run wiki:generate` after the board-testing doc edits.
2. **Conformance extra ticks** — persist the end-of-run report *before* journaling `run.finished` / `board.stopped` / `run.report.written` in one append. Finished ticks are quiescent. Test clock `advance()` awaits async timers.
3. **Landlock exit 64** — raise C `MAX_PATHS` to 1024, compact home reads on overflow, cap scoped `/tmp` sibling grants (`LANDLOCK_MAX_SCOPED_WRITE_GRANTS`), and hard-cap argv. Tests put `MINNOW_HOME` under temp; unbounded `readdir` of `%TEMP%`/`/tmp` blew the helper.
4. **Windows orphans** — `realpathSync.native` so 8.3 `RUNNER~1` paths match git's long path.
5. **Cascade fixture** — throwaway workspace instead of mutating `test/fixtures/sample.fake`.
