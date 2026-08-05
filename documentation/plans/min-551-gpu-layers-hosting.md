# MIN-551: Model hosting GPU layers

## Problem

- Choosing **Custom…** on GPU offload did nothing when the draft still had `n_gpu_layers` 0 or 999 (the custom field only appeared for other values).
- Load tab still showed Quality/Balanced/Speed presets and a KV cache quant picker; product wants defaults only (f16 KV).

## Solution

- [x] Fix Custom mode by seeding a partial layer count when switching from All/CPU.
- [x] Replace the number input with a range slider (max from parameter-size heuristic).
- [x] Show live estimated VRAM/RAM usage on the Load tab.
- [x] Remove hardware presets from the inspector; KV cache dropdown remains with **f16** as the default.

## Todos

- [x] `src/models/serve-memory-estimate.ts` + tests
- [x] `src/ui/models/inspector.ts` Load tab UX
- [x] Styles for tight-memory hint
