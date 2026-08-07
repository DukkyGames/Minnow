#!/usr/bin/env bash
# Build the Landlock+seccomp helper for Linux agent shells (MIN-553 Phase 5).
# Run on Linux (or a Linux cross sysroot). On Windows/macOS this script exits 0
# with a skip message so packaging hooks stay non-fatal outside linux builds.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${MINNOW_SANDBOX_OUT:-$ROOT/minnow-sandbox}"
CC="${CC:-cc}"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "[minnow-sandbox] skip build on $(uname -s) — produce the binary on Linux CI or package:linux"
  exit 0
fi

CFLAGS="${CFLAGS:--O2 -Wall -Wextra -Werror=implicit-function-declaration}"
# Prefer static when the toolchain supports it (AppImage / extraResources portability).
# Musl or glibc-static may be unavailable — fall back to dynamic.
STATIC_FLAG=""
if echo 'int main(void){return 0;}' | "$CC" -static -x c - -o /tmp/minnow-sandbox-static-probe 2>/dev/null; then
  STATIC_FLAG="-static"
  rm -f /tmp/minnow-sandbox-static-probe
fi

echo "[minnow-sandbox] compiling with $CC $CFLAGS $STATIC_FLAG → $OUT"
# shellcheck disable=SC2086
"$CC" $CFLAGS $STATIC_FLAG -o "$OUT" "$ROOT/minnow-sandbox.c"
chmod +x "$OUT"
echo "[minnow-sandbox] ok: $OUT ($("$OUT" --probe 2>/dev/null | tr -d '\n' || echo 'probe deferred'))"
