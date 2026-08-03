# Pre-beta security review — supplement

**Agents:** [Security & dependencies audit](71490eaf-d5a8-4747-918f-f95bf4bb913e) skipped (empty branch diff). [Security review uncommitted diff](bd934938-9027-4709-bb68-f7a9508822c6) validated whole-product SEC-001–SEC-009 against code; **no P0–P2 issues in that diff** (fixtures + plan docs only).

**Re-run before tag:** `security-review` with `Diff: uncommitted changes` after staging **product** files only (exclude `test/fixtures/**` churn).

**Authority:** `documentation/manual/reference/privacy-and-security.md`, `documentation/context.md`, `AGENTS.md`.

---

## Executive summary

| Severity | Count | Themes |
|----------|-------|--------|
| **P0** | 0 | No confirmed auth bypass or default-wide-open tool server in code review |
| **P1** | 2 | Legal/compliance notices gap; LAN mode user education |
| **P2** | 4 | SSRF/webhooks, path escape opt-in, Electron surface, dependency audit |
| **P3** | 3 | Debug flags, contributor-only env vars in errors |

**Default posture is appropriate for a local-first beta:** loopback bind for dev server (`server/dev-server/effective-guide.js` uses `127.0.0.1` unless LAN), secrets encrypted with `~/.minnow/.key`, plan-mode write guards on client and server.

---

## Issues table

| ID | Sev | Area | Location | Description | Remediation |
|----|-----|------|----------|-------------|-------------|
| SEC-001 | P1 | Compliance | `documentation/THIRD_PARTY_NOTICES.md` | Notices cover icon fonts only, not full `package.json` stack | Run license audit (e.g. `license-checker`) before wide distribution; append to notices |
| SEC-002 | P1 | Network | `server/network/access.js`, Settings LAN | LAN mode binds `0.0.0.0` when enabled | Ensure manual warns restart + pairing; confirm no auth gaps on LAN APIs in QA |
| SEC-003 | P2 | Webhooks | `server/webhooks/ssrf.js` | SSRF blocklist for metadata/internal hosts | **Partially mitigated** — `test/webhooks/ssrf.test.mjs` exists; extend when CalDAV/webhook URLs change |
| SEC-004 | P2 | Files | `TOOLS_ALLOW_ALL_PATHS`, `server/runtime/path-access.js` | Opt-in full-disk access | Keep default workspace-only; ensure Settings copy explains risk (partially done) |
| SEC-005 | P2 | Electron | `electron/main.ts`, `electron/preview-host.ts` | Packaged app attack surface | Main: `contextIsolation: true`, `nodeIntegration: false`. Release audit: preview guest `webSecurity: false` (local preview only) |
| SEC-006 | P2 | Dependencies | `package-lock.json` | No automated CVE gate in CI snippet reviewed | Add `npm audit` or Dependabot policy for beta channel |
| SEC-007 | P3 | Secrets | `server/security/secret-box.js` | Key loss = irrecoverable secrets | Document backup/rotation in manual (partially in context.md) |
| SEC-008 | P3 | Info leak | `src/tools/permission-gate.ts` | Error mentions `TOOLS_ALLOW_ALL_PATHS` | Remove env var from user-visible errors |
| SEC-009 | P3 | Browser tools | `browser_*` Electron allowlist | Automation only in shell | Confirm plain-browser tab cannot invoke (AGENTS.md) |

---

## Positive findings

1. **AES-256-GCM** secret storage with restricted key file mode.
2. **Redaction** paths in settings/diagnostics servers.
3. **Plan mode** write guards tested client + server.
4. **Webhook SSRF** module exists with private-range blocking (`test/webhooks/ssrf.test.mjs`).
5. **Default network** local unless `MINNOW_NETWORK=lan` or Settings toggle.
6. **LAN API auth** — `server/runtime/auth-middleware.js`: `x-minnow-token` on `/api/*`; pairing via `POST /api/auth/pair` with host checks; DNS rebinding guard in `server/network/access.js` (`isHostAllowed()`).
7. **Browser tools** gated by `isElectronPreviewAvailable()` in `src/tools/client.ts`.

## Diff review (2026-08-03, uncommitted)

| Category | Security impact |
|----------|-----------------|
| `test/fixtures/**` (LSP/MCP) | **None** — regenerated test homes; `mcp-secrets.test.mjs` wipes fixture dir each run |
| `documentation/plans/beta-review-*.md` | **None** — handoff text only |

**Fixture hygiene (P3, not vulns):** local username in temp paths in committed fixtures; avoid committing post-test fixture churn (regenerate in CI or gitignore volatile outputs).

**Not security issues (other beta reports):** BETA-004 / Experts UI visibility = product gating; onboarding prompt drift = model mis-teaching, not privilege escalation. Hidden apps remain blocked at `launch_minnow_app` / router.

---

## Pre-beta security checklist

- [ ] `npm audit` (or equivalent) on release branch; triage high/critical.
- [ ] Expand `THIRD_PARTY_NOTICES.md` for shipped dependencies.
- [ ] Manual LAN section matches actual bind behavior and pairing.
- [ ] Packaged Electron: verify no `nodeIntegration` in renderer, minimal preload bridge.
- [ ] Pen-test `launch_minnow_app` + file tools with `TOOLS_ALLOW_ALL_PATHS=0` (default).
- [x] [Security review uncommitted diff](bd934938-9027-4709-bb68-f7a9508822c6) — fixtures/docs only; no new exploitable regressions.
- [ ] Re-run `security-review` on release diff excluding `test/fixtures/**` after manifest/skills land.
- [ ] Packaged build: LAN companion pairing smoke; `TOOLS_ALLOW_ALL_PATHS=0` file-tool pen-test.
