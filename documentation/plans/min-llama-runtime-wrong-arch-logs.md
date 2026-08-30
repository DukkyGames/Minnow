---
name: min-llama-runtime-wrong-arch-logs
overview: "Empty Local Server runtime logs after the b10448 pin: CUDA 13 asset picker took win-cuda-13.4-arm64 over win-cuda-13.3-x64."
todos:
  - id: picker-host-arch
    content: Filter cuda-13 zip selection (and cudart companion) by host platform + arch; pick newest CUDA 13 patch only among those
    status: completed
  - id: tests
    content: Add a mixed-arch b10448-shaped fixture test so x64 cannot win arm64 13.4
    status: completed
  - id: pe-guard
    content: After extract, refuse a Windows PE whose machine type does not match this host
    status: completed
  - id: docs
    content: Update documentation/context.md llama.cpp variant-selection sentence
    status: completed
  - id: reinstall
    content: Reinstall the managed llama.cpp runtime to the host-arch zip
    status: completed
isProject: false
---

# Empty runtime logs after llama.cpp pin

## What happened

On this AMD64 PC, `~/.minnow/models-runtime/llama-cpp/meta.json` recorded:

- `llama-b10448-bin-win-cuda-13.4-arm64.zip`
- `cudart-llama-bin-win-cuda-13.4-arm64.zip`

`llama-server.exe` is a 9 KiB ARM64 console stub (`PE machine 0xAA64`). Starting it fails with “This version of %1 is not compatible with the version of Windows you're running.” Node still creates `~/.minnow/logs/models/{runId}.log`, then the child exits with no stdout/stderr — Local Server shows an empty Runtime log.

b10448 publishes `win-cuda-13.3-x64` and a newer `win-cuda-13.4-arm64` (no 13.4 x64). `findAsset` treated “newest cuda-13*” as a global string sort, so 13.4-arm64 beat 13.3-x64.

## Fix

1. Host-filter every cuda-13 candidate (and cudart fallback) before picking the newest patch.
2. Fail install if the extracted `llama-server.exe` PE arch does not match the host (skip non-PE test stubs).
3. Reinstall the managed runtime so this machine gets the x64 zip.

## Out of scope

- Changing the pin away from b10448
- llama.cpp log-format / verbosity changes (logs were empty because the process never ran)
