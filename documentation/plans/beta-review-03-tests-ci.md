# Minnow pre-beta tests and CI review

## Executive summary

Minnow has a **large, well-wired automated suite**: **1,058** `test/**/*.test.{js,mjs,mts,ts}` files, **1,056** included in `npm test`, **2** intentionally excluded (`test/terminal/pty-session.test.mjs`, `test/terminal-stream.test.mjs`). `npm run test:check-coverage` passed locally (**no orphans**).

**PR CI** (`.github/workflows/ci.yml`) runs on **Windows + Ubuntu**: `test:check-coverage` → `check:icons` → `tsc --noEmit` → full `npm test`, plus separate jobs for **board scenario contract** and **production build + bundle budgets**. **Boot budget** is enforced inside `npm test` via `test/boot/boot-budget-ci.test.mts` (reads `budgets.json` `startup.appReadyHarnessMaxMs`: **2500 ms**), not in the `performance-budgets` job (bundle only).

**Beta-facing features** vary in automation depth: **Orchestrate** and **Brain** are heavily covered; **Issues**, **Scheduler**, and **onboarding** lean on unit/happy-dom tests with **no dedicated scoped npm scripts** and **no full-app journey tests** matching `documentation/guides/release-e2e-testing.md`. **Release E2E** remains the main safety net for UX, packaged Electron, providers, and cross-app flows.

**Local `npm test` (in progress on this machine, ~3+ minutes into run):** at least **3 failing tests** appeared before batch 3/4 finished—likely tied to **dirty working tree** (modified `src/skills/builtin-manifest.json`, skills library indexes per git status). Treat as **blockers until green on clean `main`/release branch**.

---

## CI risk assessment

| Area | Risk | Notes |
|------|------|--------|
| **Gate job timeout (20 min)** | **Medium** | ~1,056 files, 4× `tsx-mocks-loader` batches (300 files each), long orchestrate cases (e.g. persisted AFK ~40s+). Windows matrix can be slower than Ubuntu. |
| **No Electron / packaged smoke on PR** | **High for release** | `board:electron-smoke` only in `board-release.yml` (release published / manual). PR CI does not package or run AFK Electron smoke. |
| **Board reliability** | **Medium** | `board-nightly.yml` (3 AM cron, 180 min) runs persisted/restart/soak with `continue-on-error` per step but **fails the job** if any gate fails—not on every PR. |
| **Headless CLI** | **Low** | Unit tests in `test/headless/` covered by main `npm test` / `ci.yml`. Separate `minnow-headless.yml` removed (was redundant; live smoke never enabled). |
| **Conditional skips** | **Low** | Only `test/benchmark/harnesses/humaneval-integration.test.mts` uses `t.skip` when tool server is down (counts as **skipped**, not fail). |
| **Excluded integration tests** | **Low** | PTY live-server scripts excluded from `npm test` and orphan check—**not in CI** unless someone adds a job. |
| **Dirty-tree / manifest drift** | **High until fixed** | Failures observed: `editor-ai-completion-meta`, `skills-probes` (bundled skill list vs `create-pr`), `fake-lsp.integration` formatting. |
| **Scoped suite drift** | **Low for CI, Medium for dev** | `test:brain` omits `test/brain/**/*.test.mts`; no `test:onboarding` / `test:issues` / `test:scheduler` / `test:voice` despite large folders and AGENTS.md mentioning `test:voice`. |

---

## 1. `test/run-all.mjs` and `test:check-coverage`

- **Discovery:** `test/test-discovery.mjs` globs `test/**/*.test.{js,mjs,mts,ts}`, assigns runners via `PATH_RUNNER_RULES` + `DEFAULT_RUNNER_BY_EXT`, batches by argv budget (24k chars, max 300 files/batch).
- **Orphans:** `test/check-test-coverage.mjs` fails if a file has no runner or unknown extension; respects `EXCLUDED_TESTS`.
- **Gaps:** None at discovery level. **Developer gap:** scoped suites in `SCOPED_SUITES` do not mirror all feature areas (see below).

---

## 2. `.github/workflows/ci.yml`

- **Matrix:** `windows-latest`, `ubuntu-latest`, `fail-fast: false`, Node **24**, `npm ci`.
- **Not in gate job:** `npm run build`, `check:performance-budgets` (separate **performance-budgets** job on Ubuntu only).
- **Also not in gate:** `test:board`, `board:electron-smoke`, release E2E, `test:terminal-pty`.

---

## 3. Scoped `package.json` scripts vs beta apps

**Released apps (beta):** Chat, Code, Research, Models, Brain, Issues, Scheduler, Settings.

| Feature | In full `npm test` | Scoped script | Comment |
|---------|-------------------|---------------|---------|
| Brain | Yes (~33 files under `test/brain/`) | `test:brain` | Suite pattern `test/brain/**/*.test.mjs` only—**misses** e.g. `test/brain/code/*.test.mts` |
| Issues | Yes (state, tools, UI, config, router) | **None** | No `test:issues` |
| Scheduler | Yes (`test/scheduler/*`, `test/os/scheduler-app.test.mts`) | **None** | No `test:scheduler` |
| Onboarding | Yes (9 files under `test/onboarding/`) | **None** | Step/unit tests, not full wizard E2E |
| Orchestrate | Yes (`test/orchestrate/**`, many `test/ui/orchestrate*`) | `test:board`, `test:board-gates` | Strong; nightly board gates separate |
| Research | Yes | `test:research` | Aligned |
| Settings | Yes | `test:settings` | Aligned |
| Voice (Models §11) | Yes (`test/voice/**`, 18 files) | **None** | AGENTS.md lists `test:voice`; **not in package.json** |
| Hidden: Calendar, Email, Compare, Bench, Experts | Yes | `test:calendar`, `test:email`, `test:benchmark`, etc. | Still run in CI full suite |

---

## 4. Hidden apps in tests

**Correct pattern:** tests assert **release gating**, not user visibility.

Examples:

- `test/os/router.test.mts` — hidden app hash → desktop fallback  
- `test/tools/launch-minnow-app.test.mts` — rejects developer-hidden apps  
- `test/os/calendar-app.test.mts`, `test/os/desktop-experts-state.test.mts` — `launchApp` blocked  
- `test/os/app-preferences.test.mts` — five hidden apps, core eight released  
- `test/a11y/shell-keyboard-help.test.mts` — catalog omits release-gated apps  

**Feature tests** for hidden apps (e.g. `test/os/compare-app.test.mts`, `test/calendar/**`, `test/email/**`) still run in `npm test`—appropriate for MIN-471 (code stays, UI gated).

---

## 5. Skipped / flaky / `.only` inventory

| Item | Type | Location |
|------|------|----------|
| `t.skip('tool server not reachable')` | **Conditional skip** | `test/benchmark/harnesses/humaneval-integration.test.mts` |
| `EXCLUDED_TESTS` (2 files) | **Not run in npm test** | PTY / terminal-stream integration |
| `.only` / `describe.only` | **None found** in `test/**` | Good |
| `t.skip` elsewhere | **None** in test files (grep) | Good |
| Long polls / wall-clock | **Flake risk** | `test/orchestrate/persisted/persisted-afk.test.mts` (60s loops), composer tests with multi-second `setTimeout`, `humaneval-integration` network |

---

## 6. Boot and performance budgets

- **`budgets.json`:** bundle ceilings (entry JS/CSS, largest lazy chunk, total assets) + `startup.appReadyHarnessMaxMs: 2500`.
- **CI bundle:** `performance-budgets` job → `npm run build` → `npm run check:performance-budgets` (`scripts/check-performance-budgets.mjs`).
- **CI boot:** `test/boot/boot-budget-ci.test.mts` in **gate** `npm test` (happy-dom `scheduleMarkAppReady`). Also `test/boot/app-ready.test.mts`, `boot-metrics.test.mts`, `diagnostics-dedupe.test.mts`.

---

## 7. `release-e2e-testing.md` vs automation

| E2E section | Automated overlap | Gap |
|-------------|-------------------|-----|
| §0 Pre-flight | Partial (`npm test`, pings manual) | Token/curl health not in CI |
| §1 Onboarding | Step/registry tests (`test/onboarding/*`) | No full wizard + provider + finish flow |
| §8 Issues | Store, tools, sort, embed (`test/issues*`, `test/ui/issues*`) | Board drag, bulk delete, taxonomy UI, deep link `ISS-n` journey |
| §9 Orchestrate | Extensive (`test/orchestrate/**`, board contract CI, nightly) | Real LLM path + AFK on packaged build → manual / `board-release` |
| §12 Brain | Strong server + code index tests | Full Graph/Edit/Ingest UI smoke → manual |
| §13 Scheduler | Runner/store + `test/os/scheduler-app.test.mts` | Interval job history, notifications → manual |
| §16 Headless CLI | `test/headless/*.test.mts` (optional workflow) | Live `minnow run` smoke not in default CI |
| §17 Gates | `npm test`, `test:check-coverage` in PR CI | **`board:electron-smoke`**, **`package`**, Standard/Full E2E **not** on PR |

Doc is **accurate** as a manual layer; automation does **not** replace Standard tier (1–2 days).

---

## 8. Feature test footprint (static analysis)

| Area | Approx. test files | Depth |
|------|-------------------|--------|
| **Onboarding** | 9 | Phases, apps step, cloud presets, layout—no end-to-end wizard |
| **Issues** | 13 | Taxonomy API, store, tools, pipeline, list sort, Code embed—**no** `test/os/issues-app.test.mts` |
| **Scheduler** | 8 + OS app test | Server-side scheduling; side panel routing covered |
| **Brain** | 33 | API, ingest, synthesis, code index, tools—strong |
| **Orchestrate** | 51+ | Board E2E, headless `runChatTurn`, merge-fixer, persisted AFK—strongest beta vertical |

**Partial `npm test` on this workspace (batches 1–2 complete):** 579+1942 passed with **1+1+1 failures** in `editor-ai-completion-meta.test.js`, `skills-probes.test.mts`, `fake-lsp.integration.test.mjs`; run was still executing batch 3/4 when reviewed.

---

## Coverage gaps (feature → missing tests)

| Feature | What’s missing |
|---------|----------------|
| **Onboarding** | Full multi-step E2E (theme, provider save, model pick, finish → desktop); rerun wizard from Settings |
| **Issues app** | Happy-dom/OS-level Issues shell (board, detail `ISS-n`, bulk ops, send-to-chat) |
| **Scheduler** | UI panel job create/run/history; notification on due |
| **Desktop Chat** | Many pieces in `test/os/*`, `test/chat/*`; gaps vs E2E: lazy history reload, multi-delete confirm, smart routing |
| **Packaged Electron** | Not in PR CI |
| **Headless CLI live** | No automated live provider smoke in CI |
| **LAN companion** | E2E optional tier only |
| **Skills Library install** | Mostly settings/index tests; network install path manual |

---

## Recommended pre-beta test runs checklist

1. **Clean tree:** `git stash` or release branch; `npm ci`.
2. **CI parity:** `npm run test:check-coverage` → `npm run check:icons` → `npx tsc --noEmit` → `npm test` on **Windows** and **Ubuntu** (or trust CI matrix after push).
3. **Performance:** `npm run build` → `npm run check:performance-budgets`.
4. **Orchestrate:** `npm run board:scenario-contract` → `npm run test:board` → `npm run seed:test-board` + `check:board-log` (per orchestrate guide).
5. **Release-only automation:** `npm run package:dir` → `npm run board:electron-smoke` (Linux unpacked in release workflow; repeat on **Windows packaged** for beta).
6. **Manual:** `documentation/guides/release-e2e-testing.md` **Smoke** tier on **packaged Windows + LM Studio**; second provider spot-check.
7. **Optional:** `npm run test:terminal-pty` with server up; board nightly gates if changing orchestrate persistence.
8. **Before tag:** confirm no failing tests from manifest/skills changes (`skills-probes`, builtin manifest).

---

## Issues table (severity and fix guidance)

| ID | Severity | Issue | Fix guidance |
|----|----------|--------|--------------|
| CI-1 | **P0** | Local/partial `npm test` failures (editor AI defaults, skills list, fake LSP format) | Align `DEFAULT_EDITOR_AI_COMPLETION` with `DEFAULT_META`; sync `builtin-manifest` / probes with bundled skills (`create-pr`); fix or update fake LSP formatting fixture—**green full suite on clean branch** |
| CI-2 | **P1** | PR CI does not run packaged Electron / `board:electron-smoke` | Run manually before beta; trigger `board-release` workflow or local `package` + smoke |
| CI-3 | **P1** | Release E2E Standard tier not automated | Assign testers; use §17 + Smoke script (90 min minimum) |
| CI-4 | **P2** | 20 min job timeout vs ~1k files + slow orchestrate tests | Monitor CI duration; split heavy tests or raise timeout if Windows flaps |
| CI-5 | **P2** | `test:brain` scoped suite incomplete (no `.mts`) | Extend `SCOPED_SUITES.brain` patterns or add `test:brain` glob for `**/*.test.mts` |
| CI-6 | **P2** | No `test:onboarding` / `test:issues` / `test:scheduler` / `test:voice` | Add scoped suites for beta workflows; fix AGENTS.md vs `package.json` for `test:voice` |
| CI-7 | **P2** | Issues lacks OS-level app test (peer: `scheduler-app`, `brain-app`) | Add `test/os/issues-app.test.mts` for registry, routes, `#/app/issues/ISS-n` |
| CI-8 | **P3** | ~~Headless workflow Node 20 vs CI Node 24~~ | Done (Node 24), then workflow removed as redundant with `npm test` |
| CI-9 | **P3** | PTY integration excluded from CI | Document as manual pre-beta or add optional job |
| CI-10 | **P3** | `humaneval-integration` skips without server | Expected; do not rely on it in CI signal |

---

**Files reviewed (absolute paths):**  
`c:\Users\dukky\Documents\Development\Minnow\test\run-all.mjs`, `test\check-test-coverage.mjs`, `test\test-config.mjs`, `test\test-discovery.mjs`, `.github\workflows\ci.yml`, `board-nightly.yml`, `board-release.yml`, `budgets.json`, `documentation\guides\release-e2e-testing.md`, `package.json`, representative tests under `test\onboarding`, `test\issues`, `test\scheduler`, `test\brain`, `test\orchestrate`, `test\os`.

[REDACTED]