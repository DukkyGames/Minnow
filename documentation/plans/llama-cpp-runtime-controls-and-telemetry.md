# llama.cpp runtime controls and telemetry — LM Studio parity, part 2

> Follow-up to [`local-model-runtimes-lm-studio-parity.md`](local-model-runtimes-lm-studio-parity.md)
> (complete). That plan made local loads *succeed*. This one makes them *legible and
> drivable*: full launch-settings parity, speculative decoding incl. MTP, a real load
> progress bar, and live runtime telemetry on every surface.

Status: **complete — Phases 0–5 (2026-08-18/19).**

## Context

Minnow already spawns and supervises `llama-server` well (auto fit planning, crash
diagnosis, launch prefs, memory meter). What it does not do is *tell the user what is
happening* or *let the user drive the runtime*. Five concrete gaps:

1. The inspector Load tab exposes ~8 knobs. The bundled llama.cpp exposes ~60. LM Studio
   surfaces roughly 25 of them; Minnow surfaces a third of that.
2. No speculative decoding at all — including MTP, which this build supports natively.
3. The loading bar is an indeterminate bouncing strip. `LoadProgress.percent` is `null`
   in practice because `parseLoadProgress` looks for a `%` that llama.cpp never prints.
4. Nothing anywhere shows prompt-processing progress or generated-token counts — not on
   the Loaded Models card, not in chat.
5. The header model dropdown shows a static load dot and nothing about live activity.

### Runtime under test

`~/.minnow/models-runtime/llama-cpp/llama-server.exe` — **version 9628 (c2ba3e47a)**,
CUDA 12.4 variant, built with Clang 20.1.8. Every finding below was taken from this
binary on the author's machine (RTX 4090 24 GB, i9-14900K, 64 GB RAM).

### Decisions taken

- Load progress: **hybrid** — a time/bytes ETA model as the spine, snapped forward by
  parsed log phase floors. Monotonic, never fabricates 100%.
- Settings UI: **extend the existing inspector Load tab**, not a new pre-load modal.
- Live activity: **poll `/slots` server-side**, so the panels reflect all traffic
  (external API clients and agents included), not just Minnow's own chat.
- One phased plan, built in dependency order.

---

## Phase 0 — Hardware probe — **COMPLETE (2026-08-18)**

Probed with `unsloth/Qwen3.5-9B-MTP-GGUF/Qwen3.5-9B-Q4_K_M.gguf` (5.87 GB, MTP-capable)
against a hand-launched `llama-server` on ports 8099/8100. Raw captures are throwaway;
the conclusions below are the contract Phases 1–5 build on.

### 0.1 `/slots` — confirmed shape, and it is thinner than assumed

`--slots` is **enabled by default** in this build (`--slots, --no-slots ... (default: enabled)`).

**Idle** — four fields, nothing else:

```json
[{"id":0,"n_ctx":16384,"speculative":false,"is_processing":false}]
```

**Busy** — adds `id_task`, three prompt counters, the full resolved sampler `params`
block, and `next_token`:

```json
{"id":0,"n_ctx":16384,"speculative":false,"is_processing":true,"id_task":1305,
 "n_prompt_tokens":10240,"n_prompt_tokens_processed":10240,"n_prompt_tokens_cache":0,
 "params":{ "...":"seed, temperature, top_k, …, speculative.types, timings_per_token" },
 "next_token":[{"has_next_token":false,"has_new_line":false,"n_remain":0,"n_decoded":60}]}
```

**Correction to the original plan — `/slots` cannot produce a prefill percentage.**
There is no `prompt_progress` key anywhere in `/slots`, and during prefill
`n_prompt_tokens` **mirrors** `n_prompt_tokens_processed`, both climbing in `n_batch`
(2048) steps. Observed on a 16 360-token prompt, at 250 ms cadence:

| t (ms) | `n_prompt_tokens` | `n_prompt_tokens_processed` | `next_token[0].n_decoded` |
|---|---|---|---|
| 0 | 2048 | 2048 | 60 *(stale — previous task)* |
| +313 | 4096 | 4096 | 60 |
| +563 | 6144 | 6144 | 60 |
| … | … | … | … |
| +1874 | 15844 | 15844 | 60 |
| +2081 | **16364** | 16360 | **5** *(n_remain 295 — generating)* |

The true denominator only lands on the sample where prefill ends. So:

- **Prefill from `/slots` is a growing token count, not a percent.** Surfaces must say
  `Processing prompt · 10,240 tokens`, not `43%`. A percent for Minnow's *own* chat comes
  from the stream instead (0.2).
- **`next_token[0].n_decoded` is stale during prefill** — it holds the previous task's
  final count. Gate generation display on `n_remain > 0`, and reset on `id_task` change.
- **No tok/s field.** The poller derives it from Δ`n_decoded` / Δt.
- `/slots` **blocks while the server is saturated** — a 5 s `curl` returned nothing when
  two servers were contending for the GPU. The poller must treat timeouts as "unknown",
  never as "idle".

### 0.2 Streaming prompt progress — the opt-in is `return_progress: true`

Three variants streamed against the same 10 020-token prompt, counting chunks carrying
`prompt_progress`:

| Request body | `prompt_progress` chunks |
|---|---|
| *(neither field)* | **0** |
| `"return_progress": true` | **11** ✅ |
| `"stream_options": {"include_progress": true}` | **0** |

`return_progress` is a **top-level request field** and is absent from `--help`, but it
works. `stream_options.include_progress` is silently ignored.

Shape, and **`total` is present in the very first chunk** — a real percentage is
available to chat from token zero (fresh 16 360-token prompt, `--cache-ram 0`):

```
t=0.050s  {"total":16360,"cache":0,"processed":0,     "time_ms":2}
t=0.335s  {"total":16360,"cache":0,"processed":2048,  "time_ms":288}
t=0.584s  {"total":16360,"cache":0,"processed":4096,  "time_ms":537}
…
t=2.262s  {"total":16360,"cache":0,"processed":16360, "time_ms":2214}
```

`cache` is the prefix served from the prompt cache — on a repeat prompt it came back
`{"total":10020,"cache":10016,"processed":10016}`, i.e. **progress must be rendered as
`processed / total`, with `cache` explaining why it can start near 100%**.

`timings_per_token: true` attaches `timings` to **every** chunk:

```json
{"cache_n":0,"prompt_n":16360,"prompt_ms":2225.592,"prompt_per_token_ms":0.136,
 "prompt_per_second":7350.85,"predicted_n":2,"predicted_ms":12.804,
 "predicted_per_token_ms":6.402,"predicted_per_second":156.20}
```

### 0.3 The `prompt processing … progress =` log line does **not** print

`grep`ping the binaries finds the format string in `llama-server-impl.dll`
(`prompt processing, n_tokens = %6d, progress = %.2f`), but it never reached the log —
not at the default verbosity, and not at `-lv 4`. **The original plan's log fallback for
prefill does not exist as written.**

What the live path prints instead (at `-lv 4` only) is a usable pair:

```
slot update_slots: id  0 | task 0 | new prompt, n_ctx_slot = 16384, n_keep = 0, task.n_tokens = 7797
slot update_slots: id  0 | task 0 | cached n_tokens = 2048, memory_seq_rm [2048, end)
slot update_slots: id  0 | task 0 | cached n_tokens = 4096, memory_seq_rm [4096, end)
…
slot print_timing: id  0 | task 0 | prompt eval time = 1446.59 ms / 7797 tokens (0.19 ms per token, 5389.91 tokens per second)
slot print_timing: id  0 | task 0 |        eval time = 1364.68 ms /  200 tokens (6.82 ms per token,  146.55 tokens per second)
slot print_timing: id  0 | task 0 | draft acceptance = 0.63107 (  130 accepted /   206 generated)
```

`task.n_tokens` is the total, `cached n_tokens` the running processed count — together
they *do* give a percent, unlike `/slots`. This is the degraded fallback, and it costs
`-lv 4` (see 0.4).

### 0.4 Load-phase markers exist only at `-lv 4` — and Minnow never passes it

Default verbosity in this build is **3**, and at 3 the entire weight load is **silent**.
Verified against a real Minnow serve log (`~/.minnow/logs/models/397377fd-…log`, 51 lines
total): an **11-second gap** between `common_init_result: fitting params to device
memory` and `llama_context:`, with nothing in between. `grep -c 'load_tensors'` → `0`.
That, not a missing `%`, is why `parseLoadProgress` never fires.

`llama-args.js` emits no `-lv` today. Adding **`-lv 4`** unlocks the whole phase set
(269 lines for a 9B load — acceptable for a per-run log file):

| Phase | Marker at `-lv 4` | Observed t |
|---|---|---|
| Spawning | *(no output)* | — |
| Reading header | `llama_model_loader: loaded meta data with 48 key-value pairs and 442 tensors` | 1.68 s |
| Loading weights | `load_tensors: loading model tensors, this can take a while... (mmap = true, direct_io = false)` | 2.02 s |
| …streaming | a bare `....…` dot line — the per-percent model-load progress callback | 2.6 → 4.5 s |
| Offload decided | `load_tensors: offloaded 34/34 layers to GPU`, `CUDA0 model buffer size = 5040.86 MiB` | 2.60 s |
| Allocating context | `llama_context: constructing llama_context`, `llama_kv_cache: size = 512.00 MiB (16384 cells, 8 layers …)`, `sched_reserve: graph splits = 2` | 4.54 s |
| Warming up | `common_init_from_params: warming up the model with an empty run` | 4.56 s |
| Listening | `srv llama_server: model loaded` → `server is listening on http://…` | 4.69 s |

With `--fit on` there is also `common_init_result: fitting params to device memory ...`
between spawn and header, and it is **not** free — 11 s on the 27B in the Minnow log
above. The load-progress model must treat fit as its own phase, not as dead time.

> **Revise the Phase 3 floor table to these markers.** The originally-listed
> `KV self size` and `load_tensors: layer %3d assigned to device %s` do not appear;
> `llama_kv_cache: size =` and `load_tensors: offloaded N/M layers to GPU` do.

### 0.5 MTP works, needs no draft model, and reports its own memory cost

`--spec-type draft-mtp` with **no** `--spec-draft-model` starts cleanly on
`Qwen3.5-9B-MTP-Q4_K_M`, whose header carries `qwen35.nextn_predict_layers = 1`.

The server prints its own estimate — feed this to the memory meter rather than guessing:

```
srv load_model: [spec] estimated memory usage of MTP context is 168.02 MiB
common_speculative_impl_draft_mtp: adding speculative implementation 'draft-mtp'
common_speculative_impl_draft_mtp: - n_max=3, n_min=0, p_min=0.00, n_embd=4096, backend_sampling=1
```

Measured payoff on a 7 797-token prompt, 200 generated tokens:

| | tok/s (generation) |
|---|---|
| `--spec-type none` | **94–97** |
| `--spec-type draft-mtp` | **146.6** |

and `timings` gains the acceptance pair — `"draft_n": 206, "draft_n_accepted": 130`
(0.631), matching the `slot print_timing: draft acceptance` line.

### 0.6 Legacy draft flags are removal stubs — confirmed fatal

`--draft` / `--draft-n` / `--draft-max` / `--draft-min` / `--draft-n-min` still parse,
only to error: *"the argument has been removed. use --spec-draft-n-max or …"*. Never
emit them. (`--draft-p-min` and `--draft-p-split` survive as aliases of the `--spec-`
spellings, but prefer the canonical names.)

### 0.7 Two incidental findings worth keeping

- **`--parallel` defaults to `-1` = auto**, and auto picked **4 slots with
  `kv_unified = true`** on this box (`srv llama_server: n_parallel is set to auto, using
  n_parallel = 4 and kv_unified = true`). Minnow is safe here — `buildLlamaServerLaunch`
  already emits an explicit `--parallel` (default 1) unless `extra_args` sets one. The
  trap is only for a user who puts `--parallel` in `extra_args` and lets it go to auto,
  or for anything that reads a serve Minnow did not launch: KV is then ~4× the estimate.
- **Two concurrent `llama-server` processes on one GPU are catastrophic, not merely
  slow.** A stale process left the 4090 at 23.8 GB / 100% util and dragged prefill to
  ~17 tok/s — a 2048-token prompt took over two minutes, and `/slots` stopped answering.
  With the stale process killed, the same prompt prefilled at **5 400–7 350 tok/s**.
  Worth an explicit "another serve is already holding this GPU" guard and a diagnosis
  rule; a user hitting this would reasonably conclude Minnow is broken.

---

## Phase 1 — Launch settings parity — **COMPLETE (2026-08-18)**

Shipped: every flag in the table below plus grouped Load-tab sections, per-side KV
sizing in the shared memory model, and `idle_ttl_ms` wired into the heartbeat's idle
sweep (`serveIdleTtlMs`, `server/models/serve.js`; `0` = keep loaded).

Two settings are deliberately **not** modelled in the memory estimate, because there is
no measured basis for a number and a fabricated one would make the meter less truthful
than saying nothing:

- **`ctx_checkpoints`** — one observed checkpoint on Qwen3.5-9B was 78.8 MiB at a
  7 281-token context, but that tracks the model's 201 MiB recurrent state, not
  something the current geometry exposes. The Performance section says so in a hint.
- **`flash_attn: 'off'`** — the compute-buffer term assumes flash attention. The KV
  section shows a warning when the user turns it off rather than guessing the delta.

`swa_full` **is** modelled exactly (`kvCacheBytes(..., { swaFull })` drops the
sliding-window saving), and the resolved K/V pair plus `swa_full` are stamped onto the
launch plan so `admit-serve` residency sizing sees them too.

Verified live at `#/app/models/installed` → Load tab: the five groups render, pinning
V to `q4_0` moved the meter from 22.6 GB to 19 GB VRAM (0.06 → 0.04 GB per 1k ctx), and
the open/closed state of each group survives the re-render that a manual touch triggers.

### Original scope

Widen the settings schema and argv builder to cover every field in the LM Studio dialog.

**Schema — four places must agree** (they already mirror each other today):
- `src/models/api-client.ts:82` `LlamaServeSettings`
- `server/models/llama-args.js:40` JSDoc typedef
- `server/models/launch-prefs.js:18` `LAUNCH_SETTING_KEYS` + `normalizeLaunchSettings:97`
- `src/config/library-launch-meta.ts:14` `LibraryLaunchSettings`

**New settings → flags** (emitted in `buildLlamaServerLaunch`,
`server/models/llama-args.js:331`, following the existing `extraHasFlag` guard pattern
so user `extra_args` always wins):

| Setting | Flag | LM Studio label |
|---|---|---|
| `threads` | `-t N` | CPU Thread Pool Size |
| `kv_unified` | `--kv-unified` / `--no-kv-unified` | Unified KV Cache |
| `ctx_checkpoints` | `-ctxcp N` | Context Checkpoints |
| `reasoning_budget_message` | `--reasoning-budget-message S` | Reasoning Budget Message |
| `rope_freq_base` | `--rope-freq-base F` | RoPE Frequency Base |
| `rope_freq_scale` | `--rope-freq-scale F` | RoPE Frequency Scale |
| `kv_offload` (default `true`) | `--no-kv-offload` when `false` | Offload KV Cache to GPU Memory |
| `seed` | `-s N` | Seed |
| `flash_attn` | `--flash-attn on\|off\|auto` | Flash Attention |
| `cache_type_k` / `cache_type_v` | `--cache-type-k` / `--cache-type-v` | K / V Cache Quantization Type |
| `context_shift` | `--context-shift` / `--no-context-shift` | — |
| `swa_full` | `--swa-full` | — |
| `idle_ttl_ms` | none — Minnow-side eviction | Auto unload after idle |

Already wired, needs only UI: `batch_size` (`-b`), `ubatch_size` (`-ub`),
`parallel` (`--parallel`), `mlock`, `no_mmap`, `n_cpu_moe`, `chat_template*`,
`split_mode` / `tensor_split` / `main_gpu`.

**Care points:**

- `cache_type` today is a single planner-owned value driving the `f16 → q8_0 → q4_0`
  degrade ladder in `src/models/launch-plan.mjs:35`. Keep it as the auto value; let
  `cache_type_k` / `cache_type_v` be *manual overrides that win when set*. Everything
  reading cache type for sizing — `planLlamaLaunch`, `src/models/serve-memory-estimate.ts`,
  `src/models/launch-memory-meter.ts` — must take the K/V pair and size them separately
  rather than doubling one value.
- `ctx_checkpoints` and `kv_unified` change KV allocation. Feed both into
  `estimateRunMemory` (`src/models/memory-model.mjs`) so the just-built memory meter
  stays truthful; otherwise the meter silently under-reports.
- Keep emitting an explicit `--parallel` (Phase 0.7). llama.cpp's own default is auto,
  which picked 4 slots + unified KV on the test box; a user who moves `--parallel` into
  `extra_args` silently quadruples KV against the estimate.
- `flash_attn` is currently plan-owned (`flashAttnForVariant`). A manual value overrides;
  auto keeps the current per-variant behaviour.

**UI** — `renderLoadTab` (`src/ui/models/inspector.ts:495`). Keep context length, GPU
offload slider and the memory meter as the top block. Replace the single flat
`<details class="models-advanced">` (`inspector.ts:572`) with grouped collapsible
sections mirroring LM Studio's ordering: **Performance** (threads, batch, micro-batch,
parallel slots, context checkpoints) · **KV cache** (unified, offload to GPU, K type,
V type, flash attention) · **Memory** (keep in memory, try mmap, MoE on CPU) ·
**Sampling & template** (seed, RoPE base/scale, reasoning budget message, chat template)
· **Escape hatch** (extra args, env). Persist the open/closed state per section the way
`loadAdvancedOpen` (`inspector.ts:98`) does today.

Reuse `numberField:283`, `selectField:304`, `draftFor:336`, `persistDraft:344`, and
`applyPassThroughTouch` from `src/ui/models/inspector-launch.ts` — new pass-through
fields should *not* flip the draft to `fit_mode: 'manual'` (only ctx / ngl / cache type do).

Add a boolean/text field helper alongside the existing two rather than inlining checkbox
markup per row.

---

## Phase 2 — Speculative decoding, including MTP — **COMPLETE (2026-08-19)**

Shipped: six `spec_*` settings through all four schema locations, the `--spec-*` flags,
`nextnPredictLayers` surfaced from the GGUF header and threaded into `ModelGeometry`, a
Speculative decoding section in the Load tab gated on it, launch-time validation, a
`spec_missing_draft_model` diagnosis, and draft-model memory accounting.

Three things the plan did not anticipate:

- **`draft-simple` with no draft model does not fail cleanly — it segfaults.** Probed
  directly: llama-server logs `common_speculative_impl_draft_simple: adding speculative
  implementation` and then dies with exit 139 and **no error line at all**. So the
  diagnosis rule matches on the launch *settings*, not on a log signature, and the
  inspector disables the Load button outright rather than letting the crash happen.
- **The `--spec-type` vocabulary moved to `src/models/spec-decode.mjs`.** Importing it
  from `llama-args.js` broke every test that mocks that module — and three of the four
  consumers (persistence, diagnosis, client) have nothing to do with building argv.
- **The draft-model picker only offers files smaller than the target.** A draft model
  larger than the model it is guessing for costs memory to make generation slower.

Speculative memory is accounted from two sources: a separate draft model's file size,
statted in `startServe`; and `specContextBytes`, parsed from llama-server's own
`[spec] estimated memory usage of ... context is N MiB` after load, since nothing in the
GGUF header predicts it. Both feed `estimatePlanMemoryBytes`, so residency is truthful.

Verified live on `unsloth/Qwen3.5-9B-MTP-GGUF`: MTP starts, the header's
`nextn_predict_layers = 1` gates the option in, `specContextBytes` persisted as
234,901,996 (224.02 MiB — exactly what the runtime reported), and generation ran at
**132–147 tok/s with 63.6% draft acceptance** (393 of 618) against ~94–97 tok/s without.

### Original scope

**Settings** (same four schema locations):
`spec_type` (`'none' | 'draft-mtp' | 'draft-simple' | 'draft-eagle3' | 'ngram-mod' | 'ngram-simple'`),
`spec_draft_model` (path), `spec_draft_ngl`, `spec_draft_n_max`, `spec_draft_n_min`,
`spec_draft_p_min`.

Emit `--spec-type`, `--spec-draft-model`, `--spec-draft-ngl`, `--spec-draft-n-max`,
`--spec-draft-n-min`, `--spec-draft-p-min`. **Never** emit `--draft-max` / `--draft-min` —
removal stubs that abort the launch (Phase 0.6). Map LM Studio's fields directly:
Max draft tokens → `n-max`, Min draft tokens → `n-min`, Draft probability → `p-min`.

**MTP capability gate.** `server/models/gguf-metadata.js:344` already reads
`<arch>.nextn_predict_layers` into a local `nextn` but discards it. Return it as
`nextnPredictLayers` from `parseGgufHeader` (return block at `:495`), thread it through
`src/models/model-geometry.mjs` `geometryFromGgufMetadata` and the inspector's
`ensureGgufGeometry` (`inspector.ts:129`). The Speculative Decoding section then offers
`draft-mtp` only when `nextnPredictLayers > 0`, and explains why when it is absent —
rather than letting the user pick a mode that makes llama-server exit.

**Validation.** `draft-simple` / `draft-eagle3` require `spec_draft_model`; block the
launch in the inspector footer with a clear message instead of a crash-and-diagnose
round trip. Add a matching `spec_missing_draft_model` rule to
`server/models/diagnose-llama-failure.js:177` for launches that reach the server anyway.

**Memory.** A separate draft model is a second set of weights — add its file size to
`serve-memory-estimate.ts`. MTP needs no second file, but it is **not** free: parse
`srv load_model: [spec] estimated memory usage of MTP context is N MiB` from the serve
log (Phase 0.5) and reconcile the meter against it after load.

**Payoff surface.** `timings.draft_n` / `draft_n_accepted` become an acceptance-rate chip
in Phase 5 — the only honest way to tell whether spec decoding is helping. Baseline from
Phase 0.5: 0.63 acceptance ⇒ 94 → 147 tok/s.

---

## Phase 3 — Real load progress — **COMPLETE (2026-08-19)**

Shipped: `-lv 4` in argv, the pure `src/models/load-progress.mjs` (phase table, banded
time model, monotonic cap, rate priors, EWMA per-variant rate), `describeLoadPhase`
delegating to the shared phase table so a label can never disagree with the bar, a
~250 ms store ticker, and an ETA on the loading card.

The per-variant rate is exposed to the client on `GET /api/models/llama-runtime` as
`loadRateBytesPerMs` and folded in after every successful load, so a model being loaded
for the first time still gets an ETA.

Verified in a real Minnow serve log: `verbosity = 4`, and every phase marker the floor
table depends on now present — `llama_model_loader: loaded meta data`,
`load_tensors: loading model tensors`, `load_tensors: offloaded 34/34 layers to GPU`,
`llama_kv_cache: size =`, `warming up the model`, `server is listening`. Before this
change the same load printed **none** of them.

### Original scope

**Prerequisite discovered in Phase 0: emit `-lv 4`.** Without it there is nothing to
parse (0.4). Add it in `buildLlamaServerLaunch` under the usual `extraHasFlag` guard.

New pure module `src/models/load-progress.mjs` (+ `.d.mts`), so it is unit-testable
without a running server.

**Phase floors** — each phase pins a minimum percent and a ceiling the time model may
not exceed. Markers are the ones actually observed at `-lv 4` (0.4):

| Phase | Log marker | Floor → ceiling |
|---|---|---|
| Spawning | *(no output yet)* | 0 → 4 |
| Fitting | `common_init_result: fitting params to device memory` *(only with `--fit on`)* | 4 → 12 |
| Reading header | `llama_model_loader: loaded meta data with` | 12 → 18 |
| Loading weights | `load_tensors: loading model tensors, this can take a while` | 18 → 70 |
| Offload decided | `load_tensors: offloaded N/M layers to GPU` | 70 → 78 |
| Allocating context | `llama_context: constructing llama_context`, `llama_kv_cache: size =`, `sched_reserve:` | 78 → 88 |
| Warming up | `common_init_from_params: warming up the model` | 88 → 97 |
| Listening | `srv llama_server: model loaded` / `server is listening` / `/health` passes | 97 → 100 |

**Time model.** `percent = clamp(floor, ceiling, elapsedMs × bytesPerMs / weightsBytes)`,
held monotonic by the caller. Rate priors:
- Per model: `lastLoadMs` / `lastWeightsBytes` already persisted by
  `recordLaunchLoadPrior` (`server/models/launch-prefs.js:273`, written at
  `server/models/serve.js:1135`).
- **New** global fallback so a first-ever load still has an ETA: a rolling
  `loadRate: { [variant]: bytesPerMs }` in `~/.minnow/llama-cpp.json` via the existing
  `readLlamaCppConfig` / `writeLlamaCppConfig` (`llama-args.js:80`/`:93`). Keyed by
  variant because CUDA and CPU load rates differ by an order of magnitude.
- Cap at 95% until `waitForHealth` returns, then settle to 100.

**Wiring:**
- `src/models/serve-log.ts:68` — `describeLoadPhase` returns a structured
  `{ key, label }` instead of a bare string. Keep `parseLoadProgress:23` as-is; if a
  future build ever prints a real `%`, it still wins over the model.
- `src/ui/models/store.ts:43` — `LoadProgress` gains `phaseKey`, `etaMs`, `bytesTotal`,
  and `percent` becomes non-null once weights bytes are known. `trackLoad:320` runs a
  ~250 ms ticker while any load is in flight (today the panel only re-renders on the
  5 s elapsed clock in `mountServerSection`, `server-panel.ts:530` — too coarse for a bar).
- `src/ui/models/server-panel.ts:186` `loadingCard` — always set a width; keep
  `is-indeterminate` only for the sub-second window before the first log line. Show
  `Loading 43% · Loading weights · ~12s left`.
- `src/styles/models-page.css:1541` — the `.models-progress__fill` width transition is
  already right for a 250 ms tick; drop nothing, just make the indeterminate path rare.
  Leave the reduced-motion overrides at `:2209` intact.

---

## Phase 4 — Runtime activity telemetry — **COMPLETE (2026-08-19)**

Shipped: `server/models/serve-activity.js` (adaptive 400 ms / 2.5 s cadence, stale-not-idle
on timeout, tok/s derived from Δdecoded, `n_decoded` reset across `id_task`), lifecycle
reconciliation driven off `commitServes` so start / crash / evict / restore all take one
path, `GET /api/models/serve/activity{,/stream}`, and `state.activity` in the models store.

Two deviations from the plan:

- **The DTO carries `modelLabel` and `libraryId`.** The header picker holds no serve list,
  and giving it one would have coupled a global surface to the Models page.
- **`src/models/serve-activity-feed.ts` owns the single SSE subscription**, opening on the
  first subscriber and closing on the last, with the models store as just another consumer.
  It no-ops when `EventSource` is absent, so app init never depends on telemetry.

Verified end-to-end against a running serve, with the completion issued **from outside
Minnow** — the point of polling `/slots` rather than reading Minnow's own stream:
`idle` → `prompt` (`promptProcessed` 8192) → `generating` (`decoded` climbing,
derived **144.9 tok/s**) → `idle`.

### Original scope

New `server/models/serve-activity.js` — a poller per running llama.cpp serve.

- `GET {baseUrl}/slots` (default-enabled in this build; also emit `--slots` explicitly in
  argv so a future upstream default flip cannot break it).
- Adaptive cadence: ~400 ms while any slot is processing, 2.5 s when all idle, stopped
  when the serve is not `running`. Reuse the lifecycle hooks around `watchLlamaRun`
  (`server/models/serve.js:1367`) and `ensureServeHeartbeat:1510` so the poller dies with
  the serve.
- **Timeouts are `unknown`, not `idle`** — a saturated server stops answering `/slots`
  (0.1). Keep the last good sample and mark it stale rather than flipping to Ready.
- Normalise to a `ServeActivity` DTO. **Revised for what `/slots` actually carries (0.1):
  there is no prefill percent and no tok/s.**
  ```
  { serveId, updatedAt, available, stale, slots: [
      { id, taskId, state: 'idle'|'prompt'|'generating',
        promptProcessed,   // n_prompt_tokens_processed — a count, NOT a fraction
        promptCached,      // n_prompt_tokens_cache
        decoded,           // next_token[0].n_decoded, only trusted when n_remain > 0
        remaining,         // next_token[0].n_remain
        tokensPerSecond }  // derived by the poller from Δdecoded / Δt
  ] }
  ```
  Reset `decoded` on `taskId` change — it holds the previous task's value during prefill.
- Fallback when `/slots` is disabled: parse `slot update_slots: … new prompt, …
  task.n_tokens = N` + `cached n_tokens = M` off `subscribeServeLogForServe`
  (`server/models/serve-logs.js:183`) — which, unlike `/slots`, *does* give a percent
  (0.3), but only at `-lv 4`. If neither source is available, set `available: false`;
  surfaces degrade to "Ready" rather than lying.

**Transport.** A *new* SSE `GET /api/models/serve/activity/stream` in
`server/models/routes.js`, alongside the existing `/api/models/serve/events` at `:385`.
Deliberately separate: the serve-list stream fires a full list on every `commitServes`
and must not carry 400 ms telemetry.

**Client.** `subscribeServeActivity()` in `src/models/api-client.ts` mirroring
`subscribeServeEvents:494`; `state.activity: Map<string, ServeActivity>` in
`src/ui/models/store.ts` with its own RAF-batched emit so a busy slot cannot thrash the
whole models page.

---

## Phase 5 — Surfaces — **COMPLETE (2026-08-19)**

Shipped across all three surfaces: per-slot `N PP … tok` / `N GEN … tok` chips plus a
`tok/s` fact and the spec-mode chip on the Loaded Models card; a compact activity suffix
and a busy-pulse dot in the header picker, repainted in place rather than by rebuilding
the menu; and in chat, the `timings_per_token` / `return_progress` opt-ins added once in
`prepareUpstreamRequestBody`, `timings` and `prompt_progress` captured in
`mergeStreamMeta`, a `prompt_processing` stream phase with a live detail span, and
prompt-rate and draft-acceptance stat chips on the finished message.

`statsFromLlamaTimings` ignores the opening chunk of every stream — b9628 reports
`predicted_n: 1` over `predicted_ms: 0.001`, i.e. a million tokens per second — and only
adopts timings once there are at least two predicted tokens. Everything else flows through
the existing usage-coherence reconciler, so local tok/s stops being a browser wall-clock
estimate without loosening the plausibility guards.

**Not confirmed in a live browser:** the busy chips on the Loaded Models card and the chat
status row. The dev server in this session kept being reaped after a minute or two (no
error in its log, serve rows left mid-flight — a harness lifecycle artifact, not a code
path), so those two render functions were verified only through their unit tests and
through the data they read, which was confirmed against the live API. Worth a manual pass.

### Original scope

### 5a. Loaded Models card
`loadedCard` (`src/ui/models/server-panel.ts:257`). Replace the static `Ready` chip with
the LM Studio shape from the screenshots:
- idle → `Ready`
- prompt processing → `0 PP 10,240 tok` (a **count**, per 0.1 — no bar, since there is no
  denominator from `/slots`; a bar only where the log fallback supplies `task.n_tokens`)
- generating → `0 GEN 917 tok` with the spinner, and `tok/s` in the facts row

Multiple busy slots render one chip per active slot (that is what the leading `0` is —
the slot index). Minnow launches with `--parallel 1` today, so one chip is the normal
case — but a user-set `--parallel` (or a serve Minnow did not launch) can show four.

### 5b. Header dropdown
`appendModelOptionRow` (`src/ui/model-select-picker.ts:935`) gains a compact activity
suffix for loaded local models (`pp 10.2k`, `917 tok`), and `syncMenubarLoadDot`
(`src/ui/composer-model-trigger.ts:221`) animates the chip dot while any local serve is
busy so the state is glanceable without opening the menu.

**Watch out:** the header is app-wide, the models store's `ensureServeListWatch`
(`store.ts:267`) is currently started by the Models page. Subscribing from the header
means the serve-list + activity SSE must be started app-wide and torn down on quit —
do that explicitly rather than as a side effect of an import.

### 5c. Chat
**Request.** Add `timings_per_token: true` **and `return_progress: true`** (the confirmed
opt-in, 0.2) for `llama-cpp-local` only, in `prepareUpstreamRequestBody`
(`server/generations/upstream.js:92`) keyed on provider id. Doing it there rather than at
the four body-building call sites (`src/api/chat.ts:563`, `src/tools/loop.ts:1989`/`:2185`,
`src/headless/runner.ts:292`) means every path benefits. Both sanitizers are denylists,
so the fields survive to the server untouched.

**Capture.** Widen `ChatCompletionChunk` (`src/types.ts:1311`) with `timings` and
`prompt_progress` (`{total, cache, processed, time_ms}`); merge them in `mergeStreamMeta`
(`src/api/chat.ts:268`) — today they arrive intact over the wire and are silently dropped
there. Teach `reconcileCompletionStats` (`src/api/chat.ts:395`) to trust llama.cpp
`timings` as a server-stats source, so local tok/s stops being a browser wall-clock
estimate.

**Live.** `attachStreamStatus` (`src/ui/stream-status.ts:36`) gains a third span beside
`.stream-status__elapsed` and a `prompt_processing` phase — `Processing prompt… 43%`
during prefill (this *is* a real percent, `processed / total`), `917 tokens` during
generation. When `cache > 0` the bar legitimately starts near full — say
`Cached 10,016 of 10,020` rather than looking stuck. Feed it from
`createStreamingStatsPublisher` (`src/chat/streaming-stats.ts:141`) at its existing
100 ms throttle.

**Completed.** Extend the `defs` table in `appendStats` (`src/ui/messages.ts:1101`) with a
prompt-processing rate chip (`prompt_per_second`) and, when `spec_type !== 'none'`, a
draft-acceptance chip from `timings.draft_n_accepted / draft_n`. Add matching
`.stat-chip` colour variants at `src/styles/messages.css:730`.

---

## Verification

**Unit** (new): `test/models/load-progress.test.mjs` (monotonicity, floors, cap at 95,
rate-prior fallback), `test/models/serve-activity.test.mjs` (`/slots` normalisation, the
stale-`n_decoded`-across-tasks reset, degraded/timeout path). **Extend**:
`test/models/llama-args.test.mjs` — one case per new flag plus `extra_args` precedence,
MTP gating, `-lv 4` emission, and an explicit assertion that `--draft-max` /
`--draft-min` are never emitted; `test/models/serve-log.test.mts` for the structured
phase keys; `test/ui/models-inspector-footer.test.mts` for the grouped sections.

Repo conventions that bite here: any new test using `mock.module` needs a `tsx-mocks`
entry in `test-config.mjs`, and UI runs need `--test-force-exit`.

**End-to-end**, with the CUDA build already installed at
`~/.minnow/models-runtime/llama-cpp`:

```bash
npm test
```

Then run the app via the **"Minnow Full-Stack"** launch config (Vite alone boots the
pairing screen, not MinnowOS) and walk it:

1. Models → pick a GGUF → Load tab → set a few advanced fields → Load. Confirm the argv
   in `~/.minnow/logs/models/<runId>.log` matches, and the settings survive a restart.
2. Watch the loading bar advance monotonically with an ETA; load the same model twice and
   confirm the second load's ETA is sharper (rate prior kicked in).
3. Send a long prompt. Confirm the card flips prompt-token count → `GEN N tok`, the header
   dropdown agrees, and chat shows a live prefill percent then the token count.
4. On `unsloth/Qwen3.5-9B-MTP-GGUF` enable `draft-mtp`, confirm the server starts and the
   acceptance chip appears (~0.63 expected). On a non-MTP model, confirm the option is
   disabled with a reason.
5. `curl` the running serve directly (outside Minnow) and confirm the Loaded Models card
   still reports the activity — that is the point of polling `/slots` rather than reading
   Minnow's own stream.
6. **Check no stale `llama-server.exe` is running first** (0.7) — a second process on the
   same GPU makes every timing in this plan meaningless.
