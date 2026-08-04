# Beta review remediation report

**Date:** 2026-08-03  
**Scope:** Fixes applied from [beta-review-00-index.md](./beta-review-00-index.md) and linked reports 01–07.  
**Verification:** `npx tsc --noEmit`, `npm run test:check-coverage`, and full **`npm test`** green on this branch after coordinator follow-ups.

## Sub-agents

| Area | Agent | Outcome |
|------|--------|---------|
| Code & architecture + UI gating | [Code & architecture fixes](042631fa-9c31-4ca1-b19e-0925f5dd2ec4) | Settings Experts/prompts hub, notifications, legacy hashes, Reef labels |
| Documentation | [Documentation fixes](1b1210cc-9980-405a-a3f4-a6886e231bfc) | Manual, context, maintainer tools count, Linux/AppImage, THIRD_PARTY expansion |
| Copy & prompts | [Copy & prompts fixes](147d50d5-1a2b-4f96-bc7c-9fea66ff36fb) | Onboarding, handoff, launch app, Plan/Debug, tool defs, permission gate |
| Tests & CI | [Tests & CI fixes](340861d8-59dd-4ac2-9b43-8dea38b55a5a) | CI-1 targets, scoped suites, issues-app test, headless Node 24 |
| Coordinator | This session | Router/legacy tests, editor reindent dispatch, token budget, wiki catalog, overlap test |

---

## Consolidated blocker status

| ID | Status | What was done |
|----|--------|----------------|
| **BETA-001** | Done | `onboarding.full.md` — 8 released apps, 106/114 tools, Issues/Debug wording |
| **BETA-002** | Done | `settings-reference.md` — 114 / 106 tools + MCP note |
| **BETA-003** | Done | `context.md` — removed stale 50-chat cap; SQLite sessions |
| **BETA-004** | Done | `settings-prompts-hub.ts` — Experts rows/chips gated |
| **UI-Experts** | Done | `experts-settings.ts`, `page-bridge.ts` — hide Experts settings when hidden |
| **COPY-Research** | Done | `general.lite.md`, `mode-handoff.md` / `.lite.md` — `launch_minnow_app` for Research |
| **COPY-Launch** | Done | `launch-minnow-app*.md`, `definitions.ts` — released apps first; bench/experts qualified |
| **DOC-Linux** | Done | `install.md` aligned with AppImage / `releases/v0.0.1.md` |
| **DOC-50-chat** | Done | `first-chat.md`, `chatting.md` |
| **DOC-Skills** | Done | 16 skills + `/create-pr` in manual; README |
| **DOC-THIRD_PARTY** | Partial | `THIRD_PARTY_NOTICES.md` expanded (major deps + `license-checker` pointer); not full SPDX dump |
| **CI-1** | Done | `home.js` meta parity, `create-pr` skill probe, fake LSP formatting, editor reindent fix |
| **CI-2** | Not automated | PR CI still omits packaged Electron — run `board:electron-smoke` before tag |
| **SEC-001** | Partial | Same as DOC-THIRD_PARTY |
| **SEC-008** | Done | `permission-gate.ts` — no `TOOLS_ALLOW_ALL_PATHS` in user errors |

---

## By report

### 01 — Code & architecture

- **P1:** BETA-001/002/004 addressed (prompts + docs + prompts hub).
- **P2:** BETA-006 legacy hashes for hidden apps → `#/desktop` (`router.ts`); BETA-007 toast when app unavailable (`navigate.ts`); BETA-008 email notification scope when Email hidden (`app-for-chat.ts`); BETA-009 mode search visibility (`settings-visibility.ts`, `settings-search-index.ts`).
- **P2/P3:** BETA-012 Reef usage label; BETA-013 stale reef path in `fix-theme-color-mix.mjs`.
- **Deferred:** BETA-005 (lazy-load hidden HTML views); BETA-010 (release process — commit prebuild artifacts on tag).

### 02 — Documentation

- Linux install, chat retention, skills count, `how-minnow-works.md` (General vs Desktop + `minnow_docs_*`).
- `code.md` Source Control Center pointer; `release-e2e-testing.md` maintainers-only banner.
- **Deferred:** `modes.md` / `wiki-and-brain.md` footnotes; manual pages for Expand prompt / Stop all.

### 03 — Tests & CI

- **CI-1:** `server/config/home.js`, `skill-probes.ts`, `test/fixtures/fake-lsp.mjs`.
- **CI-5/6:** `test:brain` includes `.mts`; added `test:onboarding`, `test:issues`, `test:scheduler`, `test:voice`; `AGENTS.md` / `context.md` updated.
- **CI-7:** `test/os/issues-app.test.mts`.
- **CI-8:** `minnow-headless.yml` Node 24 (later removed — headless unit tests already covered by `npm test` / `ci.yml`).
- **Coordinator:** Updated `calendar-app`, `compare-app`, `email-app` legacy-hash expectations; `super-plan/config-meta.test.mts` (`reviewTimeoutMs`); `prompt-overlap-collapse` (trimmed `mode-handoff.md`); `tool-policy` (shorter `launch_minnow_app` copy).
- **Editor:** Fixed multi-line accept + `indentRange` (separate dispatch); `editor-completion-accept.ts`, `state.ts`.

### 04 — Security

- No code security regressions from review scope.
- THIRD_PARTY and permission-gate user copy improved (see above).
- **Still manual:** `npm audit` gate, LAN QA checklist, packaged Electron pen-test.

### 05 — Bugbot

- BUG-001 (manifest/test drift) addressed via CI-1 + wiki catalog regen.
- BUG-002–006 mapped to BETA/copy fixes above.

### 06 — Copy & prompts

- All six copy **beta blockers** from the report: onboarding, Research handoff, launch app, Debug contradiction, Brain/CORTEX, Plan vs code-exec.
- Additional: `minnow_docs_*` / appearance prompts, Debug registry description, Issue planner label, `create-pr` skill label.

### 07 — Browser UI

- Experts settings leakage and launch-tool copy addressed in code + `definitions.ts`.
- **Not re-run live** in this pass; verify Settings search “Experts” on a fresh profile after merge.

---

## Key files touched (grouped)

**Prompts:** `src/chat/prompts/modes/*.md`, `src/chat/prompts/tool-usage/*.md`  
**OS / UI:** `src/os/router.ts`, `app-registry.ts`, `page-bridge.ts`, `src/ui/settings-*.ts`, `src/ui/experts-settings.ts`, `src/chat/modes/settings-visibility.ts`  
**Tools:** `src/tools/definitions.ts`, `permission-gate.ts`  
**Notifications:** `src/notifications/navigate.ts`, `app-for-chat.ts`  
**Editor:** `src/ui/editor-completion-accept.ts`, `editor-suggestions/state.ts`, `intent-accept.ts`  
**Server / config:** `server/config/home.js`, `src/benchmark/suites/skill-probes.ts`  
**Docs:** `documentation/manual/**`, `context.md`, `maintainer/settings-reference.md`, `THIRD_PARTY_NOTICES.md`, `guides/release-e2e-testing.md`  
**Tests / CI:** `test/os/*`, `test/super-plan/config-meta.test.mts`, `test/fixtures/fake-lsp.mjs`, `package.json`, `test/test-config.mjs`  
**Generated:** `server/product-wiki/catalog.json` (regenerated after manual edits)

---

## Recommended before wide beta (remaining)

- [ ] **CI-2 / P2:** Packaged Windows (or target) build + `documentation/guides/release-e2e-testing.md` Smoke tier.
- [ ] **SEC-006:** Dependabot or `npm audit` in CI; triage high/critical.
- [ ] **DOC-THIRD_PARTY / SEC-001:** Full license export for distribution if legal requires it.
- [ ] **BETA-010:** On release branch, `npm run build` and commit wiki/settings/skills manifests.
- [ ] **Bugbot:** Re-run on staged product diff (exclude `test/fixtures/**` churn) before tag.
- [ ] **Live UI smoke:** Settings → Experts absent; `launch_minnow_app` help text in Settings → Tools.

---

## Index todos (from 00-index)

- [x] P1: Rewrite `onboarding.full.md` facts block.
- [x] P1: Gate Experts in Settings + Prompts hub.
- [x] P1: Fix Research handoff docs.
- [x] P1: Align `launch_minnow_app` prompts and `definitions.ts`.
- [x] P1: Resolve Linux install story.
- [x] P1: Fix skills probes / green `npm test` (on this branch).
- [x] P2: Update manual (50 chats, 16 skills, SCC pointer).
- [x] P2: Expand `THIRD_PARTY_NOTICES.md` (partial — process documented).
- [ ] P2: Release E2E Smoke on packaged Windows build.
- [ ] P3: Reef-widget usage fully removed (relabeled only); legacy hash polish optional.
