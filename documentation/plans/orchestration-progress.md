# To-Fix Build Orchestration Progress

Master plan: [`to-fix-step-order.md`](to-fix-step-order.md)

Started: 2026-05-19  
Last updated: 2026-05-19 (Step 17 verifier)

## Workflow

Each step: **Implementer** → **Verifier** → mark PASS/FAIL. Git commit after each **wave** completes.

## Wave status

| Wave | Steps | Implement | Verify | Commit |
|------|-------|-----------|--------|--------|
| 0 | 01 | done | **PASS** | pending |
| 1 | 02 | done | **PASS** | pending |
| 2 | 03 | done | **PASS** | pending |
| 3 | 04–09 | done | **PASS** (04–09) | **done** (Step 09) |
| 4 | 10–11 | done | **PASS** | **done** |
| 5 | 12 | done | **PASS** | **done** (in `cd4602f` with CDP) |
| 6 | 13–15 | done | **PASS** (Steps 13–15; Step 14 re-verified 2026-05-19) | **done** `caf2468` |
| 7 | 16–18 | done | **PASS** | **done** `cd4602f` (16–17), `23808c9` (18 MCP) |
| 8 | 19 | done | **PASS** | **done** `eca9188` |
| 9 | 20 | done | **PASS** (API-wired UI) | pending |
| Final | all | done | **PASS** (automated) | — |

## Final verification (2026-05-19)

| Check | Result |
|-------|--------|
| `npm test` | **PASS** — node **67/67** + tsx **109/109** = **176/176** |
| `npm run build` | **PASS** |
| `npm run test:memory` | **7/7** |
| `npm run test:lsp` | **4/4** |
| `npm run test:mcp` | **3/3** |

## Step log (13–15)

### Step 13 — Skills framework
- **Status:** **PASS** (verifier re-run 2026-05-19)
- **Verification:** [`verification/step-13.md`](verification/step-13.md)
- **Automated:** `npm test` **176/176** (node 67 + tsx 109); `npm run test:skills` **10/10**; `npm run build` **PASS**; `generate-skills-manifest.mjs` **11 skills**; `s13-skills-smoke.mjs` **S1–S6** (coordinated `MINNOW_HOME` + server on matching port)
- **UI (Impeccable):** `load-context.mjs` OK; `skill-picker.css` aligned to DESIGN.md tokens (flat chrome, OKLCH, label badges)
- **Manual deferred:** composer `/` picker keyboard QA, send with `/git-commit`, user override in live UI, `npm run dev` offline picker
- **Commit:** `caf2468` (wave 6)

### Step 14 — Impeccable built-in
- **Status:** **PASS** (verifier re-run 2026-05-19)
- **Verification:** [`verification/step-14.md`](verification/step-14.md)
- **Automated:** `test/skills-impeccable.test.mjs` **10/10**; `npm test` **176/176**; `npm run build` **PASS** (manifest **11** skills); `impeccable:sync` idempotent; `GET /api/skills` includes `impeccable` @ port 5197
- **SKILL.md:** references `PRODUCT.md`, `DESIGN.md`, `.impeccable/design.json` — no OKLCH duplication; picker label **Impeccable** (`/impeccable`)
- **Fix:** memory API test uses `os.tmpdir()` (Windows `ENOTEMPTY` on fixture wipe)
- **Prerequisite for Step 15:** `src/skills/impeccable/SKILL.md`
- **Commit:** `caf2468` (wave 6)

### Step 15 — UI Designer
- **Status:** **PASS** (verifier 2026-05-19)
- **Verification:** [`verification/step-15.md`](verification/step-15.md)
- **Automated:** `npm test` 176/176; `npm run test:ui-designer` U1–U6 + I1–I4; `step15-smoke.mjs`; `npm run build`
- **Deliverables:** `src/agents/ui-designer/*`, `src/skills/ui-designer/SKILL.md`, work agent `ui-designer`, `run_impeccable`, plan-mode write guard
- **Manual deferred:** Chrome CDP + `/ui-designer plan` E2E with vision model
- **Commit:** `caf2468`

## Step log (16–20)

### Step 16 — Memory
- **Status:** **PASS** (re-verified 2026-05-19)
- **Verification:** [`verification/step-16.md`](verification/step-16.md) — `npm run test:memory` **7/7**, `npm test` **176/176**, `npm run build` **PASS**, `step16-memory-smoke.mjs` **4/4**
- **Deliverables:** `server/memory/*`, `src/memory/*`, composer `memory` part, Settings → Memory (`fetchMemoryStatus`, entry count, backup/clear)
- **Commit:** `cd4602f` (bundled with LSP/CDP)

### Step 17 — LSP
- **Status:** **PASS** (re-verified 2026-05-19)
- **Verification:** [`verification/step-17.md`](verification/step-17.md) — `npm run test:lsp` **4/4**, `npm test` **176/176**, `npm run build` **PASS**
- **Deliverables:** `src/lsp/*`, `server/lsp/*`, tools `get_lsp_diagnostics`, `list_lsp_servers`, fake-lsp tests, settings LSP panel wired to `GET/PUT /api/config/lsp`
- **Commit:** `cd4602f`, tests in `2dc6023`

### Step 18 — MCP + Context7
- **Status:** **PASS** (re-verified 2026-05-19)
- **Verification:** [`verification/step-18.md`](verification/step-18.md)
- **Deliverables:** `server/mcp/*`, Context7 seed, `mcp__*` bridge, `npm run test:mcp`, settings MCP list (`src/mcp/client.ts`, `#/settings/mcp`)
- **Automated:** `test:mcp` 3/3, `npm test` 176/176, `npm run build` OK
- **Commit:** `23808c9`

### Step 19 — Self-healing
- **Status:** **PASS** (re-verified 2026-05-19; tier-1 only)
- **Verification:** [`verification/step-19.md`](verification/step-19.md) — detector **2/2**, `npm test` **176/176**, `npm run build` **PASS**
- **Deliverables:** `src/agents/self-healing/*`, orchestrator `observeSubAgentToolCall`, Settings → Features → `selfHealing.enabled`
- **Deferred (tier 2):** explorer sub-agent, `~/.minnow/skills/` authoring, guardrails, `self-heal.jsonl` audit, R2–R4 detector cases, signatures store — see build plan Phase D–E
- **Commit:** `eca9188`

### Step 20 — Settings page
- **Status:** **PASS** (all sections wired to APIs; import/export + topbar popovers deferred)
- **Verification:** [`verification/step-20.md`](verification/step-20.md)
- **Deliverables:** `#/settings/*`, `src/ui/settings-page.ts`, `src/ui/settings-sections.ts`, Impeccable polish on `settings-page.css`
- **Commit:** pending re-verify

## Git commits (waves 6–9)

| SHA | Message |
|-----|---------|
| `caf2468` | ✨ Step 14–15: Impeccable built-in + UI Designer agent |
| `cd4602f` | ✨ Step 15: Integrate memory and LSP support (+ CDP from wave 5) |
| `23808c9` | ✨ Wave 7: MCP servers + Context7 bridge |
| `eca9188` | ✨ Wave 8: Self-healing tier-1 restart |
| `2dc6023` | ✨ Wave 9: Full settings page + verification docs |

## Pending / deferred

- Waves **0–2** commits still **pending** (per original progress).
- Step 19 **tier-2** explorer + skill authoring (manual).
- Step 20: backup zip import/export, per-part Monaco editors, topbar MCP/tool popovers.
- Manual: Chrome CDP, Context7 API key live, LM Studio E2E.
