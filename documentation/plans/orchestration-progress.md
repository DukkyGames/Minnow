# To-Fix Build Orchestration Progress

Master plan: [`to-fix-step-order.md`](to-fix-step-order.md)

Started: 2026-05-19

## Workflow

Each step: **Implementer** → **Verifier** (separate agent) → mark PASS/FAIL. Git commit after each **wave** completes (all steps in wave verified).

## Wave status

| Wave | Steps | Implement | Verify | Commit |
|------|-------|-----------|--------|--------|
| 0 | 01 | done | **PASS** (verifier 2026-05-19 @ :5179) | pending |
| 1 | 02 | done | **PASS** (verifier 2026-05-19; `npm test` 14+6, build OK, temp `SPEEDCHAT_HOME`, manual @ :5180/:5181) | pending |
| 2 | 03 | done | **PASS** (verifier 2026-05-19; providers 12/12, build OK, temp `SPEEDCHAT_HOME`, manual API/UI @ :5182) | **done** (Steps 03+04 wave commit) |
| 3 | 04–09 | 04 done | **04 PASS** (verifier 2026-05-19; `npm test` 44/44, build OK); 05–09 pending | pending |
| 4 | 10–11 | pending | pending | pending |
| 5 | 12 | pending | pending | pending |
| 6 | 13–15 | pending | pending | pending |
| 7 | 16–18 | pending | pending | pending |
| 8 | 19 | pending | pending | pending |
| 9 | 20 | pending | pending | pending |
| Final | all | — | pending | — |

## Step log

### Step 01 — Chat UX polish
- **Status:** **PASS** (verifier re-run 2026-05-19)
- **Plan:** `Build out/step-01-chat-ux-polish.md`
- **Notes:** `npm test` / `npm run build` / step01 + sa16 smoke @ `http://localhost:5179`. Manual U1–U8 per verification doc; U3/U7 accepted with implementer waiver (MCP resize ≠ mobile `matchMedia`; no file-picker for 320px chips).

### Step 04 — Programmatic prompts
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-04-programmatic-prompts.md`
- **Verification:** [`verification/step-04.md`](verification/step-04.md)
- **Automated:** `npm test` **44/44** (node 29: config, providers, `prompt-configs` API; tsx 15: composer, loader, profiles, custom); `npm run build` OK.
- **Spot-check (tests):** Full vs Lite golden fixture — lite length ≤ 40% of full; custom `contentOverride` on `tool-usage`; `expert.enabled: false` omits expert block; `_example/` not registered.
- **Code paths:** `resolveComposedSystemPrompt` → `composeSystemPrompt` in `src/tools/loop.ts` (tool send) and `src/api/chat.ts` (`sendMessagePlain`); tree `src/chat/prompts/` (`_example/`, `base/`, `tool-usage/`, `info/`).
- **Docs:** `documentation/plans/references/prompt-sources.md` present; `documentation/context.md` Step 04 section present.
- **Manual (deferred):** DevTools `chat/completions` system message + optional `GET/PUT /api/prompt-configs` — not run this pass (automated scope sufficient).

### Step 03 — Multiple providers + API auth
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-03-providers-api-auth.md`
- **Verification:** [`verification/step-03.md`](verification/step-03.md)
- **Automated:** `node --test test/providers/*.test.js` **12/12**; `npm run build` OK. Full `npm test`: node phase **29/29** (config + providers + prompt-configs API); tsx phase **4 fail** on `prompt-composer*.mjs` (`import.meta.glob` — Step 04 scope, wave 04 still in progress).
- **Manual:** `SPEEDCHAT_HOME=%TEMP%\speedchat-verify-step03-*`, `PORT=5182`. Secrets PUT → `{"ok":true,"hasApiKey":true}` (no key echo); GET list has `hasApiKey` only; `secrets.json` on disk under `providers/*/`. Two providers CRUD; `set-active` switches `activeProviderId`. UI: `#providerSelect` lists LM Studio + OpenRouter; base URL read-only; model list refreshes on switch (upstream unreachable without key — expected).
- **Auth headers:** `auth-headers.test.js` + `proxy-mock.test.js` (Bearer / api-key / proxy forward).
- **Docs:** `documentation/context.md` providers API + layout documented.
