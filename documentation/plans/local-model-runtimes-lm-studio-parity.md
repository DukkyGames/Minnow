# Local model runtimes — LM Studio parity

Status: **complete** (Phases 0–7 verified PASS, 2026-08-16).
Worktree: `C:\Users\dukky\.cursor\worktrees\lm-parity-9d2f6a1c` (detached from `main` @ `3a055cda`).
Merge-back: `/apply-worktree`. Cleanup: `/delete-worktree`.

## Context

Running local models in Minnow feels janky because Minnow **computes good information and then throws it away at launch**. Three verified examples:

- `src/models/memory-model.mjs` `maxContextForBudget()` is called only from `src/models/fit.ts` (Discover display text). It never influences a launch.
- `server/models/gguf-metadata.js` parses `trainCtx`. Nothing reads it. Exceeding it silently produces garbage.
- `server/models/profiles.js` computes `fits`, then emits `ngpu: 999` and `ctx: 125_000` regardless.

Sharpest instance: `server/models/llama-args.js` passes `--fit off` and `-ngl 999` on every load. llama.cpp native auto-fit sizes unset arguments to device memory; Minnow disables it and demands full GPU offload at 125k context. Onboarding (`src/onboarding/managed-setup.ts`) is the one path that passes `fit: true`. First load works; later loads from My Models have the safety net off.

Verified on the author's machine: installed runtime **b9628** while code pins **b10448**, because `ensureLlamaServer()` (`server/models/llama-runtime.js`) compares only *variant*, never version.

**Outcome intended:** local models load on the first try at settings that fit the machine, tell you plainly when they don't, remember what you set, survive a crash visibly, and stop re-downloading 20 GB from byte zero.

## Locked decisions

- Full LM Studio *feel* parity for llama.cpp loads — **not** llama-server router-mode rearchitecture.
- MLX gets cheap correctness fixes only (unverifiable on Windows).
- In-flight timeout refactor is assumed already on `main`.
- **Let llama.cpp size the GPU split; Minnow sizes the context.** Auto mode: `--fit on`, leave `-ngl` unset, Minnow still passes `-c` (semantic ceiling is `trainCtx`).
- `PREFERRED_CONTEXT_TOKENS = 32_768`. Keep `DEFAULT_CONTEXT_TOKENS` exported but deprecated.
- Default KV cache stays **f16**; quantized KV is a degradation under pressure.
- Do not bump `LLAMA_CPP_RELEASE_TAG` in this work (Phase 0 fixes the upgrade *mechanism* only).
- Only the models/serve surface moves poll → SSE (Phase 2). Other polls stay.

## Out of scope (explicit non-goals)

1. llama-server router mode.
2. A `LocalRuntime` interface (premature at n=2).
3. Bumping `LLAMA_CPP_RELEASE_TAG`.
4. Multi-GPU auto-tuning (`--tensor-split` / `--main-gpu` / `--split-mode` stay manual).
5. Speculative decoding, in-app quantization, a new download backend, MLX tunables, replacing `terminal-runner.js`.
6. A global poll→SSE migration.
7. Real load-progress percentages from llama.cpp logs (drive a time-based estimate from prior loads instead — Phase 1d).

## Done means (end-to-end after Phases 1–3)

Manual pass on Windows 11 + CUDA:

1. Load a model from **My Models** that previously failed → starts on the first try; argv in the serve log matches the inspector preview.
2. Set a non-default context in the inspector, reload the app → the setting survives.
3. Load a model at deliberately absurd settings in `manual` mode → classified OOM with a concrete suggested retry that works.
4. Kill `llama-server.exe` from Task Manager mid-generation → UI shows Crashed within ~1 s.
5. Start a large download, kill the tool server, restart → resumes rather than restarting at 0.
6. Download a split-GGUF repo → all shards arrive and the model loads.

Automated: scoped tests per phase; `npx tsc --noEmit` when TS is touched. A non-zero full `npm test` is **not** by itself a regression (known failures on clean `main`). New `mock.module` tests must be registered as `tsx-mocks` in `test/test-config.mjs`.

## Todos

| ID | Phase | Status | Verifiable deliverable |
|----|-------|--------|------------------------|
| 0 | Runtime version drift, MLX install DTO, memoized probe | **done** | Tests + Settings DTO/UI |
| 1a | Plumb GGUF header into `startServe()` | **done** | Launch uses `readGgufMetadata` |
| 1b | `src/models/launch-plan.mjs` (+ `.d.mts`) | **done** | Unit tests on fixtures × budgets |
| 1c | Clamp inside `buildLlamaServerArgs`; `fit_mode`; empty `settingsFor()` until touched | **done** | Golden-argv tests |
| 1d | Persist `models.launch.byLibraryId`; library Load uses `settingsFor` | **done** | Prefs survive reload |
| 2 | Crash watcher, restart policy, heartbeat, MLX crash prop, serve SSE | **done** | Kill exe → Crashed; unit restart policy |
| 3 | `diagnoseLlamaFailure` + UI title/remediation/action | **done** | Table-driven fixtures |
| 4 | Flags, extra_args tokenizer, sampler passthrough, `stop` | **done** | min_p arrives locally; hosted still strips |
| 5 | Download resume, checksum, split-GGUF, queue, ETA | **done** | Resume offset + sha256; split load |
| 6 | LRU residency, TTL, request admission | **done** | Two models resident; chat not starved |
| 7 | Dedup, MLX honest loading, hot-path cache, graceful kill, archive digest | **done** | Tests + no extra disk walk on `/v1/models` |

### Phase 0 checklist

- [x] `ensureLlamaServer()` compares installed `meta.json` `version` to `LLAMA_CPP_RELEASE_TAG`; does **not** force upgrade mid-session
- [x] `getLlamaRuntimeStatus()` surfaces upgrade (pinned vs installed)
- [x] Settings → Servers llama.cpp row offers upgrade (existing Reinstall path)
- [x] `listServers()` forwards `supported` / `installable` / `reason`
- [x] Settings → Servers hides/disables MLX Install when `installable === false` and shows `reason`
- [x] `detectLlamaThinkingBudgetSupport()` cached by binary path; cache cleared on runtime-install reset
- [x] Tests for version compare, DTO fields, probe memoization
- [x] `documentation/context.md` llama.cpp runtime paragraph updated

### Phase 1–7 checklists

Filled in as each phase starts; see phase sections below.

---

## Phase 0 — Free wins (~0.5 day)

**Depends on:** nothing.

### 0.1 Runtime version drift

`ensureLlamaServer()` (`server/models/llama-runtime.js` ~L407) returns the existing binary unless `reinstall` or a variant mismatch.

- Compare `meta.json` `version` (already written at L519–533) against `LLAMA_CPP_RELEASE_TAG`.
- Normalize tags (`b9628` vs `b10448`) by stripping a leading `b` and comparing integers when both parse; otherwise string equality.
- **Do not** auto-reinstall from `ensureLlamaServer()` during a model load (that is a mid-session force). Return the existing binary and flag the mismatch.
- Surface on `getLlamaRuntimeStatus()` (and therefore `GET /api/models/llama/runtime` / Settings row):
  - `pinnedVersion` — `LLAMA_CPP_RELEASE_TAG`
  - `installedVersion` — `meta.version` or null
  - `upgradeAvailable` — true when a managed install exists and versions differ
- Settings → Servers llama.cpp row (`createLlamaCppServerRow` in `src/ui/settings-servers-section.ts`): when `upgradeAvailable`, show a clear hint (installed vs pinned) and relabel Reinstall as **Upgrade** (still `reinstall: true`).
- Client type: `LlamaRuntimeStatus` in `src/models/api-client.ts`.

### 0.2 MLX Install button on Windows/Linux

`mlx-lm.js` `getInstallStatus()` already returns `supported` / `installable`. `getExtendedStatus()` adds `reason`. `manager.js` `listServers()` (~L479–511) rebuilds the DTO field-by-field and **drops** those three fields.

- Add `supported`, `installable`, `reason` to the `listServers()` object (spread or explicit).
- Extend `ManagedServerSummary` in `src/servers/client.ts`.
- Gate the Install button in `createServerRow` (`src/ui/settings-servers-section.ts`): if `installable === false`, do not show a working Install (hide or disable); show `reason` as hint text. Plan cited L669 (the refresh loop) — the real control is inside `createServerRow` (~L332).

### 0.3 Memoize capability probe

`detectLlamaThinkingBudgetSupport()` (~L580) spawns `llama-server --help` with a 15 s timeout on every successful load.

- Cache by binary path in a module-level `Map`.
- Clear the map in `resetLlamaRuntimeInstallForTests()` **and** after a successful managed install (same path would otherwise keep a stale probe).

### Phase 0 verify

- Unit tests: version mismatch does not reinstall; DTO flags; listServers includes MLX fields; probe hits `runProcess` once per path.
- `npx tsc --noEmit` if TS touched.
- Diff matches Phase 0 only.

---

## Phase 1 — Launch settings that fit (4–6 days)

**Depends on:** Phase 0. **The main event.**

### 1a. Plumb the GGUF header into the launch path

`computeServeProfiles()` already accepts `opts.ggufMeta` and prefers `geometryFromGgufMetadata()`. Phase 1a threads that header through `startServe` → `buildLlamaServerArgs` and through the profiles handler's preview argv, so launch and inspector share exact `nLayers`, `layerBytes`, `swaWindow`, `trainCtx`, `splitCount`.

#### Phase 1a checklist

- [x] `startServe()` (llama-cpp only) calls `readGgufMetadata(modelPath)` after `validateServeModelTarget`; `null` is tolerated
- [x] `buildLlamaServerArgs` accepts `opts.ggufMeta` and passes it to `computeServeProfiles`
- [x] `GET /api/models/profiles` passes `ggufMeta` into `buildLlamaServerArgs` as well as `computeServeProfiles`
- [x] Tests: forwarding (`geometry_source` `'gguf'` / header `nLayers`); `startServe` calls `readGgufMetadata`; ngl=999 / `--fit off` unchanged
- [x] `documentation/context.md` llama.cpp / profiles sentence updated

### 1b. New module `src/models/launch-plan.mjs` (+ `.d.mts`)

Must run server-side and client-side — follow `memory-model.mjs` / `model-geometry.mjs` (`.mjs` + `.d.mts` imported raw by the server). Do **not** put this in `src/models/fit.ts` (server cannot import TS).

```
planLlamaLaunch({ geometry, weightsBytes, trainCtx, hardware, variant, parallel, requested })
  -> { ctx, ctxPerSlot, n_gpu_layers, cache_type, flash_attn, fits, estimateGb, reason, clampedFrom }
```

Auto mode:

- Pass **`--fit on`** and leave `-ngl` unset.
- Use `--fit-ctx` (min ctx auto-fit may choose, default 4096) and `--fit-target` (per-device margin).
- Minnow still computes and passes `-c`.

Context algorithm:

1. **Budget.** GPU variant with `gpuVramGb > 0`: `gpuVram*GIB - max(0.9 GiB, gpuVram*GIB*0.08)`. CPU: `min(availableRam*0.70, totalRam*0.55) * GIB`.
2. **Uncertainty headroom.** Divide by `GEOMETRY_UNCERTAINTY[geometry.source]` (`model-geometry.mjs`).
3. **Target.** `min(trainCtx || 8192, PREFERRED_CONTEXT_TOKENS)` with **`PREFERRED_CONTEXT_TOKENS = 32_768`**. Keep `DEFAULT_CONTEXT_TOKENS` exported but deprecated.
4. **`trainCtx` is a hard ceiling.** Never plan above it; cap the UI slider and label the cap.
5. **Fit to budget** via `maxContextForBudget(geometry, kvBudget, cacheType)`.
6. **Snap down to ladder:** `[4096, 6144, 8192, 12288, 16384, 24576, 32768, 49152, 65536, 98304, 131072, 196608, 262144]`.
7. **Degradation** if 4096 won't fit at f16: `cache_type` f16 → q8_0 → q4_0, then `fits: false` with a structured reason. Default stays **f16**.
8. **`--parallel` divides `-c` across slots.** Emit `ctx = ctxPerSlot * parallel` and show per-slot context in the UI.
9. **`--flash-attn`.** Pass `on` for cuda/metal/rocm, `auto` for vulkan/cpu. Do **not** pass `auto` on CUDA.
10. **Do not pass `--swa-full`.**

#### Phase 1b checklist

- [x] `src/models/launch-plan.mjs` + `launch-plan.d.mts` — `planLlamaLaunch` sizes ctx to machine + `trainCtx`; does not spawn
- [x] Auto GPU: `n_gpu_layers` is `null` (never 999). CPU: `0`
- [x] `PREFERRED_CONTEXT_TOKENS = 32768`; `CONTEXT_LADDER` exported; `trainCtx` hard ceiling (missing → 8192 target cap)
- [x] `maxContextForBudget` gained `opts.snap: 'power2' | 'none'` (default `'power2'` unchanged); launch-plan uses `'none'` then the ladder
- [x] Default KV `f16`; degrade f16 → q8_0 → q4_0; `flash_attn` on for cuda/metal/rocm, auto for vulkan/cpu
- [x] `DEFAULT_CONTEXT_TOKENS = 125000` kept, marked deprecated
- [x] Tests: `test/models/launch-plan.test.mjs` (8B dense, 30B-A3B MoE, Gemma SWA × 6/8/12/24/96 GB + CPU)
- [x] `documentation/context.md` launch-plan paragraph; **not** wired into `buildLlamaServerArgs` (1c)

### 1c. Where the clamp lives

**Server-side, inside `buildLlamaServerArgs()`** (`llama-args.js`), right after `mergeSettings()`, replacing unconditional `n_gpu_layers = 999`.

`src/ui/models/library-panel.ts` calls `loadModel(model)` with **no settings** while the inspector calls `loadModel(model, settingsFor(model))`. A client-side clamp would leave the library Load button broken.

`settingsFor()` (`inspector.ts`) currently materializes `{ctx: 125000, n_gpu_layers: 999, cache_type: 'f16'}`. Change it to return `{}` until a control is touched, and render the server-computed plan as the initial slider position.

Add `fit_mode: 'auto' | 'manual'` to `LlamaServeSettings`:

- `auto` (default) — planner owns ctx / n_gpu_layers / cache_type; `batch_size`, `parallel` etc. still pass through.
- `manual` — pass through unclamped, but still run the planner and write a warning line into the serve log before spawn when the estimate exceeds budget by >1.25×.

#### Phase 1c checklist

- [x] `buildLlamaServerLaunch` runs `planLlamaLaunch` after `mergeSettings`; auto is default (legacy 125k/999 without `fit_mode` stays auto)
- [x] Auto GPU argv: `--fit on`, no `-ngl`, planner `-c` on `CONTEXT_LADDER` ≤ 32768, `--flash-attn on`, `--fit-ctx 4096`, `--fit-target` MiB, no `--swa-full`
- [x] Manual GPU: ctx/ngl pass through, `--fit off` when ngl is set; over-budget warning contains `fit planner` and is appended to the serve log after `createRun`
- [x] CPU auto: `-ngl 0`, `--flash-attn auto`
- [x] `settingsFor()` / `settingsForDraft()` return `{}` until ctx / GPU layers / KV cache is touched; inspector sliders start at the client plan (`ctxPerSlot`), ladder-snapped, GPU label Auto, `trainCtx` cap
- [x] Effective planned settings stored on the serve row; `n_gpu_layers` 999 never written
- [x] `documentation/context.md` llama.cpp paragraph updated (wired into `buildLlamaServerLaunch`; `--flash-attn`, no `--swa-full`, `{args, plan, warning, settings}`)
- [x] Golden-argv (`test/models/llama-args.test.mjs`) + `test/ui/inspector-launch.test.mts`; `npx tsc --noEmit`

### 1d. Persist per-model launch settings

Mirror `server/models/inference-prefs.js`: add `models.launch.byLibraryId`, `server/models/launch-prefs.js`, and `GET`/`PUT /api/models/launch`. `startServe` merges saved prefs between `defaults` and `settings`. Fix `library-panel.ts` to pass `settingsFor(model)`.

Store a time-based load-progress prior (file size + observed load rate) with launch prefs — approximate but monotonic (non-goal 7).

#### Phase 1d checklist

- [x] `server/models/launch-prefs.js` — `models.launch.byLibraryId`; unknown keys dropped; empty/null deletes the row
- [x] `GET` / `PUT /api/models/launch` next to inference routes
- [x] Client `library-launch-meta.ts` + boot/`initInspector` load; inspector seeds `draftSettings` and PUTs on touch (debounced)
- [x] `library-panel.ts` `startLoad` uses `settingsFor(model)` (same payload as inspector Load)
- [x] `startServe` accepts `libraryId`; merge order llama-cpp.json defaults → saved prefs → `body.llama`; `loadModel` passes `libraryId`
- [x] `lastLoadMs` / `lastWeightsBytes` recorded when a llama.cpp serve reaches `running`; Load tab may show a duration estimate
- [x] Tests: `launch-prefs.test.mjs`, `serve-launch-prefs.test.mjs`, inspector-launch round-trip; `npx tsc --noEmit`

### Phase 1 verify

- Unit tests on `planLlamaLaunch`: fixture geometries (8B dense, 30B-A3B MoE, Gemma-style SWA) × budgets (6/8/12/24/96 GB) × variants. Assert monotonicity, ladder membership, `ctx <= trainCtx`, and `estimateRunMemory(plan).totalBytes <= budget`.
- Golden-argv test on `buildLlamaServerArgs` for auto and manual modes.
- Manual: load a model that previously OOM'd; argv in serve log matches inspector preview.

---

## Phase 2 — Supervision and honest state (3–4 days)

**Depends on:** Phase 0 (can proceed in parallel with Phase 1; Phase 3 needs both).

Today a mid-session OOM leaves `serves.json` saying `running` forever. Reconciliation runs only at boot (`serve.js`).

- **Crash watcher.** `subscribeRun`/`waitForRun` exist at `terminal-runner.js`. In `settle()`, after promoting to `running`, subscribe and on exit set status **`crashed`** — distinct from `stopped` (user) and `error` (failed to load) — recording `exitCode` and Phase 3 classification (Phase 2 can store a stub classification until Phase 3 lands).
- **Restart policy.** Auto-restart once, after 2 s, only when the serve was healthy ≥30 s and classification is `{unknown, transient, port_conflict}`. Never auto-restart an OOM. Everything else gets a Retry button.
- **Heartbeat.** One module-level 10 s interval polling `/health` for `running` rows. Three consecutive failures with the PID alive → `unhealthy`.
- **MLX crash propagation.** `subscribeServerState(serverId, cb)` on `manager.js`, fired from existing `child.on('exit')`. `serve.js` subscribes for `mlx-lm` and marks MLX rows `crashed`. Fully testable on Windows by stubbing the manager.
- **Serve SSE.** `GET /api/models/serve/events`, modelled on serve-log SSE (`routes.js`). Wrap every `saveServes()` in `commitServes(reason)`. Client: `subscribeServeEvents()` beside `subscribeServeLog`. `trackLoad` drops its 1 s interval; keep a 15 s reconciling poll. **Only** models/serve moves to SSE.

#### Phase 2 checklist

- [x] `commitServes(reason)` wraps every `saveServes()` (disk write + SSE emit)
- [x] llama.cpp `subscribeRun` after `settle()` → `crashed` (not stopped/error) with `exitCode` + stub `classifyServeExit` (`unknown`; tests inject codes)
- [x] Auto-restart once after 2s if healthy ≥30s and code in `{unknown, transient, port_conflict}`; never `oom_vram`
- [x] Module-level 10s heartbeat; 3 failed `/health` with PID alive → `unhealthy`; `tickServeHeartbeatForTests`
- [x] `subscribeServerState` on manager `child.on('exit')`; MLX rows `crashed` (stubbable on Windows)
- [x] `GET /api/models/serve/events`; client `subscribeServeEvents`; store 15s fallback (no 1s poll)
- [x] UI: Crashed / Unhealthy / Stopped / Error + Retry on crashed/error
- [x] `ServeRecord.status` includes `'crashed' | 'unhealthy'`; `publicServe` exposes status, exitCode, failure
- [x] Tests: crash+restart, oom zero restarts, heartbeat, MLX stub, commitServes listeners; existing serve-async / serve-reconcile / mlx-serve
- [x] `documentation/context.md` crashed vs stopped vs error, heartbeat, serve SSE, restart policy

### Phase 2 verify

- Kill `llama-server.exe` from Task Manager → Crashed within ~1 s with exit code.
- Suspend the process → `unhealthy` within ~30 s.
- Kill the MLX python process → MLX rows flip (macOS manual; Windows: stub).
- Unit: fake run emits exit; one restart for `unknown`, zero for `oom_vram`.

---

## Phase 3 — Error classification and guided recovery (2–3 days)

**Depends on:** Phase 1, Phase 2.

Replace `"llama-server exited: <280 chars of grepped log>"` with a title, a cause, and a button.

New pure module `server/models/diagnose-llama-failure.js`:

```
diagnoseLlamaFailure(logTail, exitCode, plan)
  -> { code, title, detail, remediation, retryable, suggestedSettings? }
```

| code | signatures | remediation |
|---|---|---|
| `oom_vram` | `cudaMalloc failed: out of memory`, `ggml_backend_cuda_buffer_type_alloc_buffer`, `ggml_vulkan: Device memory allocation` | Re-run `planLlamaLaunch` with budget cut 15%; attach as `suggestedSettings` |
| `oom_ram` | `std::bad_alloc`, exit `3221226505` (`0xC0000409`) | Lower ctx, smaller quant, offload fewer layers |
| `unsupported_arch` | `unknown model architecture`, `unknown pre-tokenizer type` | Needs newer llama.cpp + deep-link to Phase 0 upgrade |
| `missing_runtime_lib` | exit `3221225781` (`0xC0000135`), `cudart64_*.dll ... not found`, `libcuda.so.1` | Fallback variant via `detectPreferredLlamaVariant`, one-click reinstall |
| `port_conflict` | `EADDRINUSE`, `Only one usage of each socket address` | Automatic retry on a fresh port |
| `bad_template` | `Failed to parse chat template`, `minja` | Automatic retry without `--jinja`; surface `--chat-template` |
| `corrupt_gguf` | `invalid magic`, `gguf_init_from_file failed`, `wrong number of tensors` | Re-download; if `splitCount > 1` with missing siblings, say so |
| `mmap_failed` | `mmap failed`, `failed to open file` | Retry with `--no-mmap` |
| `killed_by_os` | exit 137, SIGKILL | System OOM killer; as `oom_ram` |
| `unknown` | — | Current excerpt, unchanged |

Store `row.failure`, expose via `publicServe`, render title + remediation + action.

#### Phase 3 checklist

- [x] `server/models/diagnose-llama-failure.js` — pure `diagnoseLlamaFailure(logTail, exitCode, plan)` with the taxonomy table
- [x] `classifyServeExit` wraps diagnose (override still works); `oom_vram` never auto-restarts
- [x] `waitForHealth` process-exit path diagnoses; `row.failure` full object; status stays `error` if never healthy
- [x] Load-path one-shot retries: `port_conflict` → `pickFreePort(0)`; `bad_template` → skip `--jinja`
- [x] `publicServe` / `ServeFailure` expose title, detail, remediation, retryable, suggestedSettings
- [x] UI (Local Server, inspector, My Models): title + remediation; Retry with suggested settings (`fit_mode: 'manual'`)
- [x] Table-driven `test/models/diagnose-llama-failure.test.mjs` (harvested llama.cpp signatures)
- [x] `documentation/context.md` failure taxonomy + guided retry

### Phase 3 verify

- Table-driven tests, one fixture log per code (harvested from real llama.cpp output).
- Manual: force an OOM by loading a 70B at 128k in manual mode; suggested retry works.

---

## Phase 4 — Runtime control and sampler passthrough (2–3 days)

**Depends on:** Phase 1.

**Flags** (`llama-args.js`): `--alias <libraryId>`; `--cont-batching` on by default; `--cache-reuse 256` on by default; `-t/--threads` set only when `n_gpu_layers < nLayers`; `--no-mmap`/`--mlock` toggles, default off; `--chat-template`/`--chat-template-file` exposed, auto-surfaced on `bad_template`.

**Fix `extra_args` tokenization.** Add a ~30-line POSIX-ish tokenizer (quotes + escapes) with unit tests. Current whitespace split breaks `--chat-template "..."`.

**Stop stripping samplers.** `sanitize-completion-body.ts` and `server/providers/sanitize-completion-body.js` must change identically. Add `supportsExtendedSamplers` to the provider record, set true in the two llama/mlx upserts, gate the deletes. Test that both implementations agree on a shared fixture table.

**Add `stop` sequences** through `normalizeSamplerPreset` in `server/agents/sampler.js` and into the request body.

#### Phase 4 checklist

- [x] `--alias <libraryId>` on argv when `startServe` has a library id (`buildLlamaServerLaunch` accepts `libraryId`)
- [x] `--cont-batching` on by default; `--cache-reuse 256` on by default (skip if extra_args already sets them)
- [x] `-t/--threads` only when `n_gpu_layers` is set and `< nLayers` (GPU auto with ngl unset: no `-t`)
- [x] `--no-mmap` / `--mlock` settings toggles, default off
- [x] `--chat-template` / `--chat-template-file` on `LlamaServeSettings`; `bad_template` surfaces them
- [x] POSIX-ish `extra_args` tokenizer (quotes + escapes); inspector extra box uses it; unit tests
- [x] `supportsExtendedSamplers` on provider record; true on llama.cpp / mlx-lm upserts (create **and** update)
- [x] Client + server `sanitize-completion-body` keep `top_k` / `min_p` / `repetition_penalty` / `enable_thinking` when that flag is set; hosted OpenAI still strips
- [x] Shared fixture table exercised by both sanitizer tests
- [x] `stop` sequences in `normalizeSamplerPreset` + `samplerToCompletionFields` / request body
- [x] Golden argv: 8B Q4_K_M / 12 GB CUDA / empty settings still `-c 32768 --fit on`, no `-ngl`, plus new defaults
- [x] `documentation/context.md` llama.cpp argv + sampler passthrough updated

### Phase 4 verify

- Send `min_p` to a local serve and confirm it arrives; hosted OpenAI still stripped.

---

## Phase 5 — Download hardening (3–4 days)

**Depends on:** nothing (parallelizable with 1–3).

- **Resume.** `downloadHfFile` (`hf-client.js`): stat `.partial`, `Range: bytes=<size>-`, accept `206` → append; on `200` truncate and restart. **Stop deleting the partial on error** — record `resumeAt`.
- **Stop deleting bytes at startup.** `reconcileInterruptedJobs` (`download.js`): mark `interrupted`, preserve artifacts, auto-requeue. `cleanupJobArtifacts` stays for `cancelled` only (keep the MLX-directory comment).
- **Integrity.** Hash while streaming using `X-Linked-Etag`; verify before `rename`. On resume, re-hash the partial once.
- **Split GGUF.** `resolveGgufFilename` currently returns the first match. Return a list; detect `-(\d{5})-of-(\d{5})\.gguf$`; expand to all shards; assert count. Point `-m` at shard 1. Guard in `validateServeModelTarget` using `splitCount` from `parseGgufHeader`.
- **Queue + ETA.** Replace fire-and-forget `runDownloadJob` with `maxConcurrent = 2` across repos, 1 within a repo. EWMA speed → `bytesPerSec` / `etaMs` on the job (SSE already ships snapshots; UI is render-only).

#### Phase 5 checklist

- [x] `downloadHfFile`: stat `.partial`, `Range: bytes=<size>-`; `206` append; `200` truncate+restart; keep partial on error; record `resumeAt`
- [x] `reconcileInterruptedJobs`: mark `interrupted`, keep artifacts, auto-requeue
- [x] `cleanupJobArtifacts` only for `cancelled` (keep MLX-directory `recursive: true` comment)
- [x] Stream sha256 vs `X-Linked-Etag`; verify before `rename`; re-hash partial once on resume
- [x] Split GGUF: `resolveGgufFilename` returns all shards; `-(\d{5})-of-(\d{5})\.gguf$`; assert count; `-m` at shard 1
- [x] `validateServeModelTarget` guards missing siblings via `parseGgufHeader` `splitCount`
- [x] Queue: maxConcurrent 2 across repos, 1 within a repo; `queued` already in the status union
- [x] EWMA `bytesPerSec` / `etaMs` on the job + SSE snapshot; UI render-only
- [x] Tests: resume Range + sha256; corrupt partial fails hash; split repo downloads all shards
- [x] `documentation/context.md` download resume / split GGUF / queue

### Phase 5 verify

- Kill tool server mid-download, restart, resume from the right offset, matching final sha256.
- Download a known split repo and load it.
- Corrupt a partial and confirm the hash check catches it.

---

## Phase 6 — Residency: LRU keep-alive and TTL (4–5 days)

**Depends on:** Phase 1, Phase 2. Prefer waiting for real usage after 1–3.

Replace `stopExistingLlamaCppServes()` with `admitServe(plan)`:

- `models_max`: 1 under 16 GB budget, 2 at 16–32 GB, 3 above; user-overridable.
- Admission: sum `estimateRunMemory` over resident serves plus the new plan; evict LRU (`lastUsedAt` bumped by `proxy.js`) while over budget or at the cap. Reuse `stopServe`.
- Idle TTL 20 min, on the Phase 2 heartbeat interval.
- JIT reload when a request names a TTL-evicted model, bounded by `MODEL_LOAD_TIMEOUT_MS`, only the most recently evicted model.

**Request admission.** Set `--parallel` from the plan (remembering `-c` is total across slots), pair with `--cont-batching`, and add a priority gate in `proxy.js`: interactive chat passes through, background callers queue behind a semaphore of 1.

#### Phase 6 checklist

- [x] Replace `stopExistingLlamaCppServes()` with `admitServe(plan)` (llama.cpp only; keep MLX single-weights `stopExistingMlxServes`)
- [x] `models_max`: 1 under 16 GB budget, 2 at 16–32 GB, 3 above; user-overridable
- [x] Evict LRU (`lastUsedAt`) while over budget or at cap; reuse `stopServe`
- [x] Idle TTL 20 min on Phase 2 heartbeat; JIT reload only the most recently TTL-evicted model, bounded by `MODEL_LOAD_TIMEOUT_MS`
- [x] Always emit `--parallel` from the launch plan (default 1 unless set); keep `--cont-batching`
- [x] Minnow-side route: pick serve row by `body.model` (`--alias` / libraryId); do **not** llama-server router mode
- [x] Priority gate: interactive chat bypasses; background (benchmark, expander, utility roles) semaphore of 1
- [x] Tests: two models under a 3-cap; chat not starved; TTL then JIT
- [x] `documentation/context.md` residency / TTL / admission

### Phase 6 verify

- Two models resident under a 3-model cap with instant switching.
- Concurrent chat + benchmark without starving the chat stream.
- Idle past TTL then JIT-reload on next request.

---

## Phase 7 — Dedup, MLX depth, hot-path caching (3–4 days)

**Depends on:** all prior phases.

- One `waitForHealth` (keep `manager.js`'s, which takes a `healthPath`).
- One `upsertLocalRuntimeProvider` replacing the two near-identical upserts in `serve.js`.
- **Delete `profileToLlamaArgs`** (`profiles.js`) — after Phase 1 it is a second, unclamped argv path.
- One `RUNTIME_IDS` module replacing `'llama-cpp-local'` / `'mlx-lm-local'` literals.
- Test asserting `server/models/timeouts.js` and `src/models/serve-timeouts.ts` agree.
- **MLX honest loading:** after flipping the row, POST a 1-token completion naming the model and hold `starting` until it returns, bounded by `MODEL_LOAD_TIMEOUT_MS`.
- **Kill the per-request disk walk.** Wrap `enrichMlxLmModelsWithCachedContext` and `listCachedModels` in a 30 s TTL cache invalidated on download completion and model-dir change.
- **Context display:** read `max_position_embeddings` at scan time onto the library row.
- Eject uses `killProcessTreeAndWait` (preserve ancestor-kill guards).
- Verify llama-server release archive digest before extracting.

#### Phase 7 checklist

- [x] One `waitForHealth` helper (`healthPath` + serve.js Phase 3 run-exit diagnose); manager.js calls it
- [x] One `upsertLocalRuntimeProvider` replacing llama/mlx upserts in `serve.js`
- [x] Delete `profileToLlamaArgs`; update tests that imported it
- [x] One `RUNTIME_IDS` module for `'llama-cpp-local'` / `'mlx-lm-local'`
- [x] Test: `server/models/timeouts.js` and `src/models/serve-timeouts.ts` agree
- [x] MLX honest loading: hold `starting` until 1-token warmup completion returns (`MODEL_LOAD_TIMEOUT_MS`); Windows-stubbable
- [x] 30 s TTL cache on `listCachedModels` / `enrichMlxLmModelsWithCachedContext`; invalidate on download complete + model-dir change
- [x] `max_position_embeddings` on the library row at scan time
- [x] Eject uses `killProcessTreeAndWait`; keep ancestor-kill guards
- [x] Verify llama-server release archive digest before extract; unit test
- [x] `documentation/context.md` updated

---

## Sequencing

| Phase | Delivers | Size | Depends on |
|---|---|---|---|
| 0 | Runtime upgrade path; MLX install DTO; memoized probe | 0.5 d | — |
| 1 | Fit-aware defaults + persisted per-model settings | 4–6 d | 0 |
| 2 | Crash watcher, heartbeat, serve SSE | 3–4 d | 0 |
| 3 | Error taxonomy + guided retry | 2–3 d | 1, 2 |
| 4 | Flags, arg tokenizer, sampler passthrough | 2–3 d | 1 |
| 5 | Download resume, checksum, split-GGUF, queue, ETA | 3–4 d | — |
| 6 | LRU residency, TTL, request admission | 4–5 d | 1, 2 |
| 7 | Dedup, MLX depth, hot-path caching | 3–4 d | all |

**Phases 1–3 are the "feels like LM Studio" delta.** Phase 5 is independent. Phase 6 should wait for real usage after 1–3.

## Orchestration log

- 2026-08-16: Plan filed. Phase 0 implement → verify starting.
- 2026-08-16: **Phase 0 VERDICT: PASS** (verifier 2d1da7aa). Tests 14/14 + servers 35/35 + tsc. Live Settings UI not exercised (desktop app is the main checkout). Manual QA: Settings → Servers upgrade hint + MLX Install hidden on Windows.
- 2026-08-16: Phase 1a implement starting (GGUF header into `startServe` / `buildLlamaServerArgs`).
- 2026-08-16: **Phase 1a VERDICT: PASS** (verifier e9626c25). startServe reads GGUF header (llama-cpp only, null-tolerant); buildLlamaServerArgs forwards ggufMeta; ngl=999/--fit off unchanged.
- 2026-08-16: **Phase 1b VERDICT: PASS** (verifier 45e07fb5). planLlamaLaunch 56/56 + tsc. GPU auto ngl=null; 8B@8GB → 12288 f16; ctxPerSlot ≤ trainCtx. Not wired into argv yet.
- 2026-08-16: Phase 1c implement complete — verifier next. Not starting 1d.
- 2026-08-16: Phase 1c leftovers: `test/models/inspector-launch.test.mts`; context.md 1c argv (`--flash-attn`, no `--swa-full`, launch return shape). Todos table **done**.
- 2026-08-16: Phase 1d implement complete — verifier next. Not starting Phase 2.
- 2026-08-16: **Phase 1c VERDICT: PASS** (verifier 940a79b0). **Phase 1d VERDICT: PASS** (verifier b0fc5b5b). Phase 1 complete.
- 2026-08-16: Phase 4 implement starting (runtime flags, extra_args tokenizer, sampler passthrough). Not starting Phase 5.
- 2026-08-16: **Phase 4 VERDICT: PASS** (verifier 0652513a). Golden argv still `--fit on` / no `-ngl`; `--cont-batching` `--cache-reuse 256`; min_p kept locally, hosted stripped. Phase 5 next.
- 2026-08-16: Phase 5 implement starting (download resume, checksum, split-GGUF, queue, ETA). Not starting Phase 6.
- 2026-08-16: **Phase 5 VERDICT: PASS** (verifier f9141294; first verify FAIL dbeea6f8 on leftover mlx-download-cleanup tests, retry e710c032). Resume Range + etag + split 00001 + queue 2/1. Phase 6 next.
- 2026-08-16: Phase 6 implement starting (LRU residency, TTL, request admission). Not starting Phase 7.
- 2026-08-16: **Phase 6 VERDICT: PASS** (verifier 3b017624). Two residents + model-id routing; TTL+JIT; background semaphore. Phase 7 next.
- 2026-08-16: Phase 7 implement starting (dedup, MLX warmup, hot-path cache, digest). Last phase.
- 2026-08-16: **Phase 7 VERDICT: PASS** (verifier 4208c381). Shared waitForHealth; `profileToLlamaArgs` gone; MLX warmup; 30s scan TTL; archive digest. Phases 0–7 complete. Not committed. Merge-back: `/apply-worktree`.
- 2026-08-16: Phase 2 implement complete — verifier next. Not starting Phase 3.
- 2026-08-16: Phase 3 implement complete — verifier next. Not starting Phase 4.
- 2026-08-16: Phase 1a implement complete — verifier next.
- 2026-08-16: Phase 1b implement complete — verifier next. Not wired into argv (1c).
