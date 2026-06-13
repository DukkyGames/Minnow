# Odysseus Port 02 — Hardware-Aware Model Management (Cookbook)

Tier: 1  
Effort: XL  
Priority: High  
Status: Planned  
Suggested delivery: Four shippable milestones  
Linear: [MIN-125](https://linear.app/minnowai/issue/MIN-125/odysseus-port-02-cookbook-hardware-aware-model-management)

## Goal

Add a Cookbook app that detects local hardware, recommends models that fit, downloads selected local model artifacts, and optionally serves them through local runtimes. The first milestone should be useful on its own: accurate hardware detection and fit recommendations.

## What's Needed Before Starting

| Category | Requirement |
|----------|-------------|
| Prior plans | **#12** for HF tokens and remote credentials (M3+) |
| npm packages | None for M1–M2; M3 may add `node-fetch` progress or use native fetch |
| External binaries | M1: `nvidia-smi` (NVIDIA), `rocm-smi` (AMD, optional). M4: `llama-server`, LM Studio CLI, or Ollama — detect at runtime |
| Disk space | User-managed; downloads to `~/.minnow/models/` |
| Credentials | Hugging Face token (optional) for gated models — via #12 |
| Estimated effort | 15–25 days across four milestones |

## Prerequisites & Deliverables

| Milestone | Deliverable |
|-----------|-------------|
| M1 | `GET /api/system/hardware` + hardware card in Cookbook UI |
| M2 | Model catalog + `POST /api/cookbook/recommend` + fit badges |
| M3 | Download queue with progress, cancel, disk checks |
| M4 | Serve lifecycle + provider registration + "Use in chat" |

## Verified Source Context

- Odysseus references:
  - `services/hwfit/hardware.py` — `detect_system()`
  - `services/hwfit/fit.py` — `analyze_model()`, `rank_models()`
  - `services/hwfit/models.py` — `get_models()`, `params_b()`, `estimate_memory_gb()`
  - `services/hwfit/profiles.py` — `compute_serve_profiles()`
  - `services/hwfit/data/hf_models.json` — catalog data
  - `routes/hwfit_routes.py`, `routes/cookbook_routes.py`, `routes/cookbook_helpers.py`
  - `static/js/cookbookServe.js`
- Minnow current hardware probe: `server/system/vram.js`.
- Minnow system API: `server/system/middleware.js` — currently only `/api/system/vram`.
- Minnow provider model load/unload: `src/api/models.ts`, `server/providers/`.
- Minnow managed-server patterns: `server/servers/manager.js`.
- MinnowOS: `src/os/types.ts` (add `cookbook`), `src/os/app-registry.ts`, `src/os/app-host.ts`.

## Files to Create

### M1 — Hardware

| Path | Purpose |
|------|---------|
| `server/system/hardware.js` | `detectHardware({ fresh })` |
| `test/system/hardware.test.mjs` | CPU/RAM/GPU fixture tests |

### M2 — Catalog & Fit

| Path | Purpose |
|------|---------|
| `server/cookbook/catalog.json` | Transformed from Odysseus `hf_models.json` |
| `server/cookbook/fit.js` | `rankModels(hardware, filters)` |
| `server/cookbook/middleware.js` | Cookbook routes |
| `test/cookbook/fit.test.mjs` | Deterministic ranking fixtures |

### M3 — Download

| Path | Purpose |
|------|---------|
| `server/cookbook/download.js` | Job store, progress, cancel |
| `~/.minnow/cookbook/downloads.json` | Persisted job state |
| `test/cookbook/download.test.mjs` | Job state machine tests |

### M4 — Serve

| Path | Purpose |
|------|---------|
| `server/cookbook/serve.js` | Process lifecycle, health check |
| `server/cookbook/runtime-detect.js` | Find llama.cpp / Ollama / LM Studio CLI |
| `test/cookbook/serve.test.mjs` | Argument validation, cleanup |

### UI (all milestones)

| Path | Purpose |
|------|---------|
| `src/ui/cookbook-page.ts` | Full Cookbook UI |
| `src/styles/cookbook.css` | Styles |
| `test/os/cookbook-app.test.mts` | App registration contract |

## Files to Modify

| Path | Change |
|------|--------|
| `src/os/types.ts` | Add `'cookbook'` to `AppId` |
| `src/os/app-registry.ts` | Register Cookbook |
| `src/os/app-host.ts` | `cookbook` layer wiring |
| `index.html` | `#cookbookView` app layer |
| `server/system/middleware.js` | `GET /api/system/hardware` |
| `server/runtime/middlewares.js` | Register cookbook middleware |
| `documentation/context.md` | Per-milestone updates |

## API Routes

### M1 — System

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/system/hardware` | `{ cpu: {name, cores}, ram: {totalGb, availableGb}, gpus: [{name, vramMb, vendor}], backend, unifiedMemory?, error? }` |

Query `?fresh=1` bypasses cache (optional Odysseus parity).

### M2 — Catalog

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/cookbook/catalog` | `{ models: [...], version }` |
| POST | `/api/cookbook/recommend` | `{ hardware, recommendations: [{ name, fitLevel, requiredGb, quant, score, ... }] }` |

### M3 — Download

| Method | Path | Body / response |
|--------|------|-----------------|
| POST | `/api/cookbook/download` | `{ repoId, filename, quant? }` → `{ jobId }` |
| GET | `/api/cookbook/download/:id/stream` | SSE progress events |
| POST | `/api/cookbook/download/:id/cancel` | `{ ok }` |
| GET | `/api/cookbook/downloads` | List jobs |

### M4 — Serve

| Method | Path | Body / response |
|--------|------|-----------------|
| POST | `/api/cookbook/serve` | `{ modelPath, runtime, port? }` → `{ serveId, endpoint }` |
| POST | `/api/cookbook/serve/:id/stop` | `{ ok }` |
| GET | `/api/cookbook/serve` | Active serve processes |

## Hardware detection shape (M1)

```js
{
  cpu: { name: 'Intel Core i7-12700', cores: 12 },
  ram: { totalGb: 32, availableGb: 18.4 },
  gpus: [
    { name: 'NVIDIA GeForce RTX 4090', vramMb: 24576, vendor: 'nvidia' }
  ],
  backend: 'cuda', // cuda | rocm | metal | cpu | unknown
  unifiedMemory: false,
  probedAt: '2026-06-12T10:00:00.000Z'
}
```

Reuse `probeVram()` from `server/system/vram.js` for NVIDIA. Best-effort AMD (`rocm-smi`), Apple (`system_profiler` + `sysctl` on macOS). Return partial data on failure, never throw to client.

## Detailed Implementation Phases

### Milestone 1 — Hardware API (3–4 days)

1. Create `server/system/hardware.js`:
   - `detectHardware({ fresh })` with 30s TTL cache (match VRAM probe pattern).
   - CPU: `os.cpus()`, `os.totalmem()`, `os.freemem()`.
   - GPU: chain `probeVram()` → AMD → Apple fallbacks.
2. Add route to `server/system/middleware.js`.
3. Cookbook UI shell (M1): hardware summary card only.
4. Tests: mock `os` and `nvidia-smi` output fixtures.
5. Manual: verify on Windows dev machine.

### Milestone 2 — Catalog & Fit (4–5 days)

1. Transform Odysseus `services/hwfit/data/hf_models.json` → `server/cookbook/catalog.json`:
   - Fields: `name`, `provider`, `paramsB`, `quants[]`, `context`, `minVramGb`, `recommendedVramGb`, `ggufSources`, `backendHints`.
2. Port `rank_models()` logic to `server/cookbook/fit.js`:
   - `fitLevel`: `recommended` | `marginal` | `not_recommended`.
   - Deterministic `score` for sorting.
   - Explain fields: `requiredGb`, `runMode`, `speedTps` (estimate).
3. Routes: catalog + recommend.
4. Cookbook UI: recommendation list with fit badges, catalog filters (size, quant, provider).
5. Tests: fixed hardware fixtures → fixed ranking order.

### Milestone 3 — Download (5–7 days)

1. Job store at `~/.minnow/cookbook/downloads.json`.
2. `server/cookbook/download.js`:
   - Explicit user click required; confirm size + destination.
   - Stream from Hugging Face (or direct URL from catalog metadata).
   - HF token from #12 encrypted storage when needed.
   - SSE progress: `{ jobId, bytesReceived, totalBytes, status }`.
   - Cancel: abort controller + cleanup partial file.
   - Disk-space check before start (`fs.statfs` or `check-disk-space` if needed).
   - Destination: `~/.minnow/models/<repoId>/<filename>`.
3. Cookbook UI: download queue, progress bars, cancel buttons.
4. Tests: job state transitions, cancel mid-download.
5. Manual: download tiny GGUF test artifact.

### Milestone 4 — Serve (5–8 days)

1. `server/cookbook/runtime-detect.js`: probe for `llama-server`, Ollama, LM Studio CLI.
2. `server/cookbook/serve.js`:
   - User-started only; validated args from catalog metadata (never execute arbitrary catalog strings).
   - Reuse `server/servers/manager.js` logging/health patterns.
   - Spawn with bounded port; health-check `GET /health` or models endpoint.
   - Register dynamic provider row under `~/.minnow/providers/` OR return endpoint for manual provider add.
   - Stop on user action + server shutdown hook.
3. Cookbook UI: serve/stop controls, "Use in chat" → model chip / load flow.
4. **Document v1 scope:** local-only; Odysseus remote SSH/tmux/GPU pinning deferred.
5. Manual: serve downloaded model, load via model chip, complete chat turn.

## Implementation TODOs

- [ ] M1: implement hardware API and tests
- [ ] M2: create model catalog and fit scoring tests
- [ ] M2: port/transform `services/hwfit/data/hf_models.json` and preserve quant/model metadata
- [ ] M2: add recommendation API
- [ ] M3: add download job store, progress stream, cancellation, and disk checks
- [ ] M4: add serve lifecycle with explicit user action and process cleanup
- [ ] M4: document local-only v1 vs full Odysseus remote-host parity before implementation starts
- [ ] M4: add provider registration/handoff for served endpoints
- [ ] UI: add Cookbook MinnowOS app registration and page
- [ ] UI: show fit, download, and serve states
- [ ] Update `documentation/context.md` after each shipped milestone

## Odysseus Tests to Port

| Area | Odysseus tests |
|------|----------------|
| hwfit | `tests/test_hwfit_*.py` (11 files), `tests/test_serve_profiles.py` |
| cookbook | `tests/test_cookbook_*.py` (15 files) |
| image models | `tests/test_image_models_*.py` (defer to #11) |

## Acceptance Criteria

- M1: `/api/system/hardware` reports CPU, RAM, and best-effort GPU/VRAM on the dev machine.
- M2: `/api/cookbook/recommend` ranks catalog models deterministically for fixed hardware fixtures.
- M3: a small test model downloads with visible progress and can be cancelled.
- M4: a downloaded model can be served and selected through existing model UI.
- UI: Cookbook opens from MinnowOS and reflects server state after reload.

## Verification

- Add `test/system/hardware.test.mjs`
- Add `test/cookbook/fit.test.mjs`
- Add route tests for catalog, recommend, and download job state
- Manual: verify hardware output on Windows
- Manual: download a tiny GGUF test artifact
- Manual: serve a downloaded model, load it through the model chip, and complete a chat turn

## Risks And Guardrails

- Never auto-download or auto-start a model.
- Validate catalog entries as data; never execute commands from catalog JSON.
- Large downloads need disk-space checks and cancellation.
- Windows process lifecycle must be tested directly.
- Remote Hugging Face access may require tokens later; route those secrets through #12.
