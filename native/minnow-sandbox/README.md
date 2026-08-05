# `minnow-sandbox` — Linux Landlock + seccomp helper (MIN-553 Phase 5)

Small argv-wrapper binary: apply Landlock (and optional minimal seccomp), then
`execve` the real agent command. Same composition shape as macOS `sandbox-exec`.

## Build

```bash
# On Linux (CI ubuntu / package:linux host):
./native/minnow-sandbox/build.sh
# → native/minnow-sandbox/minnow-sandbox
```

Override output: `MINNOW_SANDBOX_OUT=/path/to/bin ./build.sh`

On non-Linux hosts the script **skips** (exit 0) — ship source + build on Linux.

## Probe / exit codes

| Code | Meaning |
|------|---------|
| 0 | `--probe` OK, or (never returned) successful exec |
| 64 | Bad usage |
| 75 | Landlock ABI unavailable → JS `landlock_abi_unavailable` |
| 76 | Ruleset apply failed → JS `landlock_unavailable` |
| 127 | Inner `execve` failed |

```bash
./minnow-sandbox --probe   # prints landlock_abi=N
```

## Invocation (from Node)

```
minnow-sandbox --write <ws> --read /usr --read /bin … -- /bin/bash -lc '…'
```

Env override for the binary path: `MINNOW_SANDBOX_HELPER=/abs/path/minnow-sandbox`.

Packaged Electron (Linux): binary is copied to `process.resourcesPath/minnow-sandbox`
via `build.linux.extraResources`.

## Phase 6 (Windows + WSL)

Call **this same helper inside WSL** after `buildWslOneShotSpawn` — do not invent a
second policy engine. Prefer a Linux-built binary on PATH inside the distro, or
`/mnt/c/…/resources/minnow-sandbox` when the AppImage/NSIS tree is visible.
