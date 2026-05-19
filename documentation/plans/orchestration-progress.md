# To-Fix Build Orchestration Progress

Master plan: [`to-fix-step-order.md`](to-fix-step-order.md)

Started: 2026-05-19

## Workflow

Each step: **Implementer** ? **Verifier** (separate agent) ? mark PASS/FAIL. Git commit after each **wave** completes (all steps in wave verified).

## Wave status

| Wave | Steps | Implement | Verify | Commit |
|------|-------|-----------|--------|--------|
| 0 | 01 | done | **PASS** (verifier 2026-05-19 @ :5179) | pending |
| 1 | 02 | done | **PASS** (verifier 2026-05-19; `npm test` 14+6, build OK, temp `SPEEDCHAT_HOME`, manual @ :5180/:5181) | pending |
| 2 | 03 | done | **PASS** (verifier 2026-05-19; providers 12/12, build OK, temp `SPEEDCHAT_HOME`, manual API/UI @ :5182) | pending |
| 3 | 04?09 | done | **04 PASS**; **05 PASS** (verifier re-run 2026-05-19; modeId round-trip); **06 PASS**; **07 PASS** (verifier 2026-05-19); **08 PASS** (verifier re-run 2026-05-19; registry parser fix); **09 PASS** (verifier 2026-05-19 @ :5187) | **done** (Step 09 sub-agents) |
| 4 | 10?11 | done | **10 PASS** (verifier 2026-05-19 @ :5189); **11 PASS** (verifier 2026-05-19 @ :5190) | **done** (Wave 4: terminal + file viewer) |
| 5 | 12 | done | **PASS** (verifier 2026-05-19) | **done** (Step 12: CDP browser) |
| 6 | 13-15 | done | **13 PASS**; **14 PASS** (verifier re-run 2026-05-19); **15 PASS** (implementer+verifier 2026-05-19) | pending |
| 7 | 16?18 | pending | pending | pending |
| 8 | 19 | pending | pending | pending |
| 9 | 20 | pending | pending | pending |
| Final | all | ? | pending | ? |

## Step log

### Step 15 — UI Designer
- **Status:** **PASS** (implementer + verifier 2026-05-19)
- **Plan:** `Build out/step-15-ui-designer.md`
- **Verification:** [`verification/step-15.md`](verification/step-15.md)
- **Automated:** `npm test` **107/107** (node **53/53**; tsx **54/54** incl. ui-designer **9/9**); `npm run test:ui-designer` **PASS** (smoke I1–I3); `npm run build` OK.
- **Deliverables:** `/ui-designer` skill, Work Agent `ui-designer`, `run_impeccable` tool, `uiDesigner` config block, loop wiring (model binding, allowlist, plan-mode write guard).
- **Step 14:** Not blocking — Impeccable skill present; UI Designer delegates via `run_impeccable` + skill docs.
- **Manual (deferred):** Chrome CDP, vision model, `/ui-designer plan` E2E.

### Step 14 â€” Impeccable built-in
- **Status:** **PASS** (verifier re-run 2026-05-19)
- **Plan:** `Build out/step-14-impeccable-builtin.md`
- **Verification:** [`verification/step-14.md`](verification/step-14.md)
- **Deliverables:** `impeccable@^2.1.9` devDependency; `postinstall` + `scripts/sync-impeccable-skill.mjs` â†’ `src/skills/impeccable/`; SpeedChat `SKILL.md` wrapper; `speedchat-context.mjs`; npm scripts `impeccable:sync|update|detect`; `skills-lock.json`
- **Automated:** `npm install` OK; `test/skills-impeccable.test.mjs` **10/10**; `npm test` **141/141**; `npm run build` OK (10 skills in manifest); `impeccable:sync` idempotent
- **API smoke:** `GET /api/skills` includes `impeccable` @ `:5197` with temp `SPEEDCHAT_HOME`
- **Docs:** `README.md`, `documentation/context.md` (Impeccable subsection)
- **Manual (deferred):** `/` picker chip, send injection footer, `impeccable:detect` CI gate
- **Blocks cleared for:** Step 15 UI Designer

### Step 13 ï¿½ Skills framework
- **Status:** **PASS** (verifier re-run 2026-05-19; post glob + smoke fixes)
- **Plan:** `Build out/step-13-skills-framework.md`
- **Verification:** [erification/step-13.md](verification/step-13.md)
- **Fixes:** `src/skills/client.ts` ï¿½ lazy/guarded `import.meta.glob` (Node/tsx safe). `scripts/s13-skills-smoke.mjs` ï¿½ reuse preset `SPEEDCHAT_HOME` for S6; document coordinated start; skip S6 with hint when server home differs.
- **Automated:** `npm test` **141/141** (node **43/43**, tsx **98/98**); `npm run test:skills` **10/10**; `generate-skills-manifest.mjs` OK (10 skills); `npm run build` OK.
- **Smoke (verifier):** `s13-skills-smoke.mjs` S1ï¿½S3 pass (offline). S4ï¿½S6 **PASS** @ `http://localhost:5196` with coordinated `SPEEDCHAT_HOME` before `npm start`.
- **Docs:** `documentation/context.md` Step 13 skills; verification doc updated for S6 coordination.
- **Manual (deferred):** slash picker, send footer `[skill: ï¿½]`, custom `~/.speedchat/skills/`.
- **Commit:** `a593b6d` ï¿½ ?? Step 13: Skills framework, slash picker, dual-root loader
### Step 12 ? CDP browser automation
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-12-cdp-browser.md`
- **Verification:** [`verification/step-12.md`](verification/step-12.md)
- **Automated:** `npm test` **131/131** (node **43/43** incl. CDP **9/9**; tsx **88/88**); `npm run test:browser` **9/9** (mock CDP, no real Chrome); `npm run build` OK (`tsc` + Vite).
- **Spot-check (tests):** `browser_list` targets; `browser_navigate` blocked URL `Error:` prefix; snapshot uid cache + click; `browser_screenshot` attachments shape; allowlist localhost vs external; `SPEEDCHAT_BROWSER_URL` default.
- **Docs:** `documentation/context.md` ? **39** tools, **7** CDP `browser_*`, `GET /api/browser/screenshot/:id` documented.
- **Manual (deferred):** Chrome `--remote-debugging-port=9222`, Settings Browser (CDP) toggle, `browser_list` / navigate / screenshot / evil URL block (per verification doc ï¿½Manual).

### Step 10 ? Bottom terminal panel
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-10-terminal-panel.md`
- **Verification:** [`verification/step-10.md`](verification/step-10.md)
- **Automated:** `npm test` **122/122** (node **34/34**; tsx **88/88**); `npm run build` OK (`tsc` + Vite).
- **Terminal API (verifier):** **PASS** @ `http://localhost:5189` (`npm start`, `SPEEDCHAT_HOME` = `%TEMP%\speedchat-terminal-test-28556`; **:5173** occupied by Vite ? not `npm start`). `node test/terminal-stream.test.mjs` **12/12** (`run_returns_runId`, `stream_emits_stdout_and_exit`, `unknown_run_404`, `invalid_command_400`, `history_scoped_to_chat`).
- **Regression:** `POST /api/tools` `execute_command` **PASS** (exit 0, stdout `42`). Full `sa16-smoke.mjs` **partial** ? server tools ping/read/git/datetime/calculate OK; attachment section fails Node import `src/app-state` from `loop.ts` (Step 11 / smoke harness scope, not terminal).
- **Docs:** `documentation/context.md` Step 10 terminal panel + `/api/terminal/*` documented.
- **Manual (deferred):** M1?M7 panel toggle, agent stream, chat history, reload, collapse prefs, offline banner, 30s timeout (per verification doc ï¿½Manual).

### Step 11 ? File tree + split viewer
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-11-file-tree-viewer.md`
- **Verification:** [`verification/step-11.md`](verification/step-11.md)
- **Automated:** `npm test` **122/122** (node **34/34** incl. `parseListDirectoryResult` **4/4**, file API traversal; tsx **88/88**); `npm run build` OK (`tsc` + Vite).
- **API smoke (verifier):** **PASS** @ `http://localhost:5190` (`SPEEDCHAT_HOME` = `%TEMP%\speedchat-step11-verify-20260519`; `PORT=5188` bumped to **5190**). `node scripts/step-11-smoke.mjs` ? P0?P6 all **PASS** (tools ping, `list_directory`, `read_file`, `read_file_range`, `fileSidebar` / `fileViewerPane` / `btnFileTreeToggle` in `index.html`).
- **Docs:** `documentation/context.md` Step 11 file panel section present.
- **Manual (deferred):** M1?M8 sidebar/viewer/split/mobile; M9?M10 large file + traversal UI (per verification doc).

### Step 09 ? Sub-agent orchestration
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-09-sub-agent-orchestration.md`
- **Verification:** [`verification/step-09.md`](verification/step-09.md)
- **Automated:** `npm test` **118/118** (node **30/30**; tsx **88/88** incl. sub-agents **12/12**); `npx tsx --test test/sub-agents/**/*.test.mts` **12/12**; `npm run build` OK (`tsc` + Vite).
- **Spot-check (tests):** spawn aggregate JSON (`orchestrator-aggregate`); `globalMaxConcurrent` queue (`orchestrator-spawn`); `explore` omits `execute_command` (`sub-agent-tools`); cancel running/queued (`orchestrator-cancel`); `restartSubAgent` new `runId` + empty messages (`orchestrator-restart`); config merge (`sub-agent-config`).
- **Code paths:** `cancelAllForParentTurn` on parent `AbortError` in `src/tools/loop.ts`; orchestrator in `src/agents/orchestrator.ts`.
- **API smoke (verifier):** **PASS** @ `http://localhost:5187` ? `GET/PUT /api/config/sub-agents` (`enabled`, `globalMaxConcurrent`, `types`); `node scripts/sa09-sub-agent-smoke.mjs` **PASS**.
- **Docs:** `documentation/context.md` Step 09 sub-agents section present.
- **Manual (deferred):** browser/LM Studio full `spawn_sub_agent` stack (per verification doc ?Optional smoke).

### Step 08 ? Work Agents
- **Status:** **PASS** (verifier re-run 2026-05-19; post registry parser fix)
- **Plan:** `Build out/step-08-work-agents.md`
- **Verification:** [`verification/step-08.md`](verification/step-08.md)
- **Fix (verified):** `server/work-agents/registry.js` ? `parseWorkAgentMeta` uses flat `parsePromptMarkdown` result (`parsed.kind`, `parsed.id`, ?); `readWorkAgentPrompt` uses `parsed.body` (not `markdownBody` / `frontMatter`); user override files without YAML front matter return raw content with `source: "override"`.
- **Automated:** `npm test` **106/106** (node **30/30**; tsx **76/76** incl. work-agents **11/11**); `npx tsx --test test/work-agents/**/*.test.mjs` **11/11**; `npm run build` OK.
- **API smoke (verifier):** **PASS** @ `http://localhost:5186` (`SPEEDCHAT_HOME` = `%TEMP%\speedchat-step08-verify-20260519142617`). `GET /api/work-agents` ? 5 agents (`default`, `builder`, `planner`, `reviewer`, `researcher`); `PUT` + `GET .../builder/prompt?profile=full` ? `source: "override"`, `content` contains override text.
- **Manual (deferred):** UI dev selector, Builder status label, mode auto-map, `workAgentId` persistence (per verification doc ï¿½Manual).

### Step 07 ? Programmatic chat titles
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-07-chat-titles.md`
- **Verification:** [`verification/step-07.md`](verification/step-07.md)
- **Automated:** `npm test` **94/94** (node 29; tsx 65 incl. titles **12/12**: sanitize 5, generate 2, schedule 4, apply 1); `npm run build` OK (`tsc` + Vite).
- **Spot-check (code):** `scheduleChatTitleGeneration` fire-and-forget (`void runTitleJob`); wired in `src/api/chat.ts` + `src/tools/loop.ts` on first user message; `generateChatTitle` non-streaming `port.complete`; `applyGeneratedChatTitle` + `scheduleSaveSessions` on success; `rg maybeAutoTitle` under `src/` ? **0 matches**.
- **Structure:** `src/chat/prompts/titles/` (`default.md`, README); `src/chat/titles/` (`schedule`, `generate`, `sanitize`, `prompt`, `inflight`, `provider-port`).
- **Docs:** `documentation/context.md` Step 07 section present.
- **Manual (deferred):** `npm start` ? placeholder ? async title, rename race, second message unchanged, provider fail silent (per verification doc ï¿½Manual).

### Step 01 ? Chat UX polish
- **Status:** **PASS** (verifier re-run 2026-05-19)
- **Plan:** `Build out/step-01-chat-ux-polish.md`
- **Notes:** `npm test` / `npm run build` / step01 + sa16 smoke @ `http://localhost:5179`. Manual U1?U8 per verification doc; U3/U7 accepted with implementer waiver (MCP resize ? mobile `matchMedia`; no file-picker for 320px chips).

### Step 06 ? Expert system
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-06-expert-system.md`
- **Verification:** [`verification/step-06.md`](verification/step-06.md)
- **Automated:** `npm test` **94/94** (node 29; tsx 65 incl. expert **17/17**); `npx tsx --test test/experts/**/*.test.mjs` **17/17**; `npm run build` OK.
- **Spot-check (tests):** Rules router ? TS bug ? `software-engineer`, poem ? `creative-writer`, `hello` ? `general`, SQL ? `data-analyst`, negatives; manual `security-reviewer`; composer `[[EXPERT:?]]` inclusion/omit/lite; registry merge + invalid skip; `experts.enabled false` ? none.
- **Code paths:** `#expertSelect` + `#expertAutoHint` in `index.html`; `src/ui/expert-select.ts`; `resolveExpertForTurn` ? `resolveComposedSystemPrompt` in `compose-context.ts`; six built-ins under `src/chat/prompts/experts/`.
- **Docs:** `documentation/context.md` Step 06 section; `documentation/plans/verification/step-06.md` present.
- **Manual (deferred):** `npm start` ? Auto hint after code message, manual Security persona, `experts.enabled` hides strip (per verification doc ï¿½Manual).

### Step 05 ? Operating modes
- **Status:** **PASS** (verifier re-run 2026-05-19)
- **Plan:** `Build out/step-05-operating-modes.md`
- **Verification:** [`verification/step-05.md`](verification/step-05.md)
- **Fix (verified):** `server/config/validators.js` `ensureChatShape` mirrors client ? `modeId`, `expertSelection`, `lastResolvedExpertId`.
- **Automated:** `npm test` **95/95** (node **30/30** incl. api-crud **PUT sessions round-trip preserves modeId**; tsx **65/65**); `npm run build` OK; `npx tsx test/modes/run-all.mts` **21/21**; `npx tsx scripts/step-05-smoke.mjs http://localhost:5183` **PASS** (`SPEEDCHAT_HOME` temp, `PORT=5183`).
- **Manual:** Not run (UI selector, per-chat restore, DevTools tools filter, streaming disable).
- **Checklist:** Registry + MODE_TEMPLATE + production `modes/*.md` present; composer + `loop.ts` wired; `context.md` + `mode-sources.md` present.

### Step 04 ? Programmatic prompts
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-04-programmatic-prompts.md`
- **Verification:** [`verification/step-04.md`](verification/step-04.md)
- **Automated:** `npm test` **44/44** (node 29: config, providers, `prompt-configs` API; tsx 15: composer, loader, profiles, custom); `npm run build` OK.
- **Spot-check (tests):** Full vs Lite golden fixture ? lite length = 40% of full; custom `contentOverride` on `tool-usage`; `expert.enabled: false` omits expert block; `_example/` not registered.
- **Code paths:** `resolveComposedSystemPrompt` ? `composeSystemPrompt` in `src/tools/loop.ts` (tool send) and `src/api/chat.ts` (`sendMessagePlain`); tree `src/chat/prompts/` (`_example/`, `base/`, `tool-usage/`, `info/`).
- **Docs:** `documentation/plans/references/prompt-sources.md` present; `documentation/context.md` Step 04 section present.
- **Manual (deferred):** DevTools `chat/completions` system message + optional `GET/PUT /api/prompt-configs` ? not run this pass (automated scope sufficient).

### Step 03 ? Multiple providers + API auth
- **Status:** **PASS** (verifier 2026-05-19)
- **Plan:** `Build out/step-03-providers-api-auth.md`
- **Verification:** [`verification/step-03.md`](verification/step-03.md)
- **Automated:** `node --test test/providers/*.test.js` **12/12**; `npm run build` OK. Full `npm test`: node phase **29/29** (config + providers + prompt-configs API); tsx phase **4 fail** on `prompt-composer*.mjs` (`import.meta.glob` ? Step 04 scope, wave 04 still in progress).
- **Manual:** `SPEEDCHAT_HOME=%TEMP%\speedchat-verify-step03-*`, `PORT=5182`. Secrets PUT ? `{"ok":true,"hasApiKey":true}` (no key echo); GET list has `hasApiKey` only; `secrets.json` on disk under `providers/*/`. Two providers CRUD; `set-active` switches `activeProviderId`. UI: `#providerSelect` lists LM Studio + OpenRouter; base URL read-only; model list refreshes on switch (upstream unreachable without key ? expected).
- **Auth headers:** `auth-headers.test.js` + `proxy-mock.test.js` (Bearer / api-key / proxy forward).
- **Docs:** `documentation/context.md` providers API + layout documented.
