---
name: Git Bash terminal
overview: Add Git Bash as a Windows-only shell profile (interactive PTY tabs and agent `execute_command`) when Git for Windows is installed, without colliding with the existing WSL `bash` profile.
todos:
  - [x] `server/terminal/git-bash.js`: detect well-known Git for Windows `bash.exe` (never PATH `bash.exe`), MSYS path helper, PTY/one-shot argv, env patch, test reset
  - [x] Register `git-bash` in `resolveProfiles` (after cmd, only when found). `describeShellProfileRuntime` MUST return runtime `'git-bash'` (do not collapse to native)
  - [x] Merge Git Bash env in PTY spawn; add `git-bash` to `NATIVE_HISTORY_SHELL_IDS`; widen client `ShellProfile.runtime`
  - [x] Route Windows one-shot strings through `bash.exe --login -c`; merge spawn env in `createRun` / `createBackgroundRun`; skip unix-pipe guard; do not dollar-escape
  - [x] Skip WSL-Landlock rewrite for git-bash one-shots (`applied: false`, no Ask)
  - [x] Ungate Default shell Settings when `profiles.length > 1`; update copy, agent Windows-shell prompts, `context.md`, manual, setup-from-source, privacy sandbox note
  - [x] Tests + typecheck; verify picker + a Git Bash tab + agent command on Windows
isProject: true
---

# Add Git Bash as a Windows terminal shell

**Reviewed:** 2026-09-06 against current `main`. Feature is **not implemented**. Core catalog / one-shot / Settings assumptions still match; this pass locks sandbox skip and `describeShellProfileRuntime` pass-through.

Cursor copy: `c:\Users\dukky\.cursor\plans\git_bash_terminal_0b9840e5.plan.md`.

## Agreed context

- **Goal:** Git Bash is a first-class shell next to PowerShell, Command Prompt, and WSL.
- **Surfaces:** Interactive PTY tabs **and** agent `execute_command` when Git Bash is the default or workspace shell. Dev-server `createBackgroundRun` uses the same `resolveExecuteShellProfile`, so it follows automatically.
- **Availability:** List it only when Git for Windows is actually installed (same pattern as WSL distros).
- **Non-goals:** Custom `bash.exe` path in Settings; making Git Bash the OS default; renaming the existing Windows `bash` id (that is WSL Bash). Native Win sandbox for Git Bash.

## How shells work today (still accurate)

Windows profiles are built in [`server/terminal/shell-profiles.js`](../../server/terminal/shell-profiles.js): PowerShell, `cmd`, then WSL distros, plus a legacy id **`bash` that is WSL Bash** (`wsl.exe`), not Git Bash.

Agent one-shots only follow the picker for **WSL**. Every other Windows profile still runs through `cmd.exe` in [`server/terminal/one-shot-spawn.js`](../../server/terminal/one-shot-spawn.js).

`describeShellProfileRuntime` maps anything that is not `wsl` to `native`. If Git Bash is registered as `runtime: 'git-bash'` but this helper collapses it, one-shots stay on `cmd.exe`. **Pass `'git-bash'` through.**

Settings **Default shell** is still gated on WSL ([`src/ui/settings-sections.ts`](../../src/ui/settings-sections.ts) `wslProfiles.length > 0`). A Git-Bash-only machine cannot set the default or a workspace override from Settings. The **terminal panel dropdown already lists every profile** and persists `defaultShellProfileId` on change ([`src/ui/terminal-tabs.ts`](../../src/ui/terminal-tabs.ts)), so Git Bash would appear there as soon as the catalog includes it.

**Sandbox (MIN-553):** `createRun` / `createBackgroundRun` always do `resolveOneShotSpawn` → [`applyAgentShellSandbox`](../../server/terminal/sandbox/index.js) → spawn. On Windows, when Prefer is on and WSL2+Landlock is available, **every** agent one-shot (including PowerShell/cmd) is rewritten into WSL. A Git Bash `bash.exe --login -c` spawn would be stuffed into `wsl.exe -- <windows-bash-path> ...`, which is wrong. Interactive PTYs stay unsandboxed.

## Locked decisions

- **Profile id:** `git-bash`. Never reuse `bash` (WSL alias on Windows). [`isWslProfileId`](../../server/terminal/wsl.js) stays WSL-only (`bash` / `wsl:*`).
- **Executable:** `...\Git\bin\bash.exe` with `--login -i` (PTY) / `--login -c` (one-shot). Never `git-bash.exe` (mintty, own window, breaks node-pty). Prefer `bin\bash.exe` over `usr\bin\bash.exe`.
- **Do not resolve `bash.exe` from PATH.** `System32\bash.exe` is the WSL launcher.
- **Detection (sync `existsSync`, no spawn on the request path):** first hit among `ProgramFiles\Git\bin\bash.exe`, `ProgramFiles(x86)\Git\bin\bash.exe`, `%LOCALAPPDATA%\Programs\Git\bin\bash.exe`, `%USERPROFILE%\scoop\apps\git\current\bin\bash.exe`, then `git.exe` on PATH whose sibling `..\bin\bash.exe` exists (covers PortableGit; skip if that sibling is missing). Cache the resolved path; tests inject a fixture path (`gitBashPath: null` forces omit).
- **Default stays PowerShell.** Git Bash is opt-in via the terminal dropdown, Settings, or a per-workspace override.
- **Runtime:** `'git-bash'` on the profile **and** from `describeShellProfileRuntime` (alongside `'native' | 'wsl'`). Do not collapse to `'native'`.
- **PTY cwd:** Windows path (same as native). Not `wsl --cd`, not `/c/foo` as Node `cwd`.
- **MSYS env (PTY and one-shot):** `CHERE_INVOKING=1` (login shell keeps workspace cwd), `MSYSTEM=MINGW64`, `MSYS=enable_pcon` (ConPTY), `MSYS2_PATH_TYPE=inherit` (Windows `node`/`npm` still resolve).
- **One-shot strings only** go through Git Bash; argv spawn stays a direct Windows exec (same as native). Existing `node -e` / `python -c` rewrite still runs first for all runtimes; do not special-case Git Bash.
- **No WSL dollar-escape.** `bash.exe` is spawned with `shell: false`; host cmd does not parse `$`.
- **Unix pipe guard:** skip when runtime is `git-bash`, same as WSL.
- **Sandbox:** Do not run `composeWslLandlockWrap` on git-bash spawns. Pass profile runtime into `applyAgentShellSandbox`. Return `applied: false` with a distinct reason; **do not** set `needsEscalation` / `blocked` (silent unsandboxed). Prefer+Ask on every Git Bash command would make the profile unusable; rewriting into WSL would discard it. Document. Interactive PTYs remain unsandboxed.
- **Settings:** show Default shell + workspace override whenever `shellProfiles.length > 1`. Always true on Windows (PowerShell + cmd); also ungates macOS (zsh + bash), which is an intended fix. Copy must mention Git Bash and WSL.
- **Agent prompts:** Qualify the Windows unix-pipe lines in [`tool-usage/default.full.md`](../../src/chat/prompts/tool-usage/default.full.md) and [`shell.full.md`](../../src/agents/prompts/sub-agents/shell.full.md): cmd/PowerShell keep the rule; WSL and Git Bash may use POSIX pipes and tools.

## Implementation

### 1. Detect + spawn helpers

New [`server/terminal/git-bash.js`](../../server/terminal/git-bash.js), mirrored on [`server/terminal/wsl.js`](../../server/terminal/wsl.js):

- `GIT_BASH_PROFILE_ID = 'git-bash'`
- `detectGitBashPath(options?)` → absolute path or `null`
- `windowsPathToMsysPath` (`C:\foo` → `/c/foo`) for tests/cwd helpers only
- `buildGitBashInteractiveArgs()` → `['--login', '-i']`
- `buildGitBashOneShotSpawn({ command, cwd, bashPath })` → `{ command: bashPath, args: ['--login', '-c', command], shell: false, cwd, env: gitBashSpawnEnvPatch() }`
- `gitBashSpawnEnvPatch()` → the four MSYS keys above
- `resetGitBashCacheForTests()`

Wire into [`resolveProfiles`](../../server/terminal/shell-profiles.js) after `cmd`. Fixture option `gitBashPath`.

[`describeShellProfileRuntime`](../../server/terminal/shell-profiles.js) return type becomes `{ runtime: 'native' | 'wsl' | 'git-bash', distro: string | null }`.

[`resolvePtySpawnForProfile`](../../server/terminal/shell-profiles.js): WSL branch unchanged. `git-bash` falls through to `{ shell: profile.shell, args: profile.args, cwd }`.

[`getShellProfileById('git-bash')`](../../server/terminal/shell-profiles.js) returns null when Git is not installed so a stale `defaultShellProfileId` falls back to PowerShell via [`resolveShellProfileId`](../../server/terminal/shell-config.js). Do not synthesize a fake profile the way `wsl:` prefix does.

No `warmupTerminalPlatformCaches` change: detection is `existsSync`, not a spawn.

### 2. PTY env

[`buildPtySpawnEnv`](../../server/terminal/pty-env.js) optional `gitBash: true`, **or** merge the patch in [`createPtySession`](../../server/terminal/pty-host.js) when `profile.runtime === 'git-bash'`. Add `'git-bash'` to `NATIVE_HISTORY_SHELL_IDS` in [`src/ui/terminal-history-nav.ts`](../../src/ui/terminal-history-nav.ts). Widen client [`ShellProfile.runtime`](../../src/api/terminal-pty.ts).

### 3. Agent `execute_command`

In [`resolveOneShotSpawn`](../../server/terminal/one-shot-spawn.js), after the WSL branch and before `cmd.exe`, route git-bash one-shot strings through `buildGitBashOneShotSpawn`. [`createRun`](../../server/terminal-runner.js) / [`createBackgroundRun`](../../server/terminal-runner.js) currently drop `spawnTarget.env`; merge `{ ...process.env, ...spawnTarget.env, ...envOverrides }`. Widen the Unix-pipe skip in [`toolExecuteCommand`](../../server/runtime/tools-middleware.js).

### 4. Sandbox skip

[`applyAgentShellSandbox`](../../server/terminal/sandbox/index.js) must see the profile runtime. When `runtime === 'git-bash'`, skip `wrapSandbox` / `composeWslLandlockWrap`. Do not rely on [`recoverCommandFromWinSpawn`](../../server/terminal/sandbox/wsl-landlock.js) (it only unwraps `cmd.exe` / `wsl.exe`).

### 5. Settings + docs + prompts

Ungate Default shell / workspace shell in [`appendTerminalControls`](../../src/ui/settings-sections.ts) when `shellProfiles.length > 1`.

- [`documentation/manual/apps/code.md`](../manual/apps/code.md) Terminal section
- [`documentation/context.md`](../context.md) terminal panel paragraph
- [`documentation/contributor/setup-from-source.md`](../contributor/setup-from-source.md) WSL bullet
- [`documentation/manual/reference/privacy-and-security.md`](../manual/reference/privacy-and-security.md) — Git Bash agent commands are not WSL-Landlock wrapped
- Agent prompts as above

### 6. Tests

- `test/terminal/git-bash.test.mjs` — path mapping, detection fixtures, skip `System32\bash.exe`, skip PATH `bash.exe`, spawn argv, env patch, no dollar-escape
- `test/terminal/shell-profiles.test.mjs` — present/absent; no collision with WSL `bash`; runtime pass-through; PTY spawn is `bash.exe` not `wsl.exe`
- `test/server/one-shot-spawn.test.mjs` — Git Bash wraps `-c`; PowerShell/cmd still `cmd.exe`; WSL unchanged
- `test/terminal/pty-env.test.mjs` — MSYS keys when git-bash
- `test/ui/terminal-history-nav.test.mts` — `usesShellNativeHistory('git-bash')`
- Sandbox suite — git-bash not rewritten to `wsl.exe`

## Verification

- `npx tsc --noEmit` and the scoped terminal suites above.
- On a Windows machine with Git for Windows: dropdown lists **Git Bash**; new tab is a login bash in the workspace cwd; `echo $MSYSTEM` / `pwd` look right; default shell makes `execute_command` run `ls` / `echo $SHELL` through bash, not cmd.
- Settings → General → Chat & terminal shows the picker without WSL; selecting Git Bash persists.
- With Agent shell sandbox Prefer: a Git Bash `execute_command` still runs in Git Bash (not WSL) and is not blocked by the Ask strip.
