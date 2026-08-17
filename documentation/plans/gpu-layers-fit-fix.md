# GPU layers slider vs llama.cpp --fit

## Problem

llama.cpp b10430+ enables `--fit on` by default. Minnow always passed explicit `-ngl 999` (inspector default / slider at max), which made `common_fit_params` log:

`failed to fit params to free device memory: n_gpu_layers already set by user to 999, abort`

The slider itself worked; the conflict was in argv construction.

## Solution

- [x] When `-ngl` is explicit (inspector slider, profiles, defaults), pass `--fit off`.
- [x] When `fit: true` (onboarding), omit `-ngl` so auto-fit can choose layers.
- [x] Tests in `test/models/llama-args.test.mjs`.
