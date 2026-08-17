# Local model runtimes — LM Studio parity (llama.cpp)

> **This document covers the llama.cpp path.** MLX has its own plan at
> [`local-models-mlx-parity.md`](local-models-mlx-parity.md), written once Apple Silicon testing
> became available. Items marked **[shared]** there are implemented here and consumed by both.

## Context

Running local models in Minnow "feels janky and has issues constantly." An audit of both
runtimes found the cause is not one bug but a consistent pattern: **Minnow computes good
information and then throws it away at the moment of launch.**

Three verified examples set the theme:

- `src/models/memory-model.mjs` is a careful, well-tested estimator. Its
  `maxContextForBudget()` is called from exactly one place — `src/models/fit.ts:319`, which
  renders *display text* in Discover. It never influences an actual launch.
- `server/models/gguf-metadata.js:406` parses `trainCtx`, the model's own trained context
  limit. **Nothing reads it.** Exceeding it silently produces garbage output, which users read
  as "this model is bad."
- `server/models/profiles.js:131` computes `fits` for each profile, then emits `ngpu: 999` and
  `ctx: 125_000` regardless. The fit result is a string in a tooltip.

The sharpest instance: `server/models/llama-args.js:132-145` passes **`--fit off`** and
`-ngl 999` on every load. llama.cpp has a native auto-fit that sizes unset arguments to
device memory — Minnow explicitly disables it and then demands full GPU offload at 125k
context. The one code path that *does* pass `fit: true` is onboarding
(`src/onboarding/managed-setup.ts:179`). So the first model a user loads is auto-fitted and
works; every model they load afterwards from My Models has the safety net switched off.

Verified on a dev machine: the installed runtime was **b9628** while the code pins **b10448**,
because `ensureLlamaServer()` (`server/models/llama-runtime.js:407`) compares only the
*variant*, never the version. Bumping `LLAMA_CPP_RELEASE_TAG` never upgrades an existing
install, so the Qwen3.8 `qwen35` arch support the pin was raised for never arrives.

Outcome intended: local models load on the first try at settings that fit the machine, tell
you plainly when they don't, remember what you set, survive a crash visibly, and stop
re-downloading 20 GB from byte zero.

**Scope:** full LM Studio parity, but *not* the llama-server router-mode rearchitecture (see
Non-goals). MLX is covered separately.

### Relationship to `gpu-layers-fit-fix.md`

That plan added `--fit off` deliberately, to resolve
`failed to fit params to free device memory: n_gpu_layers already set by user to 999, abort`.
It fixed the argv conflict correctly, but treated the symptom rather than the cause: `-ngl 999`
should not be the default in the first place. **Phase 1 below intentionally reverses that
decision** by generalizing the `fit: true` (onboarding) branch to all loads. `--fit off` remains
for explicit manual overrides. `test/models/llama-args.test.mjs` encodes the old behaviour and
must be updated alongside.

---

## Phase 0 — Free wins (~0.5 day)

- **Runtime version drift.** `ensureLlamaServer()` (`llama-runtime.js:407`) returns the existing
  binary unless `reinstall` or a variant mismatch. Add a version comparison against
  `LLAMA_CPP_RELEASE_TAG` using the `version` field already written to `meta.json:519-533`.
  Offer an upgrade (don't force one mid-session) and surface it in the runtime status DTO.
- **MLX shows a broken Install button on Windows/Linux [shared].** `manager.js` `listServers()`
  L479-511 builds its DTO field-by-field and drops `supported` / `installable` / `reason`, which
  `mlx-lm.js:235-243` `getExtendedStatus()` already computes. Add the three fields; gate the
  button in `src/ui/settings-servers-section.ts:669`.
- **Memoize the capability probe.** `detectLlamaThinkingBudgetSupport()` (`llama-runtime.js:580`)
  spawns `llama-server --help` with a 15 s timeout on *every* successful load. Cache by binary
  path in a module-level `Map`, cleared by the existing runtime-install reset hook.

---

## Phase 1 — Launch settings that fit (4–6 days) ← the main event

### 1a. Plumb the GGUF header into the launch path

`computeServeProfiles()` already accepts `opts.ggufMeta` and prefers
`geometryFromGgufMetadata()` over heuristics — and `server/models/routes.js:254` passes it.
**`startServe()` does not.** So the inspector previews from exact headers while the actual
launch plans from parameter-count guesses.

In `serve.js` `startServe()`, after `validateServeModelTarget`, call `readGgufMetadata(modelPath)`
(already LRU-cached, `gguf-metadata.js:427`) and thread it through `buildLlamaServerArgs`.
Roughly three lines; unlocks exact `nLayers`, `layerBytes`, `swaWindow`, `trainCtx`, `splitCount`.

### 1b. New module `src/models/launch-plan.mjs` (+ `.d.mts`)

Must run server-side (so both load paths benefit) and client-side (so the inspector can
preview). That is exactly why `memory-model.mjs` and `model-geometry.mjs` are `.mjs` + `.d.mts`
imported raw by the server — follow that convention. `src/models/fit.ts` is TypeScript and the
server cannot import it.

```
planLlamaLaunch({ geometry, weightsBytes, trainCtx, hardware, variant, parallel, requested })
  -> { ctx, ctxPerSlot, n_gpu_layers, cache_type, flash_attn, fits, estimateGb, reason, clampedFrom }
```

**Let llama.cpp size the GPU split; Minnow sizes the context.** This is the key design choice
and it differs from the obvious approach of computing layer counts ourselves. `--fit` only
adjusts *unset* arguments, and llama.cpp reads true free device memory at load time — which
Minnow's estimator, however good, is guessing at. So in auto mode:

- Pass **`--fit on`** and leave `-ngl` unset, letting llama.cpp pick the layer split.
- Use `--fit-ctx` (min ctx auto-fit may choose, default 4096) and `--fit-target` (per-device
  margin) to steer it. Both confirmed present in the b9628 build, so they predate the pin.
- Minnow still computes and passes `-c`, because context is the parameter with a *semantic*
  ceiling (`trainCtx`) that llama.cpp will happily exceed.

This makes the estimator's job advisory — preview, explanation, warnings — rather than
load-bearing, which is where it belongs.

**Context algorithm:**

1. **Budget.** GPU variant with `gpuVramGb > 0`: `gpuVram*GIB - max(0.9 GiB, gpuVram*GIB*0.08)`.
   The fixed floor matters on Windows, where WDDM plus the Minnow UI routinely hold ~1 GB;
   `profiles.js`'s flat `*0.92` is too optimistic at 8 GB. CPU: `min(availableRam*0.70,
   totalRam*0.55) * GIB`.
2. **Uncertainty headroom.** Divide by `GEOMETRY_UNCERTAINTY[geometry.source]`
   (`model-geometry.mjs`, already used at `fit.ts:302`) — `gguf` → 1.0, guesses get margin.
3. **Target.** `min(trainCtx || 8192, PREFERRED_CONTEXT_TOKENS)` where
   **`PREFERRED_CONTEXT_TOKENS = 32_768`**, replacing the 125k default. 32k is where agentic
   tool use stops feeling cramped while its f16 KV still leaves room for weights on a 12–16 GB
   card. Keep `DEFAULT_CONTEXT_TOKENS` exported but deprecated to avoid a wide rename.
4. **`trainCtx` is a hard ceiling.** Never plan above it; cap the UI slider at it and label the cap.
5. **Fit to budget** via `maxContextForBudget(geometry, kvBudget, cacheType)` — its first real use.
6. **Snap down to a ladder**: `[4096, 6144, 8192, 12288, 16384, 24576, 32768, 49152, 65536,
   98304, 131072, 196608, 262144]`. Kills the `step: 1000` non-power-of-two contexts from
   `inspector.ts:53-55`.
7. **Degradation** if 4096 won't fit at f16: `cache_type` f16 → q8_0 → q4_0, then report
   `fits: false` with a structured reason. Default stays **f16** — quantized KV is a real
   quality loss and should be a response to pressure, not a default.
8. **`--parallel` divides `-c` across slots.** Emit `ctx = ctxPerSlot * parallel` and show
   *per-slot* context in the UI. Getting this backwards silently quarters usable context.
9. **`--flash-attn`.** `memory-model.mjs:182-184` explicitly assumes it is on; it is currently
   never passed. Pass `on` for cuda/metal/rocm, `auto` for vulkan/cpu. Do not pass `auto` on
   CUDA — if it resolves to off, the estimate is optimistic and you OOM.
10. **Do not pass `--swa-full`** — it would invalidate the estimator's SWA modelling.

### 1c. Where the clamp lives

**Server-side, inside `buildLlamaServerArgs()`** (`llama-args.js:95`), right after
`mergeSettings()` at L127, replacing the unconditional `n_gpu_layers = 999` at L132-145.

`src/ui/models/library-panel.ts:250` calls `loadModel(model)` with **no settings** while the
inspector calls `loadModel(model, settingsFor(model))`. A client-side clamp would leave the
library Load button broken. `buildLlamaServerArgs` is the one funnel both share, and
`/api/models/profiles` calls it too (`routes.js:263`), so the preview updates for free.

**Keeping it overridable** needs an ordering fix: `settingsFor()` (`inspector.ts:258-266`)
eagerly materializes `{ctx: 125000, n_gpu_layers: 999, cache_type: 'f16'}`, so from the server
every load looks like a deliberate user choice. Change it to return `{}` until a control is
touched, and render the server-computed plan as the initial slider position. Then add
`fit_mode: 'auto' | 'manual'` to `LlamaServeSettings`:

- `auto` (default) — planner owns ctx / n_gpu_layers / cache_type; `batch_size`, `parallel`
  etc. still pass through. Emits `--fit on` with `-ngl` unset.
- `manual` — pass through unclamped with `--fit off` (preserving `gpu-layers-fit-fix.md`'s
  conflict resolution), but still run the planner and write a warning line into the serve log
  before spawn when the estimate exceeds budget by >1.25×. Phase 3's classifier reads it back,
  so a later OOM says "you overrode the fit planner."

### 1d. Persist per-model launch settings

`draftSettings` is a module-level `Map` (`inspector.ts:67`) — lost on reload. Per-model
*sampler* prefs already persist correctly via `server/models/inference-prefs.js` into
`config.json` → `models.inference.byLibraryId`, with `GET`/`PUT /api/models/inference` at
`routes.js:204-229`.

Mirror that exactly: add `models.launch.byLibraryId`, a `server/models/launch-prefs.js` shaped
like `inference-prefs.js`, and a matching route pair. `startServe` merges saved prefs as a
layer between `defaults` and `settings`. Then fix `library-panel.ts:250` to pass
`settingsFor(model)` so both entry points are identical.

### Verify

- Unit tests on `planLlamaLaunch`: fixture geometries (8B dense, 30B-A3B MoE, Gemma-style SWA)
  × budgets (6/8/12/24/96 GB) × variants. Assert monotonicity, ladder membership,
  `ctx <= trainCtx`, and `estimateRunMemory(plan).totalBytes <= budget`.
- Update `test/models/llama-args.test.mjs` for the reversed `--fit` default; add golden-argv
  cases for auto and manual modes.
- Manual: load a model that previously OOM'd; confirm the emitted argv in the serve log matches
  the inspector preview.

---

## Phase 2 — Supervision and honest state (3–4 days)

Today a mid-session OOM leaves `serves.json` saying `running` forever, and the UI keeps showing
Ready. Reconciliation runs only at boot (`serve.js:153`), per
[`MIN-562-models-stale-after-restart.md`](MIN-562-models-stale-after-restart.md), which
explicitly deferred live health polling.

- **Crash watcher.** `subscribeRun`/`waitForRun` exist at `terminal-runner.js:682/696` and
  `serve.js` imports neither. In `settle()`, after promoting to `running`, subscribe and on exit
  set a new status **`crashed`** — distinct from `stopped` (user) and `error` (failed to load) —
  recording `exitCode` and the Phase 3 classification.
- **Restart policy, deliberately narrow.** Auto-restart once, after 2 s, only when the serve was
  healthy ≥30 s and the classification is `{unknown, transient, port_conflict}`. Never
  auto-restart an OOM — it will just OOM again. Everything else gets a Retry button.
- **Heartbeat.** One module-level 10 s interval (not one per serve) polling `/health` for
  `running` rows. Three consecutive failures with the PID alive → `unhealthy`. Catches the
  wedged-CUDA-context case that no exit event reports.
- **MLX crash propagation [shared].** Add `subscribeServerState(serverId, cb)` to `manager.js`,
  fired from the existing `child.on('exit')` at L686. `serve.js` subscribes for `mlx-lm` and
  marks MLX rows `crashed`. Pure state machinery — testable without Apple silicon by stubbing
  the manager.
- **Serve SSE.** Add `GET /api/models/serve/events`, modelled directly on the serve-log SSE
  already at `routes.js:370-393`. Wrap every `saveServes()` call in a `commitServes(reason)`
  helper that emits, so no future mutation can forget. Client: `subscribeServeEvents()` beside
  the existing `subscribeServeLog` (`api-client.ts:437`); `trackLoad` drops its 1 s interval.
  Keep a 15 s reconciling poll as fallback. **Only the models/serve surface moves to SSE** —
  git-panel, code-overview and dev-server polls stay as they are.

**Verify:** kill `llama-server` mid-session → Crashed within ~1 s with the exit code. Suspend the
process → `unhealthy` within ~30 s. Kill the MLX python process → MLX rows flip. Unit test: fake
run emits exit; assert one restart for `unknown`, zero for `oom_vram`.

---

## Phase 3 — Error classification and guided recovery (2–3 days)

Replace `"llama-server exited: <280 chars of grepped log>"` (`summarizeLlamaLogTail`,
`serve.js:241`) with a title, a cause, and a button.

New pure module `server/models/diagnose-llama-failure.js` — no I/O, trivially unit-testable,
consumed by the `waitForHealth` exit branch, the Phase 2 crash watcher, and `manager.js`:

```
diagnoseLlamaFailure(logTail, exitCode, plan)
  -> { code, title, detail, remediation, retryable, suggestedSettings? }
```

| code | signatures | remediation |
|---|---|---|
| `oom_vram` | `cudaMalloc failed: out of memory`, `ggml_backend_cuda_buffer_type_alloc_buffer`, `ggml_vulkan: Device memory allocation` | Re-run `planLlamaLaunch` with budget cut 15%; attach as `suggestedSettings`. "Needs ~11.2 GB, ~7.6 GB free — retry at 8192 ctx?" one click |
| `oom_ram` | `std::bad_alloc`, exit `3221226505` (`0xC0000409`) | Lower ctx, smaller quant, offload fewer layers |
| `unsupported_arch` | `unknown model architecture`, `unknown pre-tokenizer type` | "Needs a newer llama.cpp than the installed build" + deep-link to the Phase 0 upgrade |
| `missing_runtime_lib` | exit `3221225781` (`0xC0000135`), `cudart64_*.dll ... not found`, `libcuda.so.1` | Propose a fallback variant via `detectPreferredLlamaVariant` (`llama-variant.js:199`), one-click reinstall |
| `port_conflict` | `EADDRINUSE`, `Only one usage of each socket address` | **Automatic** retry on a fresh port — also neutralises the `pickFreePort` TOCTOU (`serve.js:217`) for a fraction of the cost of fixing it properly |
| `bad_template` | `Failed to parse chat template`, `minja` | Automatic retry without `--jinja`; surface `--chat-template` |
| `corrupt_gguf` | `invalid magic`, `gguf_init_from_file failed`, `wrong number of tensors` | Re-download; **and** if `splitCount > 1` with missing siblings, say so — this is where the Phase 5 split-GGUF defect becomes visible |
| `mmap_failed` | `mmap failed`, `failed to open file` | Retry with `--no-mmap` |
| `killed_by_os` | exit 137, SIGKILL | System OOM killer; as `oom_ram` |
| `unknown` | — | Current excerpt, unchanged |

Passing `plan` in is what makes the OOM message quantitative instead of a shrug. Store
`row.failure`, expose via `publicServe` (`serve.js:298`), render title + remediation + action.

**Verify:** table-driven tests, one fixture log per code, harvested from real llama.cpp output.
Manual: force an OOM by loading a 70B at 128k in manual mode; confirm the suggested retry works.

---

## Phase 4 — Runtime control and sampler passthrough (2–3 days)

**Flags** (`llama-args.js`): `--alias <libraryId>` (stable `/v1/models` id — removes a class of
picker-rebinding bugs in `model-select-library.ts`); `--cont-batching` on by default;
`--cache-reuse 256` on by default (large prompt-processing win for agentic loops with a stable
system prefix — a big part of why LM Studio "feels fast" on turn two); `-t/--threads` set only
when `n_gpu_layers < nLayers`; `--no-mmap`/`--mlock` toggles, default off;
`--chat-template`/`--chat-template-file` exposed, auto-surfaced on `bad_template`.

**Fix `extra_args` tokenization.** The free-text box (`inspector.ts:441`) is whitespace-split
(`llama-args.js:223-227`), so `--chat-template "..."` breaks. No shell tokenizer exists in the
repo. Add a ~30-line POSIX-ish tokenizer handling quotes and escapes, with unit tests.

**Stop stripping samplers [shared].** `sanitize-completion-body.ts:98-101` deletes `top_k`,
`min_p`, `repetition_penalty`, `enable_thinking` for **all** `openai-v1` providers, mirrored in
`server/providers/sanitize-completion-body.js`. Both local runtimes support them. The strip
exists for hosted endpoints that 400 on unknown fields, so make it capability-driven: add
`supportsExtendedSamplers` to the provider record, set true in the two upserts
(`serve.js:363/397`), gate the deletes on it. **Both copies must change identically** — add a
test asserting the two implementations agree on a shared fixture table.

**Add `stop` sequences [shared]**, which exist nowhere today: plumb `stop: string[]` through
`normalizeSamplerPreset` in `server/agents/sampler.js` and into the request body.

**Verify:** send `min_p` to a local serve and confirm it arrives; confirm hosted OpenAI still
gets it stripped.

---

## Phase 5 — Download hardening (3–4 days, parallelizable)

- **Resume.** `downloadHfFile` (`hf-client.js:178`) always starts at byte 0. Stat the `.partial`,
  send `Range: bytes=<size>-`, accept `206` → append; on `200` truncate and restart. **Stop
  deleting the partial on error** (L211-215) — record `resumeAt` instead.
- **Stop deleting bytes at startup.** `reconcileInterruptedJobs` (`download.js:114`) marks jobs
  failed *and deletes the partial*. Change to `interrupted`, artifacts preserved, auto-requeued.
  `cleanupJobArtifacts` keeps current behaviour for `cancelled` only — preserve its MLX-directory
  comment, which is correct.
- **Integrity.** HF returns `X-Linked-Etag` (sha256 of the LFS object), never read today. Hash
  while streaming, verify before `rename`. On resume, re-read the partial through the hasher
  once (disk-bound, far cheaper than re-downloading).
- **Split GGUF — currently produces silently broken models.** `resolveGgufFilename`
  (`hf-client.js:90`) returns the *first* match, so a repo whose only Q4_K_M is
  `-00001-of-00003.gguf` downloads one shard and the library lists it as servable. Return a
  list; detect `-(\d{5})-of-(\d{5})\.gguf$`; expand to all shards and assert the count. Point
  `-m` at shard 1 (llama.cpp auto-loads siblings). Add a guard in `validateServeModelTarget`
  (`serve.js:458`) using the `splitCount` `parseGgufHeader` already returns.
- **Queue + ETA.** Replace the two `void runDownloadJob(job)` fire-and-forgets
  (`download.js:298,344`) with `maxConcurrent = 2` across repos, 1 within a repo — the `'queued'`
  status already exists in the type union and is simply never honored. EWMA speed → `bytesPerSec`
  / `etaMs` on the job; the SSE already ships job snapshots so the UI change is render-only.

**Verify:** kill the tool server mid-download, restart, confirm resume from the right offset and
a matching final sha256. Download a known split repo and load it. Corrupt a partial and confirm
the hash check catches it.

---

## Phase 6 — Residency: LRU keep-alive and TTL (4–5 days)

`stopExistingLlamaCppServes()` (`serve.js:326`) kills every running serve before each start, so
switching models is always a full reload. Meanwhile `server-panel.ts:300` and `models-page.ts:74`
render "N models serving" UI for a state that cannot occur.

Replace with `admitServe(plan)`:

- `models_max`: 1 under 16 GB budget, 2 at 16–32 GB, 3 above; user-overridable.
- Admission: sum `estimateRunMemory` over resident serves plus the new plan; evict LRU
  (`lastUsedAt` bumped by `proxy.js`) while over budget or at the cap. Reuse `stopServe` so
  provider teardown stays in one place.
- Idle TTL 20 min, on the same interval as the Phase 2 heartbeat.
- JIT reload when a request names a TTL-evicted model, bounded by `MODEL_LOAD_TIMEOUT_MS`, only
  for the most recently evicted model to avoid thrash.

**Request admission.** `--parallel` is unset (1 slot) and `--cont-batching` never passed, while
chat, sub-agents, the prompt expander, inline completion and the benchmark all POST concurrently.
Set `--parallel` from the plan (remembering `-c` is the *total* across slots), pair with
`--cont-batching`, and add a priority gate in `proxy.js`: interactive chat passes through,
background callers queue behind a semaphore of 1. This fixes the felt symptom — chat stalling
behind a benchmark — which `--parallel` alone does not, since llama.cpp's queue is FIFO with no
priority.

**Verify:** two models resident under a 3-model cap with instant switching; concurrent chat +
benchmark without starving the chat stream; idle past TTL then JIT-reload on next request.

---

## Phase 7 — Dedup, MLX depth, hot-path caching (3–4 days)

**Targeted dedup only:** one `waitForHealth` (keep `manager.js:188`'s, which takes a
`healthPath`); one `upsertLocalRuntimeProvider` replacing the two near-identical upserts
(`serve.js:363/397`); **delete `profileToLlamaArgs`** (`profiles.js:150`) — after Phase 1 it is a
second, unclamped argv path, i.e. a latent bug; one `RUNTIME_IDS` module replacing
`'llama-cpp-local'`/`'mlx-lm-local'` literals in 6+ places; a test asserting
`server/models/timeouts.js` and `src/models/serve-timeouts.ts` agree, since they cross a process
boundary. `downloadHfFile`/`downloadHfRepoFile`'s ~55 shared lines collapse naturally in Phase 5.

**Hot paths [shared]:** `enrichMlxLmModelsWithCachedContext` (called from `proxy.js:61-63`) does
a full recursive scan on *every* `/v1/models` call; `listCachedModels` (`cached.js:742`) is
likewise uncached. Wrap both in a 30 s TTL cache invalidated on download completion and
model-dir change — same shape as the existing `gguf-metadata.js` Map cache.

**Small hardening:** eject uses `taskkill /T /F` with no grace though `killProcessTreeAndWait`
(`terminal-runner.js:1116`) exists — switch to it, preserving the ancestor-kill guards. Verify
the llama-server release archive digest before extracting.

---

## Explicit non-goals

1. **llama-server router mode.** It is orthogonal to every defect users actually feel; it fights
   Phase 1 (per-model args move into a `--models-preset` INI, and you lose per-model spawn env,
   sibling-mmproj discovery, and per-model logs that the SSE stream and Phase 3's classifier all
   depend on); it concentrates blast radius (one fault takes down every resident model) while
   still needing Phase 2's supervision anyway; and it discards `terminal-runner.js`, a mature
   supervisor, for a worse one inside a binary you don't control. Revisit only as an *optional
   backend* if heterogeneous concurrent residency becomes the top complaint.
2. **A `LocalRuntime` interface.** Premature at n=2, where the two implementations differ in
   every dimension that matters. Phase 7 captures the real duplication without committing to a
   shape. Design it against three data points when a third runtime lands.
3. **Bumping `LLAMA_CPP_RELEASE_TAG`** — Phase 0 fixes the *upgrade mechanism*; changing the pin
   itself is a separate, separately-verifiable change. Bundling makes regressions ambiguous.
4. **Multi-GPU auto-tuning** — `--tensor-split`/`--main-gpu`/`--split-mode` stay manual.
5. **Speculative decoding, in-app quantization, a new download backend** (hf_transfer/aria2),
   **replacing `terminal-runner.js`**.
6. **A global poll→SSE migration** — only the models/serve surface moves.
7. **Real load-progress percentages.** `parseLoadProgress` (`serve-log.ts:23`) regexes for a `%`
   current builds don't print for GGUF; the honest fix is upstream. Instead drive a *time-based*
   estimate from file size and the observed load rate of previous loads of the same file, stored
   with the Phase 1d launch prefs. Approximate but monotonic and honest.

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
| 7 | Dedup, hot-path caching | 3–4 d | all |

**Phases 1–3 are the "feels like LM Studio" delta.** Phase 5 is independent and can run in
parallel. Phase 6 should wait for real usage after 1–3 — single-model-at-a-time may stop being
the top complaint once loads simply work.

---

## Verification

Per-phase checks are listed above. End-to-end, after Phases 1–3:

```bash
npm test -- --test-force-exit
```

Note: test runs rewrite fixture files (so `git stash pop` fails after them), and a few suites
fail on clean `main` — a non-zero exit is not by itself a regression. New tests using
`mock.module` must be registered as `tsx-mocks` in `test-config.mjs`, or module mocking is
silently disabled.

Manual pass (Windows 11, CUDA):

1. Load a model from **My Models** that previously failed → starts on the first try; the argv in
   the serve log matches the inspector preview.
2. Set a non-default context in the inspector, reload the app → the setting survives.
3. Load a model at deliberately absurd settings in `manual` mode → a classified OOM with a
   concrete suggested retry that works.
4. Kill `llama-server.exe` from Task Manager mid-generation → UI shows Crashed within ~1 s.
5. Start a large download, kill the tool server, restart → resumes rather than restarting at 0.
6. Download a split-GGUF repo → all shards arrive and the model loads.
