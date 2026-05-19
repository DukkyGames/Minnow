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
| 2 | 03 | done | **PASS** (verifier 2026-05-19; providers 12/12, build OK, temp `SPEEDCHAT_HOME`, manual API/UI @ :5182) | pending |
| 3 | 04–09 | 04–07 done | **04 PASS**; **05 PASS** (verifier re-run 2026-05-19; modeId round-trip); **06 PASS**; **07 PASS** (verifier 2026-05-19); 08–09 pending | **done** (steps 05-07) |
| 4 | 10–11 | pending | pending | pending |
| 5 | 12 | pending | pending | pending |
| 6 | 13–15 | pending | pending | pending |
| 7 | 16–18 | pending | pending | pending |
| 8 | 19 | pending | pending | pending |
| 9 | 20 | pending | pending | pending |
| Final | all | — | pending | — |

## Step log

### Step 07 — Programmatic chat titles
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-07-chat-titles.md`
- **Verification:** [`verification/step-07.md`](verification/step-07.md)
- **Automated:** `npm test` **94/94** (node 29; tsx 65 incl. titles **12/12**: sanitize 5, generate 2, schedule 4, apply 1); `npm run build` OK (`tsc` + Vite).
- **Spot-check (code):** `scheduleChatTitleGeneration` fire-and-forget (`void runTitleJob`); wired in `src/api/chat.ts` + `src/tools/loop.ts` on first user message; `generateChatTitle` non-streaming `port.complete`; `applyGeneratedChatTitle` + `scheduleSaveSessions` on success; `rg maybeAutoTitle` under `src/` → **0 matches**.
- **Structure:** `src/chat/prompts/titles/` (`default.md`, README); `src/chat/titles/` (`schedule`, `generate`, `sanitize`, `prompt`, `inflight`, `provider-port`).
- **Docs:** `documentation/context.md` Step 07 section present.
- **Manual (deferred):** `npm start` — placeholder → async title, rename race, second message unchanged, provider fail silent (per verification doc §Manual).

### Step 01 — Chat UX polish
- **Status:** **PASS** (verifier re-run 2026-05-19)
- **Plan:** `Build out/step-01-chat-ux-polish.md`
- **Notes:** `npm test` / `npm run build` / step01 + sa16 smoke @ `http://localhost:5179`. Manual U1–U8 per verification doc; U3/U7 accepted with implementer waiver (MCP resize ≠ mobile `matchMedia`; no file-picker for 320px chips).

### Step 06 — Expert system
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-06-expert-system.md`
- **Verification:** [`verification/step-06.md`](verification/step-06.md)
- **Automated:** `npm test` **94/94** (node 29; tsx 65 incl. expert **17/17**); `npx tsx --test test/experts/**/*.test.mjs` **17/17**; `npm run build` OK.
- **Spot-check (tests):** Rules router — TS bug → `software-engineer`, poem → `creative-writer`, `hello` → `general`, SQL → `data-analyst`, negatives; manual `security-reviewer`; composer `[[EXPERT:…]]` inclusion/omit/lite; registry merge + invalid skip; `experts.enabled false` → none.
- **Code paths:** `#expertSelect` + `#expertAutoHint` in `index.html`; `src/ui/expert-select.ts`; `resolveExpertForTurn` → `resolveComposedSystemPrompt` in `compose-context.ts`; six built-ins under `src/chat/prompts/experts/`.
- **Docs:** `documentation/context.md` Step 06 section; `documentation/plans/verification/step-06.md` present.
- **Manual (deferred):** `npm start` — Auto hint after code message, manual Security persona, `experts.enabled` hides strip (per verification doc §Manual).

### Step 05 — Operating modes
- **Status:** **PASS** (verifier re-run 2026-05-19)
- **Plan:** `Build out/step-05-operating-modes.md`
- **Verification:** [`verification/step-05.md`](verification/step-05.md)
- **Fix (verified):** `server/config/validators.js` `ensureChatShape` mirrors client — `modeId`, `expertSelection`, `lastResolvedExpertId`.
- **Automated:** `npm test` **95/95** (node **30/30** incl. api-crud **PUT sessions round-trip preserves modeId**; tsx **65/65**); `npm run build` OK; `npx tsx test/modes/run-all.mts` **21/21**; `npx tsx scripts/step-05-smoke.mjs http://localhost:5183` **PASS** (`SPEEDCHAT_HOME` temp, `PORT=5183`).
- **Manual:** Not run (UI selector, per-chat restore, DevTools tools filter, streaming disable).
- **Checklist:** Registry + MODE_TEMPLATE + production `modes/*.md` present; composer + `loop.ts` wired; `context.md` + `mode-sources.md` present.

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
