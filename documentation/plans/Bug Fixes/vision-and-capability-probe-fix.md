# Vision detection and capability probe fix

## Problem

1. **Vision:** LM Studio 0.4.8+ reports multimodal models as `type: llm` with `capabilities.vision: true`. Minnow only treated `type === vlm` as vision and overwrote upstream `capabilities` when merging, so `image_url` parts were never sent.

2. **Probe:** **Probe models** ran chat completions against up to 8 catalog models including unloaded ones on LM Studio, triggering auto-load/unload and long hangs.

## Solution

### Catalog vision (`server/providers/paths.js`)

- `normalizeLmStudioModelRow` sets `catalogVision` from `type: vlm` or upstream `capabilities.vision`.
- Flattens `capabilities.reasoning` to top-level `reasoning`.
- Strips upstream `capabilities` from proxied rows.

### Client ingest

- `catalogRowHasVision` / `catalogCapabilitiesFromRow` honor `catalogVision`.
- `visionFromRow` checks catalog signals before `capabilities.vision === false`.
- `modelSupportsVision` uses `catalogRowHasVision` fallback.

### LM Studio probe (`server/providers/capability-probe.js`)

- When `apiKind === lm-studio-v0` and no `modelIds`, target list = loaded catalog ids only; fail fast if none.
- `probeModelCapabilities` skips HTTP probes for unloaded rows (catalog-only patch).
- Routes return 400 for "No loaded model" errors.

### Settings UI

- **Probe models** disabled on LM Studio when no loaded model (mirrors structured probe).
- Client passes loaded `modelIds` + `selectedModelId` from active chat.
- Hint copy explains loaded-model requirement.

## Tests

- `test/providers/paths.test.js` — normalization
- `test/providers/model-capabilities.test.mts` — `catalogVision`
- `test/benchmark/capability-multimodal.test.mts` — `isVisionModel`
- `test/providers/capability-probe-server.test.js` — loaded-only matrix probe

## Manual verification (LM Studio)

1. Load a vision model with `type: llm` + `capabilities.vision: true`.
2. Refresh models → Vision badge; attach image → request includes `image_url`.
3. **Probe models** with one model loaded → fast, model stays loaded.
4. No models loaded → button disabled / clear error.
