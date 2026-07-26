# MIN-354 Session Engine landing fixes

Fix shipping blockers from the MIN-354 review so the Session Engine runs in packaged
desktop builds, closes the LAN token hole, and cleans up correctness/doc drift.

**Branch:** `fix/min-354-session-engine-landing`  
**Base:** `main`  
**Delivery:** one PR, four thematic commits (Stage 1 → 4)

---

## Todos

### Stage 1 — Security
- [x] Export / add `isLoopbackClient(req)`; tighten `isLoopbackAddress` suffix match
- [x] Gate `GET /api/auth/session-token` on loopback; LAN falls through to token check
- [x] Drop CORS from `/api/session/*` middleware + SSE; delete dead OPTIONS branch
- [x] Use `timingSafeEqualToken` in `server/session/auth.js`
- [x] Extend `test/security/auth-middleware.test.mjs` (loopback vs LAN + session stream CORS)
- [ ] Commit: `🔒 fix(session): loopback-gate token bootstrap and drop session CORS`

### Stage 2 — Engine correctness
- [x] Move composer queue drain into turn teardown (`commands.js`); skip on steer/abort
- [x] Stop double-writing error rows (keep `commands.js` handler only)
- [x] SSE reconnect with refreshed token + backoff/cap (`session-sync.ts`)
- [x] Tests: queue drain, single error row, SSE reconnect
- [ ] Commit: `🐛 fix(session): queue drain, single error row, SSE token refresh`

### Stage 3 — Ship engine in packaged builds
- [x] `engine-bundle-entry.ts` + `scripts/build-engine-bundle.mjs` (esbuild, no splitting)
- [x] `server/session/engine-module.js` with tsx → bundle → unavailable order
- [x] Rewrite loaders/commands/engine.js call sites; fix sessions singleton
- [x] `bootSessionEngine` + call from `server.js` and `electron/server-host.ts`
- [x] Fail loudly: engine probe, injected flag, 503 `ENGINE_UNAVAILABLE`
- [x] Packaging validator + `build:engine-bundle` wiring
- [x] Tests: `test/engine/engine-bundle.test.mjs`; phase0–3 unedited
- [ ] Commit: `📦 feat(session): bundle Session Engine for packaged Electron`

### Stage 4 — Test and doc cleanup
- [x] Fix Windows crash in `test/headless/tool-calls-meta-node.test.mts`
- [x] Correct `documentation/plans/server-session-engine.md` drift + dual load path
- [x] Guard `install-fetch-auth.ts` retry for `Request` body
- [x] Update `documentation/context.md` for bundle/boot/availability
- [x] Commit: `📝 fix(session): headless runner crash, plan docs, fetch-auth retry`

### Verification
- [x] Stage 1: auth-middleware + access-policy tests (loopback allow / LAN reject / LAN+token allow)
- [x] Stage 2: `node test/run-all.mjs --suite engine` — 38/38 (was 31) + queue-drain/error-row/SSE tests
- [x] Stage 3: engine-bundle rebuilt from scratch (6.02 MB) and imported under plain `node`
      (16 exports, `window` undefined); phase0–3 suites green unedited
- [x] `npx tsc --noEmit` clean; targeted sweep of `test/{state,chat,session-engine,security,agents}` 661/661
- [ ] Whole tree `node test/run-all.mjs` — not re-run since the landing (3 suites already fail on `main`)
- [x] E2E: `npm run package:dir` — `app.asar` contains `server/session/engine-bundle/engine-bundle.mjs`,
      `engine-module.js`, `engine-boot.js`, and no `src/session-engine/*.ts`

### Stage 5 — Post-review follow-ups
- [x] `engine-boot.js`: skip the boot when `describeEngineAvailability()` is unavailable, and report
      which hosts actually came up instead of logging a flat `ON`
- [x] `engine-module.js`: detect tsx via hook globals **or** `tsx` in `execArgv`/`NODE_OPTIONS`, and stop
      trusting `MINNOW_TEST=1` (see below)
- [x] Pin the board-turn error contract: `test/session-engine/board-turn-error.test.mts`

---

## Open questions (defaults applied)

| # | Question | Default if no answer |
|---|----------|----------------------|
| 1 | Branch name | `fix/min-354-session-engine-landing` |
| 2 | One PR vs four stacked PRs | One PR, four commits |
| 3 | Run `package:dir` E2E myself? | Yes, after automated tests |
| 4 | Known-failing suites on main | Leave failing; only fix headless crash + new coverage |

---

## Operational notes

- **Mode selection is tsx-first.** `describeEngineAvailability()` prefers live `.ts` whenever tsx is
  active in the process, so a stale `server/session/engine-bundle/` left over from an earlier
  `npm run electron:build` can never shadow live sources under `npm start`, `electron:dev`, or any
  test runner that loads tsx. Only a process with no tsx at all (packaged Electron) uses the bundle.
  `MINNOW_ENGINE_MODULE=tsx|bundle` forces either path.
- **`MINNOW_TEST` is not a tsx signal.** Any process can set that env var; claiming tsx without tsx
  turns a clean bundle load into `ERR_UNKNOWN_FILE_EXTENSION`. Detection is hook globals +
  `execArgv`/`NODE_OPTIONS`.
- **LAN clients cannot self-heal a stale token.** `GET /api/auth/session-token` is loopback-only, so a
  LAN device whose per-boot token expired (server restart) gets 401 on the refresh and the session SSE
  stops reconnecting by design. Reloading the page re-injects a fresh token via `index.html`. Loopback
  clients still recover in place.
- **Error rows are asymmetric on purpose.** `server/session/commands.js` writes exactly one `Error:`
  row for main-chat sends. The engine loop writes none, so board task turns reject to
  `handleTaskChatLaunchFailure` (parity with renderer `runChatTurn`, which never wrote a row).
  Pinned by `test/session-engine/board-turn-error.test.mts`.
- **The queue drain runs after failed turns too**, unlike the renderer's `completedNormally` gate. It
  terminates because the queue shrinks by one per pass; revisit only if error storms become a problem.

## Known risks

- Browser-only stub allowlist is a maintenance surface; top-level import tripwire must stay.
- tsx vs bundle namespace shape must stay in lockstep (`Object.keys` test).
- ~6 MB parse at engine boot — keep `bootSessionEngine` fire-and-forget off window paint.
