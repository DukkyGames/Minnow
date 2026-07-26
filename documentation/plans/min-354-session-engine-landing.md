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
- [ ] Move composer queue drain into turn teardown (`commands.js`); skip on steer/abort
- [ ] Stop double-writing error rows (keep `commands.js` handler only)
- [ ] SSE reconnect with refreshed token + backoff/cap (`session-sync.ts`)
- [ ] Tests: queue drain, single error row, SSE reconnect
- [ ] Commit: `🐛 fix(session): queue drain, single error row, SSE token refresh`

### Stage 3 — Ship engine in packaged builds
- [ ] `engine-bundle-entry.ts` + `scripts/build-engine-bundle.mjs` (esbuild, no splitting)
- [ ] `server/session/engine-module.js` with tsx → bundle → unavailable order
- [ ] Rewrite loaders/commands/engine.js call sites; fix sessions singleton
- [ ] `bootSessionEngine` + call from `server.js` and `electron/server-host.ts`
- [ ] Fail loudly: engine probe, injected flag, 503 `ENGINE_UNAVAILABLE`
- [ ] Packaging validator + `build:engine-bundle` wiring
- [ ] Tests: `test/engine/engine-bundle.test.mjs`; phase0–3 unedited
- [ ] Commit: `📦 feat(session): bundle Session Engine for packaged Electron`

### Stage 4 — Test and doc cleanup
- [ ] Fix Windows crash in `test/headless/tool-calls-meta-node.test.mts`
- [ ] Correct `documentation/plans/server-session-engine.md` drift + dual load path
- [ ] Guard `install-fetch-auth.ts` retry for `Request` body
- [ ] Update `documentation/context.md` for bundle/boot/availability
- [ ] Commit: `📝 fix(session): headless runner crash, plan docs, fetch-auth retry`

### Verification
- [ ] Stage 1: auth-middleware + session-token tests
- [ ] Stage 2: `node test/run-all.mjs --suite engine` + new assertions
- [ ] Stage 3: engine-bundle tests; phase suites green unedited
- [ ] Whole tree: `npx tsc --noEmit`, `node test/run-all.mjs`
- [ ] E2E (optional / manual): `npm run package:dir` — Session Engine ON, chat send, board AFK

---

## Open questions (defaults applied)

| # | Question | Default if no answer |
|---|----------|----------------------|
| 1 | Branch name | `fix/min-354-session-engine-landing` |
| 2 | One PR vs four stacked PRs | One PR, four commits |
| 3 | Run `package:dir` E2E myself? | Yes, after automated tests |
| 4 | Known-failing suites on main | Leave failing; only fix headless crash + new coverage |

---

## Known risks

- Browser-only stub allowlist is a maintenance surface; top-level import tripwire must stay.
- tsx vs bundle namespace shape must stay in lockstep (`Object.keys` test).
- ~6 MB parse at engine boot — keep `bootSessionEngine` fire-and-forget off window paint.
