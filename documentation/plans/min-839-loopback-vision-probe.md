---
name: min-839-loopback-vision-probe
overview: Stop first-load capability probes from sending a corrupt PNG image_url to loopback llama.cpp (mtmd/ffprobe), and do not stamp vision from a projector/CUDA crash. Keep the passthrough control for remote openai-v1 gateways.
todos:
  - id: skip-corrupt-control
    content: Skip the corrupt-image vision control for loopback / llama-cpp-local / mlx-lm-local; keep it for remote openai-v1
    status: completed
  - id: crash-signature
    content: If the valid PNG probe errors with mtmd / ffprobe / CUDA / decode-buffer (or drops the connection), stop further image probes and do not stamp sources.vision=probe
    status: completed
  - id: skip-auto-vision
    content: First-load auto-probe skips vision entirely on loopback openai-v1 (including llama-cpp-local); Settings → Probe models still runs the valid PNG
    status: completed
  - id: tests
    content: Unit tests for the helpers plus server tests for loopback skip, remote passthrough, crash, and auto skipVision
    status: completed
  - id: docs
    content: Update documentation/context.md vision/probes paragraph and Settings probe hint
    status: completed
isProject: true
---

# MIN-839 — Loopback vision probe must not send a corrupt image_url

**Issue:** [MIN-839](https://linear.app/minnowai/issue/MIN-839)
**Status:** Implemented

## Problem

v0.1.0 auto-runs the capability matrix the first time an in-use hosted openai-v1 model is selected (MIN-671). llama.cpp `/v1/models` is a bare `{ id }` catalog, so a custom loopback provider (`127.0.0.1:8081`) is not skipped.

`runCapabilityProbe` then:

1. POSTs a valid 16×16 PNG `image_url`.
2. If that returns HTTP 200, POSTs `PROBE_INVALID_IMAGE_DATA_URL` — base64 of the ASCII string `not-an-image-minnow-capability-probe` labeled as `image/png`.

Step 2 exists to catch **cloud passthrough** gateways that 200 any content part without decoding. llama.cpp with `--mmproj` **does** decode. The garbage buffer prints:

```
mtmd_helper_video_init_from_buf: ffprobe failed on buffer
mtmd_helper_bitmap_init_from_buf: failed to decode buffer as either image/audio/video
```

A mismatched projector can also CUDA-fault on the **valid** PNG. A later text-only CUDA abort (snippet B) is llama.cpp / launch-flag territory, not something Minnow should paper over.

## Approach

1. **Skip the corrupt-image control** when the provider is `llama-cpp-local`, `mlx-lm-local`, or any loopback `baseUrl`. Local runtimes decode; the control stays for remote openai-v1 (OpenRouter-style).
2. **Crash, not “no vision”:** if the valid PNG errors with `mtmd` / `ffprobe` / `CUDA` / decode-buffer, or the image POST drops the connection after a successful text ping, do not send further image probes and do not set `sources.vision = 'probe'` (a probed `false` would beat the id heuristic).
3. **Auto-probe skips vision on loopback openai-v1.** First-load still probes tools + streaming. Settings → **Probe models** still sends the valid PNG (without the corrupt control). LM Studio (`lm-studio-v0`) keeps auto vision — its catalog already names VLMs and it rejects images cleanly.

Snippet B (text-only CUDA abort after ~21s) is out of scope for this patch. Workarounds stay in the issue: matching Qwen3.8 mmproj, smaller `-c`, no `draft-mtp`, composer Medium/Off.
