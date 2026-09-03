# Local model runtimes — MLX parity

> Companion to [`local-models-llama-cpp-parity.md`](local-models-llama-cpp-parity.md). Where the
> two overlap, this document defers; overlaps are marked **[shared]**.
>
> Builds on [`mlx-macos-support.md`](mlx-macos-support.md) (the as-built architecture record) and
> [`min-565-mlx-context-wheel.md`](min-565-mlx-context-wheel.md).

## Context

Minnow runs MLX as a managed Python server: a standalone CPython + venv under
`~/.minnow/servers/mlx-lm`, `mlx-lm==0.31.3`, spawned as `python -m mlx_lm.server` on
127.0.0.1:8087 by the generic `server/servers/manager.js`. Unlike llama.cpp it is **one
long-lived process hosting every model** — "loading a model" is a provider/serve-row flip, not
a spawn.

`mlx-macos-support.md:134-136` flagged that provisioning, spawn, `/v1/models` health, streaming
and the model-switch timing claim were all unverified on real hardware. This plan assumes
hands-on testing on Apple Silicon, which is what makes the deeper phases worth attempting.

**The central finding is a capability gap, not a bug list.** Verified against the mlx-lm 0.31.3
source and `mlx_lm/SERVER.md`, `mlx_lm.server` accepts ~20 CLI arguments and ~21 per-request
fields. Minnow passes **6 CLI arguments and 4 request fields**, and actively deletes three
fields the server supports.

| Available | Minnow uses |
|---|---|
| `--model`, `--adapter-path`, `--draft-model`, `--num-draft-tokens`, `--trust-remote-code`, `--chat-template`, `--chat-template-args`, `--use-default-chat-template`, `--temp`, `--top-p`, `--top-k`, `--min-p`, `--max-tokens`, `--decode-concurrency`, `--prompt-concurrency`, `--prefill-step-size`, `--prompt-cache-size`, `--prompt-cache-bytes`, `--pipeline`, `--log-level`, `--host`, `--port`, `--allowed-origins` | `--host`, `--port`, `--allowed-origins` (and deliberately not `--model`) |
| Request: `messages`, `model`, `stream`, `temperature`, `top_p`, `top_k`, `min_p`, `repetition_penalty`, `repetition_context_size`, `presence_penalty`, `frequency_penalty`, `xtc_probability`, `xtc_threshold`, `logit_bias`, `stop`, `seed`, `logprobs`, `top_logprobs`, `adapters`, `draft_model`, `num_draft_tokens`, `role_mapping`, `tools` | `messages`, `model`, `stream`, `temperature`, `max_tokens` — **and `sanitize-completion-body` deletes `top_k`, `min_p`, `repetition_penalty`** |

Notably unused: **speculative decoding** (`--draft-model` / per-request `draft_model`), the
**LRU prompt cache** (`--prompt-cache-size` / `--prompt-cache-bytes`), and **continuous
batching** (`--decode-concurrency 32`, `--prompt-concurrency 8`) — which means the concurrency
worry from the llama.cpp side does not apply here; mlx-lm already batches, Minnow just never
tunes it.

Two things `mlx_lm.server` does **not** have, which shape the design: **no unload endpoint**
(freeing weights means killing the process — already acknowledged at `serve.js:719-722`) and
**no `response_format` / structured output**.

Intended outcome: loading an MLX model tells the truth about what it's doing, its settings are
tunable and fit the Mac's unified memory, samplers actually reach the model, a crash is visible,
and speculative decoding is available where it pays.

**The pin is current.** mlx-lm 0.31.3 shipped April 2026 and is the latest release — no version
bump needed, only an upgrade *mechanism* (Phase 6).

---

## Phase 1 — Honest loading (~2 days) ← the biggest felt fix

**The symptom:** you click Load, the UI says **Ready** instantly, then your first message hangs
for 60–120 seconds with no feedback.

**The cause:** `startServe`'s MLX branch (`serve.js:539-561`) does no spawn, no health wait, no
`runId` — it marks the row `running` immediately. The real weight load happens inside
`mlx_lm.server` on the first request that names the model, because `ModelProvider` only reloads
when the `(model_path, adapter_path, draft_model_path)` key changes.

**The fix — prewarm.** After `ensureMlxLmServerRunning()` and the row flip, POST a
`max_tokens: 1` completion naming the target model and hold `status: 'starting'` until it
returns. Bound it by `MODEL_LOAD_TIMEOUT_MS`. This converts a mystery hang into a load bar and
makes the MLX and llama.cpp load UX identical.

**Progress.** There is no per-layer progress to scrape. Drive the same time-based estimate the
llama.cpp plan uses for GGUF: snapshot size on disk plus the observed load rate of previous
loads of the same model, stored with the launch prefs. Monotonic and honest rather than fake.

**Model-switch cost.** `stopExistingMlxServes()` (`serve.js:344`) marking prior rows `stopped`
is *correct* modelling — mlx-lm holds exactly one model. Prewarm makes the switch cost visible
instead of ambush.

**Verify (Mac):** load a 7B MLX model cold → progress runs for the real duration, "Ready" means
ready, first message streams immediately. Switch models → the switch shows a load, not a stall.

---

## Phase 2 — Request-level parity (~1–2 days)

### 2a. Stop deleting supported samplers **[shared]**

`src/providers/sanitize-completion-body.ts:98-101` (mirrored in
`server/providers/sanitize-completion-body.js`) deletes `top_k`, `min_p`, `repetition_penalty`,
`enable_thinking` for **all** `openai-v1` providers. All three are documented `mlx_lm.server`
request fields. The llama.cpp plan's Phase 4 introduces `supportsExtendedSamplers` on the
provider record — set it true in `upsertMlxLmProvider` (`serve.js:397`) too.

MLX additionally supports fields Minnow has no concept of: `repetition_context_size`,
`presence_context_size`, `frequency_context_size`, `xtc_probability`, `xtc_threshold`, `seed`,
`logit_bias`. Add `seed` (reproducibility — cheap and useful for the benchmark harness) and
leave XTC behind the advanced sampler panel. Skip `logit_bias`.

### 2b. `stop` sequences **[shared]**

A documented MLX request field; Minnow sends none. Covered by the llama.cpp plan's Phase 4
`normalizeSamplerPreset` change — this phase only confirms it reaches MLX.

### 2c. ~~Fix the `chat_template_kwargs` illusion~~ — RESOLVED, it is not an illusion

**Answered 2026-08-23 from the pinned runtime's source, no Mac needed.** `SERVER.md` omits it,
which is what prompted this item, but `mlx_lm/server.py` at v0.31.3 does read it:

```python
self.chat_template_kwargs = self.body.get("chat_template_kwargs")   # do_POST
template_kwargs = dict(tools=tools, tokenize=True, **chat_template_args)
prompt = tokenizer.apply_chat_template(messages, add_generation_prompt=True, **template_kwargs)
```

So per-request `chat_template_kwargs` **does** reach the Jinja template on MLX, and the
thinking toggle is real. Do **not** move it to `--chat-template-args` — that flag is
process-wide and would make the per-request toggle impossible.

What `mlx_lm.server` does *not* read is top-level `reasoning_effort` (the key appears nowhere
in `server.py`), unlike `llama-server`, which reads it and treats `none` as a disable. That
asymmetry was the actual bug: composer Low/Medium/High only ever set the top-level field for
non-Qwen3.8 models, so every level was byte-identical on MLX. Fixed 2026-08-23 —
`applyLocalTemplateThinkingOn` in `src/agents/thinking-to-body.ts` now carries
`enable_thinking` **and** `reasoning_effort` inside `chat_template_kwargs` for every model.

### 2d. Guard against a false structured-output probe

`server/providers/capability-probe.js` POSTs a real `response_format: json_schema` request and
infers support from the response. `mlx_lm.server` has **no** `response_format` handling — it
will most likely ignore the unknown field and return a normal 200, which the probe would read
as *supported*. Constrained tool calls (`src/providers/constrained-tool-calls.ts`) would then
attach a JSON-schema `response_format` that does nothing, and Minnow would parse free-form
output expecting a constrained shape.

Hard-disable the structured-output capability for `mlx-lm-local` rather than trusting the probe.
Confirm the failure mode on the Mac before deciding whether to also make the probe stricter
(e.g. require the response to actually validate against the schema).

**Verify (Mac):** send `min_p` / `top_k` / `repetition_penalty` and confirm behavioural change
(e.g. `top_k: 1` should make output deterministic). Confirm `stop` truncates. Confirm structured
output is reported unsupported.

---

## Phase 3 — Server-level tuning (~2–3 days)

`buildMlxServerArgs(port)` (`mlx-lm.js:168-186`) is 6 fixed arguments. MLX has **zero** tunables
today — no context length, no KV budget, no batch sizing.

Add an `MlxServeSettings` shape and a `~/.minnow/mlx-lm.json` defaults file, mirroring
`llama-args.js`'s `readLlamaCppConfig`/`writeLlamaCppConfig` and the per-model
`models.launch.byLibraryId` store the llama.cpp plan's Phase 1d introduces. Exposed args:

| Arg | Default | Why |
|---|---|---|
| `--prompt-cache-bytes` | **fit-derived** | Default `--prompt-cache-size 10` is *10 distinct KV caches* with no byte ceiling. On a 16 GB Mac that is a credible route to swap death. Set an explicit byte budget from detected unified memory. **Highest-value single flag in this phase.** |
| `--prompt-cache-size` | 10 (keep) | Fine once bytes are bounded |
| `--decode-concurrency` | 32 (keep), expose | Already gives continuous batching |
| `--prompt-concurrency` | 8 (keep), expose | |
| `--prefill-step-size` | 2048, expose | Lower it to cut peak memory during long-prompt prefill |
| `--chat-template-args` | from Phase 2c | Where MLX thinking-toggle actually lives |
| `--trust-remote-code` | off, opt-in per model | Some repos need it; make it an explicit, visible choice |
| `--temp` / `--top-p` / `--top-k` / `--min-p` / `--max-tokens` | leave unset | Per-request values already win; setting CLI defaults only creates confusion |
| `--pipeline` | not exposed | Multi-device only |

**Restart semantics.** These are spawn-time arguments on a shared process, so changing one
restarts the server and evicts the loaded model. Make that explicit in the UI ("Applies on next
start — will unload the current model") rather than silently restarting.

**Verify (Mac):** set a small `--prompt-cache-bytes`, run a long multi-turn chat, watch RSS in
Activity Monitor stay bounded. Confirm settings survive a restart.

---

## Phase 4 — Speculative decoding (~2 days)

Entirely unused today, and it is the single biggest *throughput* win available on Apple Silicon
— typically 1.5–2.5× on a well-matched draft/target pair.

`mlx_lm.server` supports it two ways: `--draft-model` / `--num-draft-tokens` at spawn, and
`draft_model` / `num_draft_tokens` **per request**. Prefer per-request — it avoids a restart and
lets the draft model be a per-model setting rather than a server-wide one.

- Add `draftModelId` + `numDraftTokens` (default 3) to the per-model launch prefs.
- In the inspector, offer draft candidates from the existing library: same architecture family
  (`resolveFamilyKey`, `model-geometry.mjs:422`) and materially smaller. A 0.5B–1.5B draft for a
  7B–32B target is the useful range.
- Both models must be resident. Since mlx-lm holds one model key at a time, confirm on the Mac
  whether naming `draft_model` loads it alongside the target or thrashes — this determines
  whether the feature is per-request or must be spawn-time after all. **Treat this as the
  phase's first experiment**, not an implementation detail.
- Surface measured tok/s before and after so the user can tell whether it helped; a mismatched
  draft model makes things *slower*.

**Verify (Mac):** measure tok/s on a fixed prompt with and without a draft model; confirm output
is identical (speculative decoding is exact, so any divergence is a bug).

---

## Phase 5 — Memory fit for MLX (~2–3 days)

Today MLX has **no fit awareness at all**:

- `src/models/fit.ts:702` — `if (nativeQ.startsWith('mlx-') || name.includes('mlx')) continue;`
  MLX rows are skipped entirely by `rankModels`, so Discover's catalog never ranks or recommends
  an MLX model. They only appear via the separate Hub-search source, unranked.
- No context/KV estimate anywhere. `memory-model.mjs` is driven by GGUF headers
  (`gguf-metadata.js`), which MLX repos do not have.

**The geometry is available** — MLX snapshots ship a standard HF `config.json` with
`num_hidden_layers`, `num_key_value_heads`, `head_dim`/`hidden_size`, `num_attention_heads`,
`vocab_size`, `sliding_window`, and `max_position_embeddings`. `mlx-context-length.js` already
reads that file for `max_position_embeddings` (`contextLengthFromTransformersConfig:39-67`).

Add `geometryFromTransformersConfig()` beside the existing `geometryFromGgufMetadata()`
(`model-geometry.mjs:525`), returning the same `ModelGeometry` shape with `source: 'config'`
(add a `GEOMETRY_UNCERTAINTY` entry — treat as slightly less certain than `gguf` because
quantization block layout is inferred, not read per-tensor). Weight bytes come from the
snapshot's actual on-disk size, which is exact — better than the GGUF path's estimate.

Then:
- Un-skip MLX in `rankModels` and let Discover rank MLX models on Apple Silicon.
- Feed the same `planLlamaLaunch` budget logic (rename to `planLocalLaunch`) to produce a fit
  verdict and an advisory context ceiling for MLX. Note MLX **cannot enforce** a context limit —
  there is no `-c` equivalent — so this is a *warning*, not a clamp: "this model at your typical
  context needs ~22 GB against an 18 GB wired limit."
- Use the existing `detectAppleSilicon()` (`server/system/hardware.js:308`) unified-memory
  budget, which already reads `iogpu.wired_limit_mb`.

**Verify (Mac):** compare predicted vs actual RSS for three models spanning quantizations; the
estimate should be within ~15%. Confirm Discover ranks MLX models sensibly on a 16 GB and a
64 GB machine.

---

## Phase 6 — Lifecycle, upgrades, hot paths (~2 days)

- **Crash propagation [shared].** `manager.js:680-694` deletes process state on exit with no
  restart, no notification; MLX serve rows keep saying `running`. The llama.cpp plan's Phase 2
  adds `subscribeServerState(serverId, cb)` to `manager.js` — subscribe for `mlx-lm` and mark
  rows `crashed`. Python tracebacks land in `~/.minnow/logs/servers/mlx-lm.log`; add MLX
  signatures (`ImportError`, `RuntimeError: Metal`, `[metal::malloc] Attempting to allocate ...
  over the maximum`) to the Phase 3 failure taxonomy. That last one is MLX's OOM and is very
  recognisable.
- **Install button on unsupported platforms [shared].** `manager.js` `listServers()` L479-511
  drops `supported`/`installable`/`reason` that `mlx-lm.js:235-243` already computes. Covered by
  the llama.cpp plan's Phase 0; listed here for completeness.
- **In-place upgrade path.** `mlx-lm.js:29-33` documents that bumping `MLX_LM_VERSION` requires
  manually deleting `~/.minnow/servers/mlx-lm`. The meta already records `version`. Detect
  drift, and offer a rebuild-the-venv action (delete + reprovision) rather than an in-place pip
  upgrade — the docstring's warning about partial upgrades leaving an importable-but-broken venv
  is correct and worth preserving.
- **Kill the per-request disk walk [shared].** `enrichMlxLmModelsWithCachedContext` calls
  `listCachedModels()` — a full uncached recursive filesystem walk — on **every** `/v1/models`
  proxy call (`proxy.js:61-63`). Wrap in a 30 s TTL cache invalidated on download completion and
  model-dir change, same shape as the `gguf-metadata.js` Map cache. Also replace the fuzzy
  substring matching (`mlx-context-length.js:99-105`) with an exact resolved-path match now that
  the model key is a known absolute path.
- **Health path.** The catalog uses `healthPath: '/v1/models'`; `/health` exists in the source
  (undocumented in SERVER.md) and is cheaper. Low priority — switch only after confirming it on
  the Mac.

---

## Phase 7 — Snapshot downloads (~1–2 days)

`downloadHfSnapshot` (`hf-client.js:366-414`) is strictly sequential file-by-file with no
resume and no per-file retry, so a dropped connection near the end of a 20 GB repo discards
everything (`cleanupJobArtifacts` recursively removes the directory).

The llama.cpp plan's Phase 5 adds Range-resume, sha256 verification, and preservation of
partials to `downloadHfFile`. Apply the same to the snapshot path, plus:

- **Parallelism of 3–4 files.** Unlike a single GGUF, a snapshot is many files; sequential
  transfer badly underuses the link. This is the MLX-specific win.
- **Per-file resume**, so a failure costs one shard, not the repo.
- Preserve the existing `MLX_SNAPSHOT_EXCLUDE` behaviour and the correct-and-load-bearing
  recursive-`rm` comment at `download.js:93-98`.

**Verify (Mac):** interrupt a large snapshot mid-transfer, restart, confirm it resumes and the
final repo loads.

---

## Explicit non-goals

1. **A shared `LocalRuntime` abstraction.** Still premature at n=2 — see the llama.cpp plan. The
   shared pieces here (`supportsExtendedSamplers`, `subscribeServerState`, the geometry
   resolver, the download hardening) are concrete consolidations, not an interface.
2. **Multi-model residency for MLX.** `mlx_lm.server` holds one model key; the llama.cpp plan's
   Phase 6 LRU does not transfer. Revisit only if upstream adds multi-model hosting.
3. **mlx-vlm / vision models.** A separate package with a separate server. `hf-search.js:14`
   already filters vision pipeline tags — correct for now.
4. **Native `mlx-swift` binary.** `mlx-macos-support.md:180-183` names this as the long-term
   destination ("the Python venv is the stepping stone, not the destination"). Out of scope;
   every phase here is protocol/state work that survives that migration.
5. **Bumping `MLX_LM_VERSION`.** 0.31.3 is current. Phase 6 builds the mechanism only.
6. **LoRA adapters.** `--adapter-path` and per-request `adapters` are supported and interesting,
   but there is no adapter management UI and no demand yet.
7. **`--pipeline` / distributed inference.** Multi-device only.

---

## Sequencing

| Phase | Delivers | Size | Depends on |
|---|---|---|---|
| 1 | Prewarm — "Ready" means ready | 2 d | llama.cpp Phase 0 (shared timeout constant) |
| 2 | Samplers, `stop`, thinking-toggle truth, structured-output guard | 1–2 d | llama.cpp Phase 4 (`supportsExtendedSamplers`) |
| 3 | Server tunables, bounded prompt cache | 2–3 d | 1 |
| 4 | Speculative decoding | 2 d | 3 |
| 5 | MLX memory fit + Discover ranking | 2–3 d | — |
| 6 | Crash propagation, upgrade path, hot-path caching | 2 d | llama.cpp Phase 2 |
| 7 | Parallel + resumable snapshot downloads | 1–2 d | llama.cpp Phase 5 |

**Phases 1 and 2 are the felt difference**; 3 and 5 are what stop a Mac from swapping; 4 is the
speed win. Phase 5 is independent and can run in parallel.

---

## Verification

Because this is the first real hardware pass, three things should be confirmed on the Mac
**before** building on them — each changes a design decision:

1. ~~**Does `chat_template_kwargs` reach the model at all?**~~ **Answered: yes** — read in
   `mlx_lm/server.py` v0.31.3 `do_POST` and splatted into `apply_chat_template`. Phase 2c
   closed; the toggle stays per-request. Still worth a behavioural spot-check on the Mac that
   a level actually changes output on a model trained on one (Qwen3.8).
2. **Does the structured-output probe falsely report support?** (Phase 2d — determines whether
   the probe itself needs to get stricter.)
3. **Does per-request `draft_model` co-resident-load, or thrash?** (Phase 4 — determines
   per-request vs spawn-time speculative decoding.)

Also worth confirming, since `mlx-lm.js:8-9` asserts it and the upstream source does not clearly
support it: **does the prompt cache actually survive a model switch?** If not, correct the
docstring.

Standard pass:

```bash
npm test -- --test-force-exit
```

Existing MLX suites to keep green: `test/models/mlx-serve.test.mjs`,
`mlx-serve-reconcile.test.mjs`, `mlx-repo-detect.test.mjs`, `mlx-context-length.test.mjs`,
`mlx-download-cleanup.test.mjs`, `test/servers/mlx-lm-provisioner.test.mjs`. Note that test runs
rewrite fixture files and a few suites fail on clean `main` — a non-zero exit is not by itself a
regression. New `mock.module` tests must be registered as `tsx-mocks` in `test-config.mjs`.

End-to-end on Apple Silicon:

1. Fresh install from Settings → Servers → provisioning completes, version reported.
2. Load a 7B MLX model → real progress, then a first message that streams immediately.
3. Switch models → visible load, not a stall.
4. `top_k: 1` produces deterministic output; `stop` truncates.
5. Long multi-turn chat with a bounded prompt cache → RSS stays bounded in Activity Monitor.
6. Draft model attached → measurably higher tok/s, byte-identical output.
7. `kill -9` the python process mid-generation → UI shows Crashed within ~1 s.
8. Load a model too large for the wired limit → a clear warning naming the numbers, not a hang.
