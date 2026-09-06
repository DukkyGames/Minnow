# Fix execute_command quote mangling on Windows (cmd.exe /d /s /c + libuv quoting)

**Status:** Proposed
**Area:** Terminal / execute_command
**Reporter:** Minnow agent (self-reported from real failure)
**Related:** `server/terminal/one-shot-spawn.js`, `server/process-runner.js`

## Symptom

`execute_command` on Windows silently corrupts command strings that contain **double-quoted arguments**. Observed failures (2026-09-06, Win32, default shell profile `powershell`, one-shot strings):

| Command | Result |
|---|---|
| `gh release create v0.1.1 --repo HenriGrimm/Minnow --title "v0.1.1 - Open Beta" --draft ...` | exit 1, `no matches found for \`-\`` (gh got `--title v0.1.1`, then standalone `-`, `Open`, `Beta` tokens) |
| `git log v0.1.0..HEAD --pretty=format:"%h %ad %s" --date=short` | exit 128, `fatal: ambiguous argument '%ad'` (quotes eaten → `%ad` became a separate argv) |
| `powershell -NoProfile -Command "Write-Output 'ps works'"` | exit 0, printed `Write-Output 'ps works'` (PowerShell treated the command as a quoted string expression and echoed it instead of running it) |

Single-quoted args under cmd (`gh api ... --jq '.commits | reverse | ...'`) also break, but that is expected cmd behavior (single quotes are not quotes to cmd; the `|` pipes are live) — not part of this bug, though worth a guard.

## Root cause

One-shot `execute_command` strings on Windows run through:

1. `resolveOneShotSpawn` (`server/terminal/one-shot-spawn.js:150`) — native/win32 profile → `{ command: 'cmd.exe', args: ['/d', '/s', '/c', command], shell: false }`.
2. `runProcess` (`server/process-runner.js:34`) — `spawn('cmd.exe', ['/d','/s','/c', command], { shell: false })`.

With `shell: false`, Node/libuv builds the Windows command line itself: args containing spaces/quotes are wrapped in `"` and internal `"` are escaped as `\"` (C-runtime `CommandLineToArgvW` style). **cmd.exe does not parse `\"` that way** — it treats `\` as a literal character and `"` as a quote toggle, and `/s` strips the first/last quote of the whole line. Net effect: embedded quotes land in the wrong places.

### Evidence (reproduced on this machine via the exact spawn path)

- `%CMDCMDLINE%` probe: Node produced `cmd.exe /d /s /c \"echo %CMDCMDLINE%\"` — the `\"` escaping is visible.
- `echo A "x - y" B` → cmd received/echoed `A \"x - y\" B` (backslashes preserved).
- `gh release view "x - y" --repo HenriGrimm/Minnow` → `accepts at most 1 arg(s), received 3` — the quoted arg split into `x`, `-`, `y`.
- `gh release create v0.1.1 --repo HenriGrimm/Minnow --title "x - y" --draft --target main --notes-file NOPE.md` → `no matches found for \`-\`` — byte-for-byte the original failure (gh then passes the standalone `-` into its internal git/shell changelog path, which glob-fails).
- `git log v0.1.0..HEAD --pretty=format:"%h %ad %s"` → exit 128 `%ad` — byte-for-byte.

Only the **cmd.exe** one-shot path is affected. The Git Bash path (`bash --login -c`) and WSL path (`bash -l -c`) and Unix paths (`sh -c`) are fine because POSIX shells understand `\"` backslash-escaped quotes. Interactive PTY sessions are unaffected (different spawn path).

## Fix options

### Option A (recommended): `shell: true` for the win32 one-shot path

Return `{ command, args: [], shell: true }` from the `winOneShot` branch instead of `{ command: 'cmd.exe', args: ['/d','/s','/c', command], shell: false }`. Node/libuv then constructs the cmd.exe invocation itself using its (working) cmd-aware quoting path.

Verified on this machine:
- `spawn('echo A "x - y" B', { shell: true })` → `A "x - y" B` (quotes preserved as one token)
- `spawn('git log v0.1.0..HEAD --pretty=format:"%h %ad %s" --date=short -3', { shell: true })` → exit 0, correctly formatted log

`runProcess` already forwards a `shell` option; `resolveOneShotSpawn` callers (`server/terminal-runner.js:317,489`) pass it through unchanged. Changes are minimal and local.

### Option B: `windowsVerbatimArguments: true` + manual command line

Add `windowsVerbatimArguments: true` to the `runProcess` spawn (or a win32-only branch) and pass the raw command string so libuv does not re-quote it. Verified working on this machine, but it changes spawn behavior for *all* callers of `runProcess` (background runs, dev servers) and leaves cmd's `/s` edge cases (command strings that begin with a quote) to the caller — more surface area than Option A.

### Option C (fallback only): temp batch file

Write the command to a `.cmd`/`.bat` and run `cmd /c <file>`. This is what unblocked the original release task (no embedded quotes in the spawn arg). Always correct but clumsy; not suitable as the default path.

## Implementation sketch (Option A)

`server/terminal/one-shot-spawn.js` — `winOneShot` branch:

```js
if (winOneShot) {
  return {
    command,
    args: [],
    shell: true,
  };
}
```

Node then runs `cmd.exe /d /s /c <command>` with its own quoting. No changes needed in `runProcess`, `terminal-runner.js`, or the sandbox wrapper (`applyAgentShellSandbox` already handles `shell: true` targets).

## Tests

Add `test/terminal/one-shot-spawn.test.mjs` (win32-gated, run on the Windows CI leg; skip elsewhere):

1. `resolveOneShotSpawn` returns `shell: true` + bare command for win32 one-shot strings (unit).
2. Spawn through `runProcess` with a quoted arg; assert the child saw one token — e.g. `node -e "console.log(JSON.stringify(process.argv.slice(1)))" "a - b"` and expect `["a - b"]`.
3. Regression: `git log` with `--pretty=format:"%h %ad %s"` exits 0 (already verified manually).
4. Regression: `gh release view "x - y"` no longer yields "received 3" (network-dependent — mark as optional/skip in CI).

Existing suites to keep green: `test/terminal/git-bash.test.mjs`, `test/terminal/wsl-one-shot-dollar-escape.test.mjs`, `test/terminal/execute-command-background.test.mjs`.

## Risks / notes

- `shell: true` on Windows uses `%COMSPEC%` for cmd.exe; `cwd`/`env`/`windowsHide` still apply.
- Command strings that contain `%VAR%` patterns are still subject to cmd variable expansion (unchanged behavior — cmd was always the executor; only the quoting layer changes).
- Sandbox (`wsl-landlock`) wraps the resolved spawn target; verify the wrapped target still carries `shell: true` correctly (the wrapper spreads spawnTarget fields, so it should).
- Do not "fix" single-quote usage under cmd (Unix habit); that's an agent-guidance issue, already documented in the tool-usage fragment ("Windows shell: do not pipe to Unix-only tools").

## Verification

- `npm test` (at minimum `test:terminal`-scoped suites + the new file).
- Manual: re-run `git log v0.1.0..HEAD --pretty=format:"%h %ad %s"` and `gh release create ... --title "..." --draft` through `execute_command`.