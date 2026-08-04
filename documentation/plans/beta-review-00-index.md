# Minnow pre-beta review — index

**Generated:** 2026-08-03  
**Purpose:** Handoff pack for fix agents. Each linked report is self-contained with severities, locations, and remediation guidance.

## Sub-agents used

| Area | Agent | Report |
|------|--------|--------|
| Code & architecture | [Code & architecture beta audit](4832ce42-8f6d-4b24-a655-04e7e80b7e86) | [beta-review-01-code-architecture.md](./beta-review-01-code-architecture.md) |
| Documentation | [Documentation beta audit](2ad9f6db-c818-456a-a7ca-9a3761980714) | [beta-review-02-documentation.md](./beta-review-02-documentation.md) |
| Tests & CI | [Tests & CI beta audit](c8a55fb4-9829-4162-9d33-9e4b72e28305) | [beta-review-03-tests-ci.md](./beta-review-03-tests-ci.md) |
| Security | [Security & dependencies audit](71490eaf-d5a8-4747-918f-f95bf4bb913e), [Security review uncommitted diff](bd934938-9027-4709-bb68-f7a9508822c6) | [beta-review-04-security.md](./beta-review-04-security.md) |
| Defect scan (branch) | [Bugbot branch code review](34fc8a89-fea3-45f2-b903-0a948313a02b) | [beta-review-05-bugbot.md](./beta-review-05-bugbot.md) (supplement; agent skipped — empty branch diff) |
| Copy & prompts | [Copy & prompts beta audit](b4d49c65-932b-4913-a6ef-c874e0995775) | [beta-review-06-copy-prompts.md](./beta-review-06-copy-prompts.md) |
| Browser UI (live) | [Browser UI beta walkthrough](813886c1-2148-4833-a84f-7f0e59008d56) + coordinator pass | [beta-review-07-browser-ui.md](./beta-review-07-browser-ui.md) |
| **Remediation (fix pass)** | Four parallel fix agents + coordinator | [beta-review-08-remediation-report.md](./beta-review-08-remediation-report.md) |

## Model note (agent testing)

You asked sub-agents that exercise Minnow’s own agents to use **Deepseek v4 flash on OpenCode**. That slug is **not** available for Cursor Task sub-agents (allowed list is in workspace agent settings). For **in-app** agent testing, configure that model in **Models** (as in the live UI review). Sub-agents used the parent default (`inherit`).

## Consolidated P0 / P1 beta blockers

Fix these before a wide beta; IDs cross-reference detailed reports.

| ID | Source | Summary |
|----|--------|---------|
| BETA-001 | Code, Copy | `onboarding.full.md` wrong tools/apps; teaches hidden Experts/Email/Calendar |
| BETA-002 | Code, Docs | Maintainer `settings-reference.md` tool count **89** vs **114/106** |
| BETA-003 | Code, Docs | `context.md` stale **50-chat** cap vs SQLite sessions |
| BETA-004 | Code, Copy, UI | Settings **Experts** section + Prompts hub visible while Experts app is hidden |
| COPY-Research | Copy | Research handoff via `set_chat_mode` (Research is an app) |
| COPY-Launch | Copy, UI | `launch_minnow_app` / tool defs mention Bench/Experts for all users |
| DOC-Linux | Docs | `install.md` vs `releases/v0.0.1.md` Linux/AppImage contradiction |
| DOC-50-chat | Docs | Manual still claims 50-chat cap |
| DOC-Skills | Docs | Manual says 15 skills; manifest has **16** (`create-pr`) |
| DOC-THIRD_PARTY | Docs | `THIRD_PARTY_NOTICES.md` icons-only |
| CI-1 | Tests | Green `npm test` on **clean** tree (manifest/skills drift caused local failures) |
| CI-2 | Tests | Packaged Electron / `board:electron-smoke` not on PR CI — run before tag |
| UI-Experts | UI | Settings → Experts toggle + copy references flask icon when app hidden |

## Recommended fix order

1. **Truth layer:** onboarding prompt, tool descriptions, `launch-minnow-app` prompts, `app-registry` Brain description (CORTEX).
2. **Gating UI:** Settings Experts block, Prompts hub Experts rows (`settings-prompts-hub.ts`).
3. **Docs:** Linux install, chat retention, skills count, THIRD_PARTY audit.
4. **Release hygiene:** `npm run build` / prebuild manifests committed; full test matrix + release E2E smoke.
5. **Polish:** Reef usage labels, notification email targets, legacy hash redirects.

## Todos for fix agents

- [ ] P1: Rewrite `src/chat/prompts/modes/onboarding.full.md` facts block (8 apps, 106 tools).
- [ ] P1: Gate Experts in Settings + Prompts hub (`isDeveloperReleased('experts')`).
- [ ] P1: Fix Research handoff docs (`general.lite.md`, `mode-handoff*.md`).
- [ ] P1: Align `launch_minnow_app` prompts and `definitions.ts` catalog text with release gating.
- [ ] P1: Resolve Linux install story (`documentation/manual/get-started/install.md` + `releases/v0.0.1.md`).
- [ ] P1: Regenerate/commit skills + wiki manifests; fix `skills-probes` / `npm test` on clean branch.
- [ ] P2: Update manual (50 chats, 16 skills, Source Control Center, Expand prompt).
- [ ] P2: Expand `THIRD_PARTY_NOTICES.md` for distribution.
- [ ] P2: Run `documentation/guides/release-e2e-testing.md` Smoke on packaged Windows build.
- [ ] P3: Remove Reef-widget usage labels; fix `debug.full.md` composer contradiction.
