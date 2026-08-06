# `minnow-sandbox` — Linux Landlock + seccomp helper (MIN-553 Phase 5)

Small argv-wrapper binary: apply Landlock (and optional minimal seccomp), then
`execve` the real agent command. Same composition shape as macOS `sandbox-exec`.

## Build

```bash
# Preferred (Linux or Windows+WSL) — fails loudly if the ELF is missing/empty:
npm run sandbox:ensure-helper
# → native/minnow-sandbox/minnow-sandbox

# Or on Linux only:
./native/minnow-sandbox/build.sh
```

Override output: `MINNOW_SANDBOX_OUT=/path/to/bin ./build.sh`

On non-Linux hosts `build.sh` **skips** (exit 0). Use `sandbox:ensure-helper` for
packaging — on Windows it builds via WSL and refuses to ship an empty resource.

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

Path rules skip missing paths and strip directory-only Landlock rights when the
target is a regular file (so `--read ~/.bashrc` no longer fails with EINVAL).

## Invocation (from Node)

```
minnow-sandbox --write <ws> --read /usr --read /bin … -- /bin/bash -lc '…'
```

Env override for the binary path: `MINNOW_SANDBOX_HELPER=/abs/path/minnow-sandbox`.

Packaged Electron:

- **Linux** AppImage: `build.linux.extraResources` → `resources/minnow-sandbox`
- **Windows** NSIS: `build.win.extraResources` → same (Linux ELF; used inside WSL)

`package:win` / `package:linux` run `scripts/ensure-minnow-sandbox-helper.mjs` first.

## Phase 6 (Windows + WSL)

Call **this same helper inside WSL** after `buildWslOneShotSpawn` — do not invent a
second policy engine. On first use Minnow copies the packaged/host ELF into the
distro at `~/.local/share/minnow/minnow-sandbox` (chmod +x) and prefers that path
over `/mnt/c/…` (NTFS mounts are often `noexec`). Override with
`MINNOW_SANDBOX_HELPER` (Linux path, bare PATH name, or Windows path to the ELF).
