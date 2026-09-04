# Fix remaining macOS CI test failures

Wiki catalog regen is **out of scope**. This plan covers the seven `npm test` failures from the local macOS CI run.

## Todos

- [x] Write this plan under `documentation/plans/`
- [x] Add `resolveOrchestratorCwd`; use in `browser-rung.js` and `final-test.js`; fix teardown assertion
- [x] Tighten `BROWSER_GLOBALS` window/document regexes to property-access form
- [x] 410 `check-log` API, retire CLI/Settings UI, rewrite test, update `context.md` + contributor docs
- [x] Narrow `orchestrate-hub` ban to `ui/orchestrate-hub` module path
- [x] Await delivery tick before `endIfRunTerminal`; add SSE deliver-before-done regression
- [x] Drop `MODE_ALLOWED_GROUPS.desktop` assertion from `product-wiki.test.mts`
- [x] Restore `MINNOW_TTS_USE_COMPILE` JSDoc in `provision.js`
- [x] Re-run the seven failing suites (wiki catalog still out of scope)

## What failed (and why)

1. **Browser rung cwd** — POSIX `path.resolve('C:\\repo')` joins onto `process.cwd()`.
2. **Package-guard `window`** — regex too broad (`context window` / local `window` variable).
3. **check-log 400** — MIN-713 deleted invariants; retire the endpoint (410).
4. **orchestrate-hub ban** — CSS/BEM reuse, not a V1 module import.
5. **p8h deliver SSE** — `void tick()` then `endIfRunTerminal()` unsubscribes the listener first.
6. **product-wiki desktop** — `MODE_ALLOWED_GROUPS.desktop` was removed.
7. **TTS compile env** — comment documenting `MINNOW_TTS_USE_COMPILE` was stripped from `provision.js`.

## Verification

Re-run the seven suites, then a full `npm test` if those pass. Do not touch wiki catalog files.
