# MIN-553 — Agent shell sandbox / host containment

**Linear:** [MIN-553](https://linear.app/minnowai/issue/MIN-553/agent-shell-sandbox-host-containment-not-just-worktrees)
**Status:** Backlog — spike complete on paper (this doc), no code written
**Related:** MIN-275 worktree isolation (complementary, different problem)

---

## 1. The gap this closes

Today Minnow contains agents four ways ([`privacy-and-security.md`](../manual/reference/privacy-and-security.md)): the workspace path boundary, tool permissions, mode allowlists, and untrusted-content fencing. Three of those four stop at the shell.

`execute_command` runs an arbitrary string through `cmd.exe /c` or `$SHELL -l -c`. Once the model is inside that string, the workspace boundary is gone — it only ever guarded *file tools*, which resolve paths in JS before touching disk. A shell command has the full authority of the Minnow process.

Concretely, on today's build with `execute_command` on **Full**:

| Command | Blocked by | Result |
|---|---|---|
| `cat ~/.minnow/.key` | nothing | **secret-box master key exfiltrated to the model** |
| `cat ~/.minnow/config.json` | nothing | provider API keys, mail config |
| `cat ~/.ssh/id_ed25519`, `~/.aws/credentials`, `~/.config/gh/hosts.yml` | nothing | host credentials |
| `rm -rf ~/Documents/other-project` | nothing | data loss outside the workspace |
| `cd ~/other-repo && git reset --hard` | `cwd-guard` only when a worktree is active *and* the string starts with `cd` | usually nothing |
| `kill <minnow pid>` | `assessHostKillCommand` | blocked |
| `node -e "require('fs').readFileSync(...)"` via `run_javascript` | nothing | same as above, different tool |

The worktree work (MIN-275/276) fixed *agents colliding with each other*. It did nothing about *an agent reaching the rest of the host*. Those get conflated in conversation and in the AFK board copy, which is itself a bug worth fixing (§9).

**`~/.minnow/.key` is the single highest-value target on the machine and it is currently one `cat` away.** That, not `rm -rf`, is the reason to do this ticket.

---

## 2. Threat model

**In scope — a model that is wrong or steered wrong.** Prompt injection from a fetched page, a poisoned dependency's postinstall, a hallucinated destructive command, an AFK board running unattended for six hours. The agent is not *trying* to escape; it is doing what some text told it to do.

**Out of scope — a determined attacker with code execution who is trying to escape.** Seatbelt and Landlock both have known bypass classes. If a native binary inside the sandbox is deliberately hunting for a kernel LPE, it wins. We do not claim otherwise, in the product copy or anywhere else.

**Explicit non-goals for this ticket:**

- Sandboxing the **user's** interactive PTY tabs. The user is trusted; sandboxing their terminal would be user-hostile and is a different feature.
- Sandboxing MCP stdio servers, LSP servers, `ripgrep`, `git`, or the model runtime. Those are user-installed software with a different trust story, and each has its own breakage surface. Later ticket if ever.
- Network egress filtering by host. See §6.4 — this genuinely requires a proxy and does not belong in v1.
- Any container runtime. Confirmed: **no Docker, Podman, or OCI.**

**Success criterion for v1:** with the sandbox on, an agent shell command cannot read `~/.minnow/.key` and cannot write outside its workspace/worktree, on at least one shipped platform, and the failure is legible to both the user and the model.

---

## 3. Code audit — where processes actually spawn

The original stub said "wrap the agent `execute_command` spawn path only." That undercounts the surface. Actual spawn paths that carry agent-authored strings:

| Path | Entry | Reaches | Sandbox in v1? |
|---|---|---|---|
| `execute_command` foreground | [`tools-middleware.js:1004`](../../server/runtime/tools-middleware.js#L1004) → `executeCommandBlocking` → `createRun` | `resolveOneShotSpawn` → `runProcess` | **Yes** |
| `execute_command` background | [`tools-middleware.js:928`](../../server/runtime/tools-middleware.js#L928) → `createBackgroundRun` | `resolveOneShotSpawn` → `spawn` | **Yes** |
| `run_javascript` | [`tools-middleware.js:1057`](../../server/runtime/tools-middleware.js#L1057) | **`runProcess('node', ['-e', code])` directly** | **Yes — needs rerouting first** |
| `run_python` | [`tools-middleware.js:1075`](../../server/runtime/tools-middleware.js#L1075) | **`runProcess(bin, ['-c', code])` directly** | **Yes — needs rerouting first** |
| `POST /api/terminal/run`, `source: 'agent'` | [`terminal/middleware.js:109`](../../server/terminal/middleware.js#L109) | `createRun` | **Yes** (same chokepoint) |
| `POST /api/terminal/run`, `source: 'user'` | same | `createRun` | **No** — user PTY, out of scope |
| `manage_dev_servers` | [`dev-server/manager.js:540,729`](../../server/dev-server/manager.js#L540) | `createBackgroundRun` | **No in v1** — needs to bind ports and serve; see §6.5 |
| `models/serve.js` llama.cpp | [`models/serve.js:533`](../../server/models/serve.js#L533) | `createBackgroundRun` | **No** — user-installed runtime |

### 3.1 The chokepoint

[`resolveOneShotSpawn`](../../server/terminal/one-shot-spawn.js#L54) is the right seam and it is already the right shape. It takes `{command, args, shell, platform, shellProfile, cwd}` and returns `{command, args, shell, cwd?}` — an argv rewrite. Both `createRun` ([`terminal-runner.js:250`](../../server/terminal-runner.js#L250)) and `createBackgroundRun` ([`terminal-runner.js:371`](../../server/terminal-runner.js#L371)) funnel through it, and it is where the existing WSL rewrite already lives.

A sandbox is exactly the same kind of transform: `["/bin/zsh","-l","-c","npm test"]` becomes `["/usr/bin/sandbox-exec","-f","/tmp/p.sb","/bin/zsh","-l","-c","npm test"]`.

**Design consequence:** the adapter is an argv wrapper composed *after* the shell/WSL resolution, not a replacement for it. Order is `resolveOneShotSpawn` → `wrapSandbox`. This keeps WSL routing, login-shell selection, and sandboxing orthogonal instead of tangled.

`resolveOneShotSpawn` is pure and already unit-tested in [`test/terminal/`](../../test/terminal/) — the wrapper is testable on every platform via the `platform` injection parameter, even where the sandbox cannot actually run.

`run_python` / `run_javascript` must be rerouted through `resolveOneShotSpawn`/`createRun` (Phase 2) or they are a silent hole that makes the whole feature a lie. They are two-line handlers; the reroute is small but must not be skipped.

---

## 4. Corrections to the "locked" decision

The mechanism table in the stub is right for macOS and Linux and **wrong for Windows**.

### 4.1 WSL2 is not a sandbox

> | Windows | Linux sandbox via WSL2 |

A default WSL2 distro mounts every host drive read-write at `/mnt/c`, and `/mnt/c/Windows/System32` binaries are executable through binfmt interop. `wsl.exe -- bash -c 'cat /mnt/c/Users/dukky/.minnow/.key'` succeeds. Routing agent commands through the existing [`buildWslOneShotSpawn`](../../server/terminal/wsl.js#L180) buys **zero** containment on its own.

Making WSL2 into containment requires one of:

- **(a) A dedicated Minnow distro** with `[automount] enabled=false` and `[interop] enabled=false` in its `/etc/wsl.conf`, and the workspace bind-mounted in explicitly. Real containment, but it means provisioning a distro (~500 MB import), the workspace lives across the 9p filesystem boundary (slow — a known WSL2 pain point for `node_modules`), and it is a large install-time surprise.
- **(b) Landlock inside the user's existing distro.** Free if it works, but Landlock must be in the WSL2 kernel's active LSM list. Microsoft's WSL2 kernel config is not guaranteed to enable it, and enabling it requires a `kernelCommandLine=lsm=...landlock` entry in `%UserProfile%\.wslconfig` plus `wsl --shutdown`. Not something to do silently to a user's machine.

**Recommendation:** Windows ships **unsandboxed and honestly labelled** in v1. Option (a) becomes its own ticket if there is demand. Pretending WSL2 alone is containment would be the worst outcome of this ticket.

### 4.2 Landlock cannot be applied from Node

> | Linux | Landlock + seccomp |

Correct primitive, but note the delivery problem before committing to Linux-first. Landlock and seccomp are applied by the *child* process to *itself*, between `fork()` and `execve()`. Node's `child_process.spawn` exposes no pre-exec hook. There is no maintained npm binding. Options:

| Approach | Cost | Verdict |
|---|---|---|
| Native N-API addon | Prebuilds per arch, node-gyp in the packaging path | Heaviest; repo already carries `better-sqlite3` and `@lydell/node-pty` so it is *possible*, but this is new build surface for one feature |
| `bwrap` (bubblewrap) if installed | Zero build cost | Not present by default on many distros; Ubuntu 24.04's AppArmor `unprivileged_userns` restriction breaks it for unconfined binaries; AppImage users are exactly the affected group |
| **Small static helper binary** (`minnow-sandbox`, Rust or C, musl-static) | ~200 lines, one CI cross-build job, ships via `build.extraResources` | **Recommended.** No runtime deps, no gyp, one artifact per arch, `execve`s the real command after applying the ruleset |

Also: Landlock ABI matters. ABI 1 (kernel 5.13) is filesystem-only; ABI 4 (6.7) adds TCP bind/connect. The helper must negotiate `landlock_create_ruleset(NULL, 0, LANDLOCK_CREATE_RULESET_VERSION)` and degrade, not fail, on older kernels — and report which ABI it got so the UI signal is honest.

### 4.3 macOS Seatbelt is the cheapest real win

`sandbox-exec` is present on every macOS, needs no entitlement, no install, no helper binary, and works with a hardened-runtime signed parent. It has been formally deprecated since 10.14 and is still what Chrome and several agent CLIs use in 2026. Deprecation risk is real but slow-moving; if Apple removes it, the adapter reports unavailable and the three-state setting (§6.2) already handles that path.

---

## 5. Recommended platform order

**Ship macOS first. Linux second. Windows documented-unsandboxed.**

Rationale: macOS is the only platform where v1 is *purely* a policy-file + argv-wrapper change — no new binary, no new build job, no packaging change. That gets the adapter interface, the settings surface, the signals, and the docs correct against a working implementation at the lowest possible cost. Linux then reuses all of that and only has to solve the helper-binary problem.

**The cost of this order, stated plainly:** the dev machine is Windows and [`ci.yml`](../../.github/workflows/ci.yml#L61) currently gates on `[windows-latest, ubuntu-latest]` only. Shipping macOS-first means shipping something neither manually nor automatically tested.

**That is a blocker, and Phase 0 resolves it:** add `macos-latest` to the gate matrix. GitHub-hosted macOS runners are free for public repos, and the sandbox suite is fast. Without this the recommendation flips to Linux-first and the helper binary moves to Phase 1 — a materially bigger and slower Phase 1.

Decision to confirm before Phase 1 starts: **is adding `macos-latest` to the CI matrix acceptable?** If yes → macOS first. If no → Linux first, and accept the helper-binary cost up front.

---

## 6. Design

### 6.1 Adapter interface

New module `server/terminal/sandbox/`:

```
sandbox/index.js        resolveSandbox() -> adapter | null; capability probe + cache
sandbox/policy.js       buildPolicy({ workspaceRoot, worktreeRoot, profile }) -> Policy
sandbox/seatbelt.js     macOS: policy -> .sb text; argv wrapper
sandbox/landlock.js     Linux: policy -> helper argv/env
sandbox/unavailable.js  reason codes for the honest-signal path
```

```js
/**
 * @typedef {object} SandboxAdapter
 * @property {'seatbelt'|'landlock'|'none'} kind
 * @property {() => Promise<{ ok: boolean, reason?: string, detail?: string }>} probe
 * @property {(spawnTarget, policy) => { command, args, shell, cwd?, env? }} wrap
 */
```

`wrap` takes the *already-resolved* `resolveOneShotSpawn` output. Pure function, unit-testable with a fake platform.

Probe results cache per-boot. Probe is a real execution (`sandbox-exec -p '(version 1)(allow default)' /usr/bin/true`), not a version sniff — a version sniff will eventually be wrong and fail open.

### 6.2 Setting: three states, not a boolean

`toolSecurity.shellSandbox` in `config.json`, sitting next to the existing `toolSecurity.filesystemAccess`:

| Value | Behaviour |
|---|---|
| `off` | Today's behaviour. **v1 default.** |
| `prefer` | Sandbox where available; run unsandboxed elsewhere with a visible signal on every call |
| `require` | Fail-closed. Sandbox unavailable → the tool call errors and says why. |

A boolean cannot express "I want this on my Mac but I still need my Windows box to work," which is exactly this project's situation. `prefer` is the setting a real user wants; `require` is what an AFK board should default to.

Registry entry in [`registry-manifest.json`](../../server/settings/registry-manifest.json) under `category: general`, `area: general`, `path: toolSecurity.shellSandbox`, `sensitivity: dangerous`, mirroring the shape of the existing `general.filesystem` entry (~line 273). Reader helper next to [`getFilesystemAccessFromConfig`](../../server/config/tool-security.js).

### 6.3 Policy profiles

Two named profiles, not a freeform rule editor.

**`workspace` (default when sandbox is on)**

- **Write:** workspace root or active worktree; `$TMPDIR`; package caches (`~/.npm`, `~/.cache`, `~/.cargo`, `~/.rustup`, `~/Library/Caches`, `~/.m2`, `~/.gradle`); `~/.minnow/logs/terminal`.
- **Read:** system paths, the home directory, `~/.gitconfig` — **minus an explicit credential denylist.**
- **Deny read (the point of the whole ticket):** `~/.minnow` except the worktree slot and terminal logs; `~/.ssh`; `~/.aws`; `~/.config/gh`; `~/.config/gcloud`; `~/.docker/config.json`; `~/.npmrc`; `~/.pypirc`; browser profile dirs.
- **Network:** allowed.

**`strict`** — as above but write is workspace + temp only (no package caches) and network is denied. For untrusted exploration and, once proven, AFK boards.

Two hard-won details, both of which will otherwise show up as bug reports:

1. **`~/.minnow` must be denied but the worktree lives inside it.** Board worktrees resolve to `~/.minnow/worktrees/<repo-key>/<board>/<slot>` ([`worktree/paths.js`](../../server/worktree/paths.js)). The deny rule is on `~/.minnow` with a narrower allow re-added for the active slot and `~/.minnow/logs/terminal`. Get the precedence wrong and either every board task breaks or the key stays readable. **Both directions need a test.**
2. **Denying `~/.config/gh` breaks `gh`.** Source Control Center shells out to the user's `gh` CLI for PRs and CI. Under `workspace`, PR operations will fail with an auth error. Either accept it and document it, or route git/`gh` operations outside the sandbox as trusted first-party callers (they do not carry model-authored argv). **Recommend the latter** — it is both safer and less annoying — but it is a real design decision, not a detail.

### 6.4 Network: allow in v1, and say so

Neither primitive can do what people assume. Seatbelt denies network wholesale (`(deny network*)`); Landlock's network support arrives at ABI 4 and covers **TCP bind/connect port numbers only — no hostnames**. A "curated package-manager allowlist" is therefore not implementable in either primitive; it requires a filtering proxy plus `HTTP(S)_PROXY` injection plus a CA the child trusts. That is its own epic.

Deny-all is implementable but breaks `npm install`, `pip install`, `cargo build`, and `git fetch` — i.e. most of what an agent shell is for.

**v1 = filesystem containment only, network unrestricted, documented as such.** `strict` gets deny-all for the cases where that is genuinely what you want. Open question #5 is answered.

### 6.5 What the sandbox must not break

Enumerated up front because each is a plausible "sandbox is broken, turning it off" report:

- `manage_dev_servers` needs to bind ports and serve the workspace → **excluded from sandboxing in v1** (§3).
- `git push` over SSH needs `~/.ssh` → denied under `workspace`. Mitigated by routing git tools outside the sandbox (§6.3.2).
- `npm install` needs `~/.npm` and network → both allowed under `workspace`.
- Login shells (`zsh -l`) read `/etc/zprofile`, `~/.zprofile`, Homebrew shellenv → all read-allowed.
- The board-task port env from [`board-task-ports.js`](../../server/workspace/board-task-ports.js) is passed via `env`, untouched by the wrapper.
- `killProcessTree` must still reach the grandchildren under `sandbox-exec`. Verify: `sandbox-exec` `exec`s rather than forking on macOS, so the pid stays the shell's — but **verify empirically in Phase 1**, because a sandbox that cannot be cancelled is worse than no sandbox.

---

## 7. Phasing

Each phase is independently shippable and independently revertible.

### Phase 0 — CI + decision (½ day)
- Add `macos-latest` to the [`ci.yml`](../../.github/workflows/ci.yml#L61) gate matrix; confirm the suite is green there.
- Confirm the platform-order decision from §5.
- **Exit:** three-OS CI green, platform order locked.

### Phase 1 — Adapter + macOS Seatbelt, dev-flag only (2–3 days)
- `server/terminal/sandbox/` per §6.1; `MINNOW_SHELL_SANDBOX=1` env flag only, no UI.
- `resolveOneShotSpawn` composition; `workspace` profile.
- **Exit:** `MINNOW_SHELL_SANDBOX=1` + `cat ~/.minnow/.key` fails; `npm test` in the workspace passes; a cancelled run leaves no orphan process.

### Phase 2 — Close the side doors (½ day)
- Reroute `run_javascript` / `run_python` through `createRun`.
- Confirm background runs are wrapped (they share the chokepoint, but assert it).
- **Exit:** the canary command fails identically through `execute_command`, `run_javascript`, `run_python`, and `background: true`.

### Phase 3 — Setting + signals (1–2 days)
- Three-state setting, registry entry, reader helper.
- Signals per §8.
- **Exit:** all three states behave per §6.2; `require` on Windows produces a clear, actionable error.

### Phase 4 — Docs and copy (½ day)
- Per §9.
- **Exit:** no surface still implies worktree isolation is host containment.

### Phase 5 — Linux (3–5 days)
- `minnow-sandbox` static helper; CI cross-build; `extraResources` packaging; ABI negotiation and degradation.
- **Exit:** same canary suite green on `ubuntu-latest`; AppImage ships and finds the helper.

### Phase 6 — Later, unscheduled
`strict` profile in the UI · AFK-board recommend-on · per-board override · Windows dedicated-distro mode · network proxy · sandboxing MCP stdio servers.

---

## 8. Signals

Three surfaces, because three different readers need to know.

1. **Tool result (the model reads this).** Append a trailer to sandboxed output: `[sandboxed: seatbelt/workspace]`, or on the `prefer` fallback `[NOT sandboxed: seatbelt unavailable — sandbox-exec missing]`. Without this the model sees a bare permission error and burns three turns inventing workarounds. When a command fails *because of* the sandbox, say so and name the path — that is the difference between a useful failure and a confusing one.
2. **UI (the user reads this).** A badge on the terminal run card, matching the existing tool-call chip treatment. Unsandboxed-under-`prefer` should be visually louder than sandboxed — the fallback is the state worth noticing.
3. **Board log (the postmortem reads this).** A `sandbox` event through [`appendBoardLogLine`](../../server/orchestrate/board-log-sink.js#L71), same shape as the existing `cwd_redirect` event ([`tools-middleware.js:862`](../../server/runtime/tools-middleware.js#L862)).

---

## 9. Docs and copy

The conflation of worktree isolation with host containment is currently load-bearing in the product copy, and it is the reason this ticket keeps getting deprioritised.

- [`privacy-and-security.md`](../manual/reference/privacy-and-security.md) — §"Containing agents" says the workspace boundary is "the main containment in the product" without noting it does not apply to the shell. Add the shell carve-out explicitly, then add the sandbox as mechanism 5 once it ships. Line 62's "prefer worktree isolation … so damage is contained to a branch" is the exact sentence to fix: a worktree contains *git* damage, not filesystem damage.
- [`tools-and-permissions.md`](../manual/concepts/tools-and-permissions.md) — note that `execute_command` on **Full** is qualitatively different from every other Full tool, because it is the one that escapes the path boundary.
- [`context.md`](../context.md) — the spawn-chokepoint architecture, once it exists.
- AFK board setup copy — wherever isolation mode is chosen, say what it does and does not protect.

Do the copy fixes in Phase 4 regardless of how far the code gets. **The honest description of today's behaviour is worth shipping even if the sandbox never does.**

---

## 10. Tests

`test/terminal/sandbox/`:

**Pure, run everywhere** (via the `platform` injection parameter):
- Seatbelt profile generation: workspace/worktree/temp allow rules; `~/.minnow` deny with the worktree re-allow; credential denylist.
- Argv composition order: sandbox wraps *after* WSL and login-shell resolution, never before.
- Three-state resolution: `off`/`prefer`/`require` × available/unavailable → six outcomes.

**Platform-gated integration** (skip with a reason, never silently):
- **Canary (must fail):** read `~/.minnow/.key`; write to `~/Documents/canary`; read `~/.ssh`.
- **Happy path (must pass):** write in workspace; `git status`; `node -e` in workspace; write to `$TMPDIR`; `npm --version`.
- **Worktree:** write inside `~/.minnow/worktrees/<slot>` passes while `~/.minnow/config.json` read fails — the §6.3.1 precedence case, both directions.
- **Cancellation:** `stopActiveRun` on a sandboxed sleep leaves no orphan.

Register in [`test/test-config.mjs`](../../test/test-config.mjs); `--test-force-exit` per the existing convention.

---

## 11. Open questions

| # | Question | Answer |
|---|---|---|
| 1 | First ship platform | **macOS**, conditional on adding `macos-latest` to CI (§5). Otherwise Linux. |
| 2 | Default off, or recommend on for AFK | **Off in v1.** Revisit AFK-recommend after Phase 5, once there is real breakage data. |
| 3 | Sandbox unavailable → block or prompt | **Neither — three states** (§6.2). The question presupposed a boolean. |
| 4 | Interactive PTY in scope | **No, permanently.** Out of scope §2. |
| 5 | Network deny-all or allowlist | **Neither in v1.** Allowlists need a proxy; deny-all breaks package managers (§6.4). |
| 6 | *(new)* Do git/`gh` operations run inside or outside the sandbox? | Leaning **outside** — first-party argv, and `~/.config/gh` denial otherwise breaks PRs (§6.3.2). Decide in Phase 1. |
| 7 | *(new)* Ship the Linux helper binary, or require `bwrap`? | Leaning **helper binary** (§4.2). Decide in Phase 5. |

---

## 12. Risks

| Risk | Mitigation |
|---|---|
| Apple removes `sandbox-exec` | Probe is a real execution; adapter reports unavailable; `prefer` degrades cleanly |
| Users turn it off after one breakage | §6.5 enumerates the breakages up front; `prefer` never hard-blocks; failures name the path |
| Adds a maintained binary to the build | Confined to Phase 5; macOS ships without it |
| False security claim in copy | §2 non-goals are explicit; §9 fixes the existing overclaim first |
| Sandboxed processes escape cancellation | Explicit Phase 1 exit criterion and a dedicated test |

---

## 13. Key code hooks

| File | Why |
|---|---|
| [`server/terminal/one-shot-spawn.js:54`](../../server/terminal/one-shot-spawn.js#L54) | **The chokepoint.** Wrap composes here. |
| [`server/terminal-runner.js:250,371`](../../server/terminal-runner.js#L250) | `createRun` / `createBackgroundRun` call sites |
| [`server/runtime/tools-middleware.js:885`](../../server/runtime/tools-middleware.js#L885) | `toolExecuteCommand`; existing guards at 896–903 |
| [`server/runtime/tools-middleware.js:1057,1075`](../../server/runtime/tools-middleware.js#L1057) | `run_javascript` / `run_python` — bypass the chokepoint today |
| [`server/terminal/middleware.js:109`](../../server/terminal/middleware.js#L109) | API `createRun`; `source` discriminates agent vs user |
| [`server/terminal/wsl.js:180`](../../server/terminal/wsl.js#L180) | WSL rewrite — the existing precedent for argv transforms |
| [`server/config/tool-security.js`](../../server/config/tool-security.js) | Where `getShellSandboxFromConfig` goes |
| [`server/settings/registry-manifest.json`](../../server/settings/registry-manifest.json) | `general.filesystem` (~273) is the shape to copy |
| [`server/worktree/paths.js`](../../server/worktree/paths.js) | Worktree slot layout for the §6.3.1 allow rule |
| [`server/orchestrate/board-log-sink.js:71`](../../server/orchestrate/board-log-sink.js#L71) | Board-log signal |
| [`.github/workflows/ci.yml:61`](../../.github/workflows/ci.yml#L61) | Gate matrix — Phase 0 |

---

## 14. Prior art

- <https://cursor.com/blog/agent-sandboxing>
- <https://cursor.com/docs/agent/security/run-modes>
- Chromium macOS sandbox profiles (`sandbox/mac/*.sb`) — the reference for a Seatbelt profile that still lets a login shell work
- `landlock(7)`, `landlock_create_ruleset(2)` — ABI negotiation and degradation
