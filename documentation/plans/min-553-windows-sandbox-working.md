# MIN-553 Windows sandbox working plan — progress

**Branch:** `feat/min-553-agent-shell-sandbox`  
**Parent plan:** [`min-553-agent-shell-sandbox.md`](./min-553-agent-shell-sandbox.md)

## Todos

| ID | Item | Status |
|---|---|---|
| 1-ensure-package | `scripts/ensure-minnow-sandbox-helper.mjs` + `package:win` / `win.extraResources` + CI ELF artifact | **Done** |
| 2-wsl-install | Auto-install host ELF into `~/.local/share/minnow/minnow-sandbox`; prefer over `/mnt` | **Done** |
| 3-landlock-harden | Skip missing paths; strip directory-only rights on files (`.bashrc` EINVAL) | **Done** |
| 4-canary-ci | `wsl-landlock-canary.test.mjs`; fix compose `/mnt` assert on POSIX CI; wiki catalog | **Done** |
| 5-docs | Settings Prefer/Require hints; privacy + context + plan | **Done** |
| 6-tests | `node test/run-all.mjs --suite sandbox` | **Done** (64 pass) |

## Packaging / install flow

1. **`npm run package:win`** → `ensure-minnow-sandbox-helper.mjs` (build via WSL on Windows, or native `build.sh` on Linux) → must leave a non-empty `native/minnow-sandbox/minnow-sandbox`.
2. **electron-builder** copies ELF to `resources/minnow-sandbox` (`build.win.extraResources`, mirrors Linux).
3. **First agent shell sandbox use on Windows:** resolve host ELF → copy into distro `~/.local/share/minnow/minnow-sandbox` + `chmod +x` → probe/wrap use that path (avoids `/mnt/c` `noexec`).
4. **`MINNOW_SANDBOX_HELPER`** still overrides (Linux path, bare name, or Windows path to ELF).

## Out of scope (unchanged)

Native Win sandbox · dedicated Minnow WSL distro · Docker/OCI.
