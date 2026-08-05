# MIN-553 — Agent shell sandbox / host containment

**Linear:** [MIN-553](https://linear.app/minnowai/issue/MIN-553/agent-shell-sandbox-host-containment-not-just-worktrees)
**Status:** In progress — Phases 0–2 / 5–6 landed on this branch (Seatbelt + Landlock helper + WSL2 routing + side-door wrap); Phase 3 settings UI may still be in flight; Phase 4 docs in flight
**Related:** MIN-275 worktree isolation (complementary, different problem)
**Locked plan:** Cursor plan `agent_shell_sandbox_fbb89f8d` (decisions below supersede earlier “Windows unsandboxed forever” spike notes)

---

## Locked product decisions

- **No Docker / OCI**
- **Filesystem containment only in v1** — network unrestricted under default `workspace` profile; curated allowlist / deny-all deferred (needs a proxy; Seatbelt/Landlock cannot hostname-filter)
- **PTY / interactive terminal:** never sandboxed
- **Setting:** `toolSecurity.shellSandbox` ∈ `off` \| `prefer` \| `require` (default **`off`**) — **wired** (Phase 3). Dev flag **`MINNOW_SHELL_SANDBOX=1`** still elevates `off` → `prefer`
- **AFK / autopilot boards:** default **`require`** via `autopilot.shellSandbox` (overridable per board); worktree isolation remains complementary and must be documented as **git isolation**, not host containment
- **Unavailable sandbox:** under `prefer` → Ask strip (Allow once / Always allow / Cancel to run unsandboxed); under `require` → clear actionable error, **no silent fallback**. AFK boards that cannot prompt stay fail-closed under `require`
- **Windows:** WSL2 **+** Landlock when available (Cursor-shaped). Bare WSL alone is **not** containment. Otherwise honest unavailable
- **Worktrees ≠ shell sandbox** — Autopilot / privacy copy fixed in Phase 4 regardless of platform lag

---

## Todos (repo state)

| ID | Item | Status |
|---|---|---|
| phase-0-ci-macos | Add `macos-latest` to CI gate matrix; confirm suite green | **Partial** — matrix landed in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml); green confirmation on `macos-latest` not verified in this pass |
| phase-1-seatbelt | Sandbox adapter + macOS Seatbelt wrap after `resolveOneShotSpawn`; canary + cancel tests | **Done (code)** — [`server/terminal/sandbox/`](../../server/terminal/sandbox/), wired in [`terminal-runner.js`](../../server/terminal-runner.js); tests under [`test/terminal/sandbox/`](../../test/terminal/sandbox/) |
| phase-2-side-doors | Reroute `run_javascript` / `run_python` through `createRun`; assert background wraps | **Done (code)** — both go through `executeCommandBlocking` → `createRun`; tests in [`phase2-side-doors.test.mjs`](../../test/terminal/sandbox/phase2-side-doors.test.mjs) |
| phase-3-setting-signals | Three-state setting, board `require` default, Ask escalation, UI/trailer/board-log signals | **Done** — `toolSecurity.shellSandbox` + `getShellSandboxFromConfig`; autopilot/board defaults; Ask strip; trailers/badge/board-log |
| phase-4-docs | Privacy / tools / context / Autopilot copy + refresh this plan | **In progress** (this pass) |
| phase-5-linux | Ship `minnow-sandbox` Landlock+seccomp helper; ubuntu canaries + packaging | **Done (code)** — [`landlock.js`](../../server/terminal/sandbox/landlock.js) + [`native/minnow-sandbox/`](../../native/minnow-sandbox/); `npm run sandbox:build-helper`; Linux `extraResources`; canaries in [`landlock-canary.test.mjs`](../../test/terminal/sandbox/landlock-canary.test.mjs) (skip-clean when helper/ABI absent) |
| phase-6-windows-wsl | Windows: WSL2 + Landlock when available; honest unavailable otherwise | **Done (code)** — [`wsl-landlock.js`](../../server/terminal/sandbox/wsl-landlock.js); probe maps `wsl_unavailable` / Landlock reasons; wrap = `ensureWslOneShotSpawn` + Phase 5 `wrapWithLandlock` inside WSL; tests in [`wsl-landlock.test.mjs`](../../test/terminal/sandbox/wsl-landlock.test.mjs) |

---

## 1. The gap this closes

Today Minnow contains agents several ways ([`privacy-and-security.md`](../manual/reference/privacy-and-security.md)): the workspace path boundary, tool permissions, mode allowlists, untrusted-content fencing, and (when enabled) the agent shell sandbox. Three of the first four stop at the shell.

`execute_command` runs an arbitrary string through `cmd.exe /c` or `$SHELL -l -c`. Once the model is inside that string, the workspace boundary is gone — it only ever guarded *file tools*, which resolve paths in JS before touching disk. A shell command has the full authority of the Minnow process unless the OS sandbox wraps it.

Concretely, on today's build with `execute_command` on **Full** and **without** `MINNOW_SHELL_SANDBOX=1`:

| Command | Blocked by | Result |
|---|---|---|
| `cat ~/.minnow/.key` | nothing | **secret-box master key exfiltrated to the model** |
| `cat ~/.minnow/config.json` | nothing | provider API keys, mail config |
| `cat ~/.ssh/id_ed25519`, `~/.aws/credentials`, `~/.config/gh/hosts.yml` | nothing | host credentials |
| `rm -rf ~/Documents/other-project` | nothing | data loss outside the workspace |
| `cd ~/other-repo && git reset --hard` | `cwd-guard` only when a worktree is active *and* the string starts with `cd` | usually nothing |
| `kill <minnow pid>` | `assessHostKillCommand` | blocked |
| `node -e "require('fs').readFileSync(...)"` via `run_javascript` | nothing (and bypasses sandbox chokepoint until Phase 2) | same as above, different tool |

The worktree work (MIN-275/276) fixed *agents colliding with each other*. It did nothing about *an agent reaching the rest of the host*. Those get conflated in conversation and in AFK board copy — Phase 4 fixes that wording.

**`~/.minnow/.key` is the single highest-value target on the machine and it is currently one `cat` away** unless the sandbox is on and available.

---

## 2. Threat model

**In scope — a model that is wrong or steered wrong.** Prompt injection from a fetched page, a poisoned dependency's postinstall, a hallucinated destructive command, an AFK board running unattended for six hours. The agent is not *trying* to escape; it is doing what some text told it to do.

**Out of scope — a determined attacker with code execution who is trying to escape.** Seatbelt and Landlock both have known bypass classes. If a native binary inside the sandbox is deliberately hunting for a kernel LPE, it wins. We do not claim otherwise, in the product copy or anywhere else.

**Explicit non-goals for this ticket:**

- Sandboxing the **user's** interactive PTY tabs. The user is trusted; sandboxing their terminal would be user-hostile and is a different feature.
- Sandboxing MCP stdio servers, LSP servers, `ripgrep`, `git`, or the model runtime. Those are user-installed software with a different trust story, and each has its own breakage surface. Later ticket if ever.
- Network egress filtering by host. See §6.4 — this genuinely requires a proxy and does not belong in v1.
- Any container runtime. Confirmed: **no Docker, Podman, or OCI.**
- Dedicated Minnow WSL distro — **out of scope** for v1 (Phase 6 uses the user's WSL2 + Landlock when available).

**Success criterion for v1:** with the sandbox on, an agent shell command cannot read `~/.minnow/.key` and cannot write outside its workspace/worktree, on at least one shipped platform, and the failure is legible to both the user and the model.

---

## 3. Code audit — where processes actually spawn

| Path | Entry | Reaches | Sandbox in v1? |
|---|---|---|---|
| `execute_command` foreground | [`tools-middleware.js`](../../server/runtime/tools-middleware.js) → `executeCommandBlocking` → `createRun` | `resolveOneShotSpawn` → `applyAgentShellSandbox` → `runProcess` | **Yes** (when flag on) |
| `execute_command` background | → `createBackgroundRun` | same chokepoint | **Yes** |
| `run_javascript` | [`tools-middleware.js`](../../server/runtime/tools-middleware.js) | **`runProcess('node', ['-e', code])` directly** | **No until Phase 2** |
| `run_python` | same | **`runProcess(bin, ['-c', code])` directly** | **No until Phase 2** |
| `POST /api/terminal/run`, `source: 'agent'` | [`terminal/middleware.js`](../../server/terminal/middleware.js) | `createRun` | **Yes** |
| `POST /api/terminal/run`, `source: 'user'` | same | `createRun` | **No** — user PTY, out of scope |
| `manage_dev_servers` | [`dev-server/manager.js`](../../server/dev-server/manager.js) | `createBackgroundRun` with `sandbox: false` | **No in v1** |
| `models/serve.js` llama.cpp | [`models/serve.js`](../../server/models/serve.js) | `createBackgroundRun` | **No** |

### 3.1 The chokepoint

[`resolveOneShotSpawn`](../../server/terminal/one-shot-spawn.js) remains the right seam. Composition order (landed in Phase 1):

`resolveOneShotSpawn` → [`applyAgentShellSandbox`](../../server/terminal/sandbox/index.js) → spawn

A sandbox is an argv wrapper composed *after* shell/WSL resolution, same shape as the existing WSL rewrite. `run_python` / `run_javascript` must still be rerouted through `createRun` (Phase 2) or they are a silent hole.

---

## 4. Platform mechanisms

### 4.1 macOS — Seatbelt (Phase 1 — landed)

`sandbox-exec` is present on every macOS, needs no entitlement, no install, no helper binary. Adapter: [`seatbelt.js`](../../server/terminal/sandbox/seatbelt.js). Probe is a real execution, cached per boot.

### 4.2 Linux — Landlock + seccomp helper (Phase 5 — landed)

Node's `child_process.spawn` exposes no pre-exec hook. Shipped delivery: static-ish helper binary (`minnow-sandbox`) under [`native/minnow-sandbox/`](../../native/minnow-sandbox/) that applies Landlock (+ best-effort minimal seccomp) then `execve`s the real command. ABI negotiate/degrade; `--probe` exit **75** → `landlock_abi_unavailable`. Adapter: [`landlock.js`](../../server/terminal/sandbox/landlock.js). Packaging: `build.linux.extraResources` → `resources/minnow-sandbox`; resolve via `MINNOW_SANDBOX_HELPER`, resources path, repo build output, or PATH.

### 4.3 Windows — WSL2 + Landlock when available (Phase 6 — landed)

Cursor’s model: same Linux sandbox **inside WSL2**, not a native Win sandbox.

A default WSL2 distro mounts every host drive read-write at `/mnt/c`. `wsl.exe -- bash -c 'cat /mnt/c/Users/…/.minnow/.key'` succeeds. Routing through [`buildWslOneShotSpawn`](../../server/terminal/wsl.js) alone buys **zero** containment.

**Locked approach (implemented):** when sandbox is on and WSL2 + Landlock helper are available, route agent one-shots through WSL and apply [`wrapWithLandlock`](../../server/terminal/sandbox/landlock.js) inside that tree ([`wsl-landlock.js`](../../server/terminal/sandbox/wsl-landlock.js)). Probe: WSL present + helper runnable inside WSL + Landlock ABI usable. Reason codes: `wsl_unavailable`, `landlock_helper_missing`, `landlock_abi_unavailable`, `landlock_unavailable`. Helper resolution: Linux ELF on WSL PATH, or host path translated to `/mnt/…` (`MINNOW_SANDBOX_HELPER` / resources / repo build). If WSL or Landlock is missing, treat as sandbox unavailable (`prefer` → Ask; `require` → error). Dedicated Minnow distro with automount disabled is **out of scope** for v1. **Native Win sandbox remains future work.**

Bare WSL without Landlock is **never** reported as `applied: true`.

---

## 5. Platform order

**Ship macOS first (Phase 1). Linux second (Phase 5). Windows via WSL2+Landlock third (Phase 6).**

Phase 0 adds `macos-latest` to the CI gate matrix so Seatbelt work is covered. **Matrix change is landed;** green confirmation on `macos-latest` remains an exit criterion for Phase 0.

---

## 6. Design

### 6.1 Adapter interface

Module `server/terminal/sandbox/` (exists):

```
sandbox/index.js        resolveSandbox() / applyAgentShellSandbox / probe
sandbox/policy.js       buildWorkspacePolicy(...)
sandbox/seatbelt.js     macOS: policy -> .sb text; argv wrapper
sandbox/landlock.js     Linux: minnow-sandbox helper argv + probe (Phase 5)
sandbox/wsl-landlock.js Windows: WSL2 route + Landlock inside WSL (Phase 6)
sandbox/unavailable.js  reason codes for the honest-signal path
native/minnow-sandbox/  C helper source + build.sh
```

`wrap` takes the *already-resolved* `resolveOneShotSpawn` output. Probe results cache per-boot.

### 6.2 Setting: three states, not a boolean

**Today:** `MINNOW_SHELL_SANDBOX=1` enables prefer-like wrap where available; unsupported platforms return `applied: false` with an honest reason (Phase 1 does not yet Ask or hard-fail).

**Phase 3:** `toolSecurity.shellSandbox` in `config.json`, next to `toolSecurity.filesystemAccess`:

| Value | Behaviour |
|---|---|
| `off` | Today's default behaviour without the env flag. **v1 default.** |
| `prefer` | Sandbox where available; unavailable → Ask strip to run unsandboxed |
| `require` | Fail-closed. Sandbox unavailable → tool call errors and says why. |

AFK / autopilot boards default to **`require`** (overridable), parallel to how `isolationMode` is configured.

Registry entry under `category: general`, `path: toolSecurity.shellSandbox`, `sensitivity: dangerous`, mirroring `general.filesystem`. Reader helper next to [`getFilesystemAccessFromConfig`](../../server/config/tool-security.js).

### 6.3 Policy profiles

**`workspace` (default when sandbox is on)** — landed in Phase 1 policy builder:

- **Write:** workspace root or active worktree; `$TMPDIR`; package caches; `~/.minnow/logs/terminal`.
- **Read:** system paths / home — **minus credential denylist.**
- **Deny read:** `~/.minnow` except active worktree slot + terminal logs; `~/.ssh`; `~/.aws`; `~/.config/gh`; cloud/CLI creds; browser profiles.
- **Network:** allowed.

**`strict`** — later (Phase 6+ / unscheduled): workspace+temp write only, network denied.

Hard-won details:

1. **`~/.minnow` deny + worktree re-allow** — board slots live under `~/.minnow/worktrees/<…>`. Both directions need tests (present in policy suite).
2. **First-party `gh` / git tools** stay outside the sandbox (trusted argv); agent shell still cannot `cat ~/.config/gh`.

### 6.4 Network: allow in v1, and say so

Neither primitive can hostname-filter. Deny-all breaks package managers. **v1 = filesystem containment only, network unrestricted, documented as such.**

### 6.5 What the sandbox must not break

- `manage_dev_servers` → excluded (`sandbox: false`).
- `npm install` needs `~/.npm` + network → both allowed under `workspace`.
- Login shells read profiles → read-allowed.
- Board-task port env passed via `env`, untouched.
- Cancellation: `killProcessTree` must still reach sandboxed children (Phase 1 exit criterion / canary suite).

---

## 7. Phasing

Each phase is independently shippable and independently revertible.

### Phase 0 — CI readiness — **partial**
- [x] Add `macos-latest` to the [`ci.yml`](../../.github/workflows/ci.yml) gate matrix.
- [ ] Confirm the suite is green on `macos-latest`.
- **Exit:** three-OS CI green.

### Phase 1 — Adapter + macOS Seatbelt, env-flag only — **code landed**
- [x] `server/terminal/sandbox/` + wrap after `resolveOneShotSpawn`.
- [x] Dev flag `MINNOW_SHELL_SANDBOX=1` (no UI).
- [x] `workspace` profile + Seatbelt; Linux/Windows honest unavailable.
- [ ] Confirm cancel-leaves-no-orphan exit criterion on a green macOS CI run.
- **Exit:** `MINNOW_SHELL_SANDBOX=1` + `cat ~/.minnow/.key` fails on macOS; workspace happy path; cancelled run leaves no orphan.

### Phase 2 — Close the side doors — **pending**
- Reroute `run_javascript` / `run_python` through `createRun`.
- Assert background runs are wrapped (they share the chokepoint).
- **Exit:** canary fails identically through `execute_command`, `run_javascript`, `run_python`, and `background: true`.

### Phase 3 — Setting, signals, Ask escalation — **done**
- [x] Three-state setting, registry entry, reader helper.
- [x] Board/AFK default `require` via autopilot meta.
- [x] Signals: tool-result trailer; UI badge; board-log `sandbox` event.
- [x] Unavailable under `prefer` → Ask strip; under `require` → error.
- [x] Teach the model: short tool-usage note when sandbox is on.
- **Exit:** all three states behave; `require` on unsupported platforms produces a clear, actionable error.

### Phase 4 — Docs and copy — **in progress**
- Privacy / tools / context / Autopilot / board isolation copy: worktrees ≠ host containment; shell carve-out; sandbox as mechanism 5; NOW vs planned setting accuracy.
- Refresh this plan to match locked decisions.
- **Exit:** no surface still implies worktree isolation is host containment.

### Phase 5 — Linux Landlock helper — **code landed**
- [x] `minnow-sandbox` C helper + `build.sh` / `npm run sandbox:build-helper`.
- [x] `landlock.js` argv/env wiring (same wrap shape as Seatbelt); reason codes for helper missing / ABI / apply.
- [x] Linux `extraResources` + docker package path builds helper first; ubuntu CI builds helper before tests.
- [x] Platform-gated canaries (skip-clean when helper or ABI absent).
- **Exit (remaining):** green `ubuntu-latest` canary run with helper+Landlock asserting `cat ~/.minnow/.key` fails; AppImage finds helper at `resources/minnow-sandbox`.

### Phase 6 — Windows via WSL2 (Cursor-shaped) — **code landed**
- [x] When sandbox on: agent one-shot through WSL, then **same** `wrapWithLandlock` / `buildLandlockArgv` / `minnow-sandbox` inside that tree ([`wsl-landlock.js`](../../server/terminal/sandbox/wsl-landlock.js)).
- [x] Probe: WSL present + helper runnable + Landlock ABI usable (`wsl_unavailable` / Landlock reason codes).
- [x] Unavailable leaves the original spawn untouched (no bare-WSL rewrite) → prefer/require paths.
- [x] Document that Windows sandbox **requires WSL2 + Landlock**; native Win remains future work.
- **Exit (remaining):** live Windows canary with WSL2 + Linux ELF asserting `cat` of host `~/.minnow/.key` fails; ship Linux helper in Windows package resources (or document `MINNOW_SANDBOX_HELPER` / WSL PATH setup).

### Later (not v1)
`strict` profile in the UI · network proxy allowlist · per-board override UI · optional PTY sandbox (explicitly rejected for now) · dedicated Minnow WSL distro.

---

## 8. Signals

Three surfaces (Phase 3):

1. **Tool result (the model reads this).** Trailer: `[sandboxed: seatbelt/workspace]`, or on prefer fallback `[NOT sandboxed: …]`. Failures that are sandbox-caused name the path.
2. **UI (the user reads this).** Badge on the agent terminal run card. Unsandboxed-under-`prefer` louder than sandboxed.
3. **Board log.** `sandbox` event via [`appendBoardLogLine`](../../server/orchestrate/board-log-sink.js).

---

## 9. Docs and copy

Phase 4 surfaces (honest description of today's behaviour ships even if later platforms lag):

- [`privacy-and-security.md`](../manual/reference/privacy-and-security.md) — shell carve-out; sandbox as mechanism 5; worktree ≠ host damage containment.
- [`tools-and-permissions.md`](../manual/concepts/tools-and-permissions.md) — `execute_command` Full escapes path boundary unless sandbox on.
- [`context.md`](../context.md) — spawn chokepoint + NOW (`MINNOW_SHELL_SANDBOX=1`) vs planned setting.
- AFK / Autopilot / board isolation copy — git isolation only.
- This plan — aligned to locked Cursor decisions.

---

## 10. Tests

`test/terminal/sandbox/`:

**Pure, run everywhere:** Seatbelt profile generation; argv composition order; (Phase 3) three-state resolution.

**Platform-gated integration:** canary deny (`~/.minnow/.key`, write outside workspace, `~/.ssh`); happy path; worktree precedence; cancellation.

Register in [`test/test-config.mjs`](../../test/test-config.mjs); `--test-force-exit` per existing convention.

---

## 11. Open questions

| # | Question | Answer |
|---|---|---|
| 1 | First ship platform | **macOS** (Phase 1 landed); Linux Phase 5; Windows Phase 6 |
| 2 | Default off, or require for AFK | **Off globally.** AFK/autopilot boards default **`require`** once Phase 3 lands (overridable) |
| 3 | Sandbox unavailable → block or prompt | **Three states** (§6.2): `prefer` → Ask; `require` → error |
| 4 | Interactive PTY in scope | **No, permanently.** |
| 5 | Network deny-all or allowlist | **Neither in v1.** Allow network under `workspace`. |
| 6 | Do git/`gh` operations run inside or outside the sandbox? | **Outside** — first-party argv (§6.3.2) |
| 7 | Ship the Linux helper binary, or require `bwrap`? | **Helper binary** (§4.2 / Phase 5) |
| 8 | Windows containment | **WSL2 + Landlock when available**; else honest unavailable — **not** bare WSL |

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Apple removes `sandbox-exec` | Probe is real execution; adapter reports unavailable; `prefer` degrades via Ask |
| Users turn it off after one breakage | Enumerate breakages; `prefer` never hard-blocks; failures name the path |
| Adds a maintained binary to the build | Confined to Phase 5; macOS ships without it |
| False security claim in copy | Non-goals explicit; Phase 4 fixes overclaims |
| Side doors (`run_*`) bypass sandbox | Phase 2 before claiming Full coverage |
| Sandboxed processes escape cancellation | Phase 1 exit criterion + dedicated test |
| Claiming WSL alone is a sandbox | Phase 6 requires Landlock; docs say so |

---

## 13. Key code hooks

| File | Why |
|---|---|
| [`server/terminal/one-shot-spawn.js`](../../server/terminal/one-shot-spawn.js) | Resolve seam |
| [`server/terminal/sandbox/index.js`](../../server/terminal/sandbox/index.js) | **Chokepoint wrap** (`applyAgentShellSandbox`) |
| [`server/terminal-runner.js`](../../server/terminal-runner.js) | `createRun` / `createBackgroundRun` call sites |
| [`server/runtime/tools-middleware.js`](../../server/runtime/tools-middleware.js) | `execute_command` + Phase 2 `run_*` reroute |
| [`server/terminal/middleware.js`](../../server/terminal/middleware.js) | API `createRun`; `source` discriminates agent vs user |
| [`server/terminal/wsl.js`](../../server/terminal/wsl.js) | WSL rewrite — precedent |
| [`server/terminal/sandbox/wsl-landlock.js`](../../server/terminal/sandbox/wsl-landlock.js) | Phase 6: WSL + Landlock composition / probe |
| [`server/config/tool-security.js`](../../server/config/tool-security.js) | Where `getShellSandboxFromConfig` goes (Phase 3) |
| [`server/settings/registry-manifest.json`](../../server/settings/registry-manifest.json) | Setting shape to copy |
| [`src/tools/permission-gate.ts`](../../src/tools/permission-gate.ts) | Ask escalation (Phase 3) |
| [`server/worktree/paths.js`](../../server/worktree/paths.js) | Worktree slot layout for allow rule |
| [`server/orchestrate/board-log-sink.js`](../../server/orchestrate/board-log-sink.js) | Board-log signal |
| [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml) | Gate matrix — Phase 0 |

---

## 14. Prior art

- <https://cursor.com/blog/agent-sandboxing>
- <https://cursor.com/docs/agent/security/run-modes>
- Chromium macOS sandbox profiles (`sandbox/mac/*.sb`)
- `landlock(7)`, `landlock_create_ruleset(2)` — ABI negotiation and degradation
