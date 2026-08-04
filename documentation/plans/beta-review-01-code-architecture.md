# Minnow pre-beta code review

**Scope:** `c:\Users\dukky\Documents\Development\Minnow` (read-only). Baselines: `documentation/context.md`, `AGENTS.md`.

---

## Executive summary

| Severity | Count | Themes |
|----------|-------|--------|
| **P0** | 0 | No confirmed release bypass, credential leak, or broken plan/path/encryption guard |
| **P1** | 4 | User-facing docs/prompts advertise hidden apps and wrong tool counts |
| **P2** | 8 | Settings Prompts hub, notifications edge case, DOM/bundle surface, manifest hygiene |
| **P3** | 6 | Reef remnants, stale context lines, dead script paths, minor inconsistencies |

**Overall:** Release gating for hidden apps is implemented consistently (`isDeveloperReleased` → `isAppEnabled` → router/dock/tools) with solid tests in `test/os/router.test.mts` and `test/os/app-preferences.test.mts`. Beta risk is mostly **documentation and prompt drift**, not core security architecture.

---

## Issues table

| ID | Severity | Area | File / location | Description | Suggested fix | Owner hint |
|----|----------|------|-----------------|-------------|---------------|------------|
| BETA-001 | P1 | Docs / prompts | `src/chat/prompts/modes/onboarding.full.md` (§ Minnow facts) | Onboarding mode tells users about **Experts**, **email**, **calendar**, and **~88 built-in tools** while those apps are hidden and catalog is **114 / 106 exposed**. | Rewrite facts for released apps only; use **106** (or “114 total, 8 app-gated”) consistent with `AGENTS.md`. | Prompts / onboarding |
| BETA-002 | P1 | Docs | `documentation/maintainer/settings-reference.md` (~line 371) | States **89 built-in tools** for per-tool permissions; catalog has **114** definitions, **106** default-exposed. | Regenerate or hand-edit to **106** (+ note MCP tools); cross-link `definitions.ts`. | Docs / maintainer |
| BETA-003 | P1 | Docs | `documentation/context.md` (§ Scale vs § Multi-chat) | Scale says **114 / 106** tools (correct); Multi-chat still says **Max 50 chats** while persistence section says no `MAX_CHATS` hard-trim. | Remove or qualify the 50-chat cap; align with sessions SQLite behavior. | Docs |
| BETA-004 | P1 | Settings UI | `src/ui/settings-prompts-hub.ts` (`loadPromptHubRows`, filter chips) | **Experts** prompts and filter remain editable/searchable when `experts` app is `releaseState: 'hidden'` (unlike `settings-search-index.ts` expert entries, which are gated). | Gate expert rows/chips with `isDeveloperReleased('experts')` (mirror `expertEntries()`). | Settings UI |
| BETA-005 | P2 | Release gating | `index.html` (`#benchmarkView`, `#compareView`, `#btnBenchmark`, `#btnExpertLab`) | Hidden app markup stays in the shipped shell; buttons hidden via `page-bridge.ts` / handlers, but DOM and lazy routes still exist. | Accept for beta or lazy-load hidden views only when released (bundle/size polish). | Shell / frontend |
| BETA-006 | P2 | Release gating | `src/os/router.ts` `resolveLegacyHash` | Legacy hashes (`#/benchmark`, `#/compare`, `#/calendar`, `#/email`) rewrite to `#/app/…` then `isAppAvailable` bounces to desktop (good); brief hash flash possible. | Optional: redirect legacy hashes straight to `#/desktop` when app hidden. | OS router |
| BETA-007 | P2 | Notifications | `src/notifications/navigate.ts` | `openNotificationTarget` calls `launchApp(record.appId)` without pre-check; mitigated because `launchApp` / `rejectUnavailableApp` block hidden apps. Legacy **email** notifications may no-op to desktop without clear UX. | Toast when `!isAppAvailable(record.appId)` before launch. | Notifications |
| BETA-008 | P2 | Notifications | `src/notifications/app-for-chat.ts` | `appScope === 'email'` maps to `appId: 'email'` even when Email app is hidden. | Map to Code/desktop or suppress email-scoped notification targets when hidden. | Notifications / email |
| BETA-009 | P2 | Settings UI | `src/ui/settings-search-index.ts` `modeEntries()` | Settings search lists **email** (and all `listModes()`) including hidden-app modes. | Filter modes tied to hidden apps or non-composer surfaces per product rules. | Settings |
| BETA-010 | P2 | Manifest drift | `package.json` `prebuild` chain; `server/product-wiki/catalog.json`, `server/settings/registry-manifest.json`, `src/skills/library/index/*.json` | Generators run on `prebuild`; initial workspace git status showed drift on wiki/settings/skills indices. Clean tree here—**release process** must commit regenerated artifacts. | `npm run build` (or individual `wiki:generate`, `settings-registry:generate`, `skills-library:index`) before tag; CI already builds on PR. | Release / devops |
| BETA-011 | P2 | Tool docs | `README.md`, `PRODUCT.md`, `AGENTS.md`, `context.md` | **114 / 106** aligned in most places; **settings-reference** and **onboarding** prompt diverge (see BETA-001/002). | Single source of truth in `context.md` § Scale; grep docs for `88` / `89`. | Docs |
| BETA-012 | P2 | Reef (MIN-473) | `src/usage/types.ts`, `token-ledger.ts`, `src/ui/settings-usage.ts` | `reef-widget` usage kind/labels remain; no `src/chat/reef/` tree. | Remove or alias labels to historical usage rows; drop dead enum if safe. | Usage / analytics UI |
| BETA-013 | P3 | Dead code | `scripts/fix-theme-color-mix.mjs` | References `src/chat/reef/widgets` (path absent). | Update script or delete if obsolete. | Tooling |
| BETA-014 | P3 | Skills count | `src/skills/builtin-manifest.json` | **15** bundled skills (`AGENTS.md`); manifest generated 2026-08-03. | Keep `prebuild` in release pipeline. | Skills |
| BETA-015 | P3 | TODO hygiene | `src/` (excl. vendored impeccable) | No `TODO`/`FIXME`/`HACK` in `src/` TypeScript or `server/` JS outside vendored skills. | No action. | — |
| BETA-016 | P3 | Modes docs | `AGENTS.md` vs `registry.ts` | AGENTS: “four composer modes”; registry has more surface modes (email, desktop, onboarding excluded from composer strip—correct). | Clarify “composer strip” vs “mode registry” in docs only. | Docs |

---

## Focus area notes

### 1. Release gating (hidden apps)

**Central chain:** `src/os/app-registry.ts` (`releaseState: 'hidden'` for compare, bench, experts, calendar, email) → `isDeveloperReleased` / `listReleasedApps` → `isAppEnabled` in `src/os/app-preferences.ts` → `listDockApps`, router `applyRoute`, `launchApp`, `rejectUnavailableApp`.

**Verified call sites:** dock (`listDockApps`), `toolLaunchMinnowApp` (`src/tools/os-launch-tool.ts`), settings catalog filter (`settings-catalog-filter.ts`), optional app keys, onboarding `isApplicable` for email/calendar, tools `appId` filter (`client.ts`), shell buttons (`page-bridge.ts`, `shell-handlers.ts`).

**Tests:** `test/os/app-preferences.test.mts` (8 released / 5 hidden, dock includes scheduler); `test/os/router.test.mts` (`#/app/email` → desktop, `launchApp('experts')` blocked).

**Gap:** Settings Prompts hub (BETA-004); legacy hash rewrite (BETA-006); static HTML (BETA-005).

### 2. Secrets / credentials / debug flags

- **At-rest encryption:** `server/security/secret-box.js` (AES-256-GCM, `~/.minnow/.key`, `0o600`).
- **Redaction:** `server/settings/redact.js`, `server/diagnostics/redact.js`.
- **No hardcoded API keys** found in `src/` / `server/` (provider secrets via API; web search keys from config).
- **`MINNOW_DEBUG`:** gated in `src/config/dev-surfaces.ts`, `server/config/dev-surfaces.js`, boot metrics, long-task observer—not default production behavior.
- **`TOOLS_ALLOW_ALL_PATHS`:** opt-in; mirrored in client `permission-gate.ts` and `server/runtime/path-access.js`.

### 3. TODO / FIXME / HACK

- **Server:** none.
- **Src:** only vendored `src/skills/impeccable/scripts/live-browser.js` TODO.

### 4. Tool counts

- **`definitions.ts`:** **114** tools with `id: '…'` (script count).
- **App-gated:** `manage_calendar` + **7** email tools (`appId` in definitions) → **106** default exposure (MIN-472).
- **Drift:** maintainer settings reference **89**; onboarding prompt **~88**.

### 5. Plan mode, path safety, encryption

- **Client:** `src/chat/modes/plan-write-guard.ts` + `client.ts` `blockPlanModeWriteWithContent`.
- **Server:** `server/tools/plan-write-guard.js` + `tools-middleware.js` (~line 1409).
- **Tests:** `test/modes/plan-write-guard.test.mts`, `test/server/plan-write-guard.test.mjs`, `test/super-plan/no-code-guard.test.mts`.
- **Path safety:** `resolveSafePath` / workspace-only default; full disk via Settings or `TOOLS_ALLOW_ALL_PATHS=1`.

### 6. Electron vs browser-only tools

- **`serverRequired: false`:** datetime, calculate, board/sub-agent tools, `browser_*`, `launch_minnow_app`, appearance tools, etc.
- **Server:** unknown/b browser tools → `Not implemented: ${name}` (`tools-middleware.js` ~1296).
- **`browser_*`:** Electron + allowlist (per AGENTS.md).

### 7. Dead code / Reef (MIN-473)

- No `src/chat/reef/` directory.
- Remnants: usage types/labels (BETA-012); stale script path (BETA-013).
- `listComposerModes()` excludes removed Reef; `test/prompts/mode-handoff-prompt.test.mjs` asserts no `reef-widget` in handoff prompt.

### 8. `package.json` scripts / package readiness

- **CI:** `.github/workflows/ci.yml` — `npm ci`, test coverage gate, `tsc`, `npm test`, performance budgets on build.
- **Package:** `prepackage` → `validate-packaged-runtime-files.mjs` + `electron-builder`; `prebuild` regenerates skills/settings/wiki manifests.
- **Version:** `0.0.1` — appropriate for pre-beta.

### 9. Product wiki, settings manifests, skills library

- Generators wired in `prebuild`; `builtin-manifest.json` present with `generatedAt`.
- Ensure release branch commits generated outputs after index/catalog changes (BETA-010).

---

## Positive findings

1. **Single availability model** (`isAppEnabled` / `isAppAvailable`) used across dock, router, tools, and onboarding applicability.
2. **`launch_minnow_app` explicitly blocks** hidden/disabled apps with clear errors (`os-launch-tool.ts`).
3. **Automated tests** for hidden deep links and `launchApp(experts)` (`router.test.mts`, `app-preferences.test.mts`).
4. **Plan mode parity** client + server with dedicated tests.
5. **Mode handoff** restricts `set_chat_mode` to `HANDOFF_MODES` (no email/orchestrate/debug via tool—`mode-handoff-tools.ts`).
6. **Composer strip** excludes email/desktop/onboarding (`listComposerModes`).
7. **Settings catalog filter** hides optional app fields and `agents.experts` when not released.
8. **No server-side TODO/FIXME debt**; minimal src TODO outside vendored skills.
9. **Tool catalog count** matches documented **114** in `definitions.ts`.
10. **LAN / auth** documented as loopback-default, opt-in LAN pairing (`context.md`).

---

## Beta blockers list

**Must fix before beta (product truth):**

1. **BETA-001** — Onboarding prompt advertises hidden apps and wrong tool count.
2. **BETA-002** — Maintainer settings reference tool count (**89**).
3. **BETA-004** — Settings Prompts hub exposes Experts when Experts app is hidden.

**Should fix before or immediately after beta:**

4. **BETA-003** — Stale “max 50 chats” in `context.md`.
5. **BETA-010** — Regenerated wiki/settings/skills manifests committed on release branch.
6. **BETA-007 / BETA-008** — Notification navigation when `appId` is hidden (email legacy).

**Not blockers but track:**

7. BETA-005 / BETA-006 — HTML/bundle and legacy hash polish for hidden apps.
8. BETA-012 / BETA-013 — Reef cleanup for maintainability.

---

## Severity legend

- **P0:** Security, data loss, or hidden app reachable in normal UX.
- **P1:** Incorrect user/agent-facing product claims or settings exposing unreleased product.
- **P2:** Edge cases, doc drift, release hygiene.
- **P3:** Cleanup, dead paths, cosmetic consistency.

If you want this turned into Linear issues or a `documentation/plans/pre-beta-review.md` checklist, say which IDs to import.

[REDACTED]