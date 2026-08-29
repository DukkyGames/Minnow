---
name: min-671-probe-on-first-load
overview: Auto-run the per-model capability probe (vision/tools/streaming) the first time a local model is loaded or a hosted/cloud model is selected, so VLMs without a catalog flag still get a Vision badge without a trip to Settings → Providers.
todos:
  - id: server-targeted
    content: Targeted POST /capabilities/probe writes only requested model ids; mergeCapabilities must not clobber existing probe-sourced fields with catalog ingest
    status: completed
  - id: client-first-load
    content: After fetchModels, queue a background probe for loaded LM Studio / My Models / llama.cpp rows that have never been probe-sourced
    status: completed
  - id: library-merge
    content: Apply llama-cpp-local / mlx-lm-local probe results onto matching minnow-library picker rows
    status: completed
  - id: tests
    content: Unit tests for first-load gating/queue plus server tests for targeted probe and probe-preserving merge
    status: completed
  - id: docs
    content: Update documentation/context.md vision/probes paragraph and Settings probe hint
    status: completed
  - id: ci-worktree-fixture
    content: Align MIN-619 panel-cwd fixture with worktrees-segment path rule so CI is not blocked by the pre-existing #941 mismatch
    status: completed
  - id: cloud-in-use
    content: Auto-probe hosted/cloud models that are actually in use (default, session chats, picker) — never the whole catalog
    status: completed
  - id: cloud-picker-hook
    content: Composer, menubar, board, and default-model changes enqueue the same targeted probe
    status: completed
  - id: cloud-tests-docs
    content: Tests for in-use vs unused cloud rows plus context.md / Settings hint
    status: completed
isProject: true
---

# MIN-671 — Probe model on first load

**Date:** 2026-08-27
**Status:** Implemented
**Issue:** Models sometimes stay unflagged as vision until the user clicks **Probe models** in Settings → Providers.

## Problem

Vision is resolved per catalog row. LM Studio `type: 'vlm'` / `catalogVision`, OpenRouter modalities, My Models `mmproj` siblings, and a positive-only id heuristic cover many VLMs. Everything else stays `unknown` (or LM Studio `type: 'llm'` as an authoritative **no**) until a live image probe runs.

That probe only ran from Settings → Providers. Gemma 3, Qwen3.8 (no `vision`/`vl` in the id, no sibling projector), mis-tagged LM Studio rows, and hosted models whose catalogs omit modalities never got a Vision badge — and tool-loop screenshot follow-ups never fired — until a manual probe.

## Approach

1. **After each catalog refresh** (`populateMultiProviderModelSelect`), enqueue a background matrix probe for:
   - LM Studio (`apiKind === 'lm-studio-v0'`) with `state === 'loaded'`
   - My Models (`minnow-library`) with a running serve
   - `llama-cpp-local` loaded rows (the live `/v1/models` alias)
   - **Hosted/cloud** openai-v1 / anthropic-v1 rows that are **in use** (persisted default, `#modelSelect`, every session chat binding, or a picker pick). Every hosted row looks `state: 'loaded'`; probing the rest of an OpenRouter-sized catalog would bill unused models.
   - **Not** every `mlx-lm-local` catalog row — `mlx_lm.server` lists the hub cache, and a request would load weights (My Models serve still qualifies via `minnow-library`)
2. Skip when the catalog already flags vision (`type: 'vlm'` / `catalogVision`) or a previous probe wrote `sources.vision|tools|streaming === 'probe'`.
3. Wait until no chat is streaming so the probe does not steal llama.cpp's single slot from the first user turn (and does not compete with a billed cloud turn).
4. Targeted probes (`modelIds` set) persist **only those models**. Full Settings probes still ingest the rest of the catalog, but merge must not overwrite probe-sourced fields with catalog ingest.
5. Stamp `llama-cpp-local` / `mlx-lm-local` results onto matching **My Models** picker rows so the Vision badge appears on the row the user actually sees.
6. Composer, menubar default, board, and `selectProviderModel` call `scheduleCapabilityProbeForSelectValue` so a newly picked hosted model is probed without waiting for the next catalog refresh.

Manual **Probe models** still exists as an optional bulk path and still does not run on refresh. Auto-probe never aborts an in-flight manual probe; a manual click may abort the auto-probe.

## Out of scope

- Auto-probing every row in a hosted catalog (API cost)
- Auto-running the structured-output (`response_format`) probe
- Changing the vision id heuristic or LM Studio catalog parsing
- Capability-matrix spreadsheet probes (different subsystem)
