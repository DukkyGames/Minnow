/**
 * Memory model for a llama.cpp run: weights + KV cache + compute graph + backend overhead.
 *
 * One shared model behind every memory number Minnow shows — the Models discovery ranking,
 * the inspector's Load tab, and the server-side serve profiles. Those three used to carry
 * three different formulas that disagreed with each other by up to 2x on the same model at
 * the same settings, on top of all being wrong in the same direction (see model-geometry.mjs
 * for why the old parameter-count-derived KV term could not work).
 *
 * Everything here is bytes in, bytes out; GiB conversion happens at the display edge, to
 * match how `detectHardware` reports VRAM and RAM.
 */

/** @typedef {import('./model-geometry.d.mts').ModelGeometry} ModelGeometry */

export const GIB = 1024 ** 3;

/**
 * Bytes per element for each `--cache-type-k/v` value, from the ggml block layouts:
 * a quantized KV type stores `blockSize` elements in `typeSize` bytes.
 */
export const KV_TYPE_BYTES = {
  f32: 4,
  f16: 2,
  bf16: 2,
  q8_0: 34 / 32,
  q5_1: 24 / 32,
  q5_0: 22 / 32,
  q4_1: 20 / 32,
  q4_0: 18 / 32,
  iq4_nl: 18 / 32,
};

/**
 * GiB of weights per billion parameters, measured from published GGUF builds rather than
 * derived from the nominal bit width.
 *
 * Two corrections are baked in. A k-quant file is larger than its name implies, because the
 * token embedding and output head are kept at higher precision — Q4_K_M lands near 4.9
 * bits/weight, not 4. And a "byte per weight" is 1e9 bytes per billion parameters, which is
 * 0.931 GiB, so a table written in bytes/weight overstates every entry by 7% once the number
 * is compared against a VRAM figure the OS reports in GiB.
 *
 * These only matter for models that are not downloaded yet; anything on disk is measured.
 */
export const WEIGHT_GIB_PER_BILLION = {
  F32: 3.73,
  F16: 1.86,
  BF16: 1.86,
  Q8_0: 0.99,
  FP8: 0.95,
  INT8: 0.95,
  W8A8: 0.95,
  W8A16: 0.95,
  'AWQ-8bit': 0.95,
  'GPTQ-Int8': 0.95,
  'mlx-8bit': 0.97,
  'FP8-Mixed': 0.95,
  Q6_K: 0.77,
  'mlx-6bit': 0.74,
  Q5_K_M: 0.67,
  Q5_K_S: 0.65,
  Q4_K_M: 0.57,
  Q4_K_S: 0.54,
  Q4_0: 0.54,
  IQ4_XS: 0.52,
  Q3_K_M: 0.47,
  IQ3_XXS: 0.38,
  Q2_K: 0.37,
  IQ2_XXS: 0.28,
  // Native 4-bit formats carry group scales and f16 embeddings but no k-quant precision islands.
  FP4: 0.53,
  NVFP4: 0.53,
  MXFP4: 0.53,
  NF4: 0.53,
  INT4: 0.53,
  W4A16: 0.53,
  'AWQ-4bit': 0.53,
  'GPTQ-Int4': 0.53,
  'mlx-4bit': 0.55,
  'FP4-MoE-Mixed': 0.55,
};

/** Fallback when a quant label is not in the table (assume a 4-bit k-quant). */
export const DEFAULT_WEIGHT_GIB_PER_BILLION = 0.57;

/**
 * Persistent per-device backend allocations that exist before any tensor is loaded:
 * driver context, BLAS workspaces, allocator slack. Measured as the gap between
 * llama.cpp's own buffer accounting and process VRAM use.
 */
const BACKEND_OVERHEAD_GIB = {
  cuda: 0.3,
  rocm: 0.35,
  hip: 0.35,
  vulkan: 0.25,
  sycl: 0.25,
  metal: 0.08,
  mps: 0.08,
  cpu: 0.06,
};

/** Host-side allocations that exist for any run, GPU or not. */
const HOST_OVERHEAD_GIB = 0.15;

/** llama.cpp's default micro-batch (`-ub`). */
export const DEFAULT_UBATCH = 512;

/**
 * Live `ubatch x n_embd` f32 tensors in a llama-family graph. The graph is reserved for the
 * worst case, so this counts concurrent scratch across attention and FFN, not the total.
 */
const GRAPH_SCRATCH_TENSORS = 6;

/** @param {string | null | undefined} cacheType */
export function kvElementBytes(cacheType) {
  const key = String(cacheType ?? 'f16').toLowerCase();
  return KV_TYPE_BYTES[key] ?? KV_TYPE_BYTES.f16;
}

/**
 * Full-attention layers in a model — the ones whose cache grows with context. Sliding-window
 * layers never exceed their window no matter how long the context gets.
 *
 * An exact per-layer count from the GGUF header wins; otherwise 1 layer in `swaPeriod` keeps
 * full attention, and a `swaPeriod` of 1 means the model has no windowing at all.
 * @param {ModelGeometry} geometry
 */
export function fullAttentionLayers(geometry) {
  if (geometry.nFullAttentionLayers && geometry.nFullAttentionLayers > 0) {
    return Math.min(geometry.nLayers, geometry.nFullAttentionLayers);
  }
  const period = geometry.swaPeriod > 1 ? geometry.swaPeriod : 1;
  if (period <= 1) return geometry.nLayers;
  return Math.ceil(geometry.nLayers / period);
}

/**
 * KV cache bytes for a context length.
 *
 * `2 *` covers the separate K and V caches. Sliding-window layers are charged for their
 * window plus one micro-batch of headroom, which is what llama.cpp allocates for them, and
 * use their own head size when the architecture narrows them.
 * @param {ModelGeometry} geometry
 * @param {number} ctx
 * @param {string} [cacheType]
 * @param {{ ubatch?: number, parallel?: number }} [opts]
 */
export function kvCacheBytes(geometry, ctx, cacheType = 'f16', opts = {}) {
  const tokens = Math.max(0, ctx);
  if (!tokens) return 0;
  const ubatch = opts.ubatch ?? DEFAULT_UBATCH;
  const bytesPerElement = kvElementBytes(cacheType);

  const fullLayers = fullAttentionLayers(geometry);
  const windowedLayers = geometry.nLayers - fullLayers;
  const windowTokens = Math.min(tokens, (geometry.swaWindow || 0) + ubatch);
  const swaHeadDim = geometry.swaHeadDim || geometry.headDim;

  const fullBytes = 2 * geometry.nKvHeads * geometry.headDim * bytesPerElement;
  const windowBytes = 2 * geometry.nKvHeads * swaHeadDim * bytesPerElement;

  return fullBytes * fullLayers * tokens + windowBytes * windowedLayers * windowTokens;
}

/**
 * Bytes of KV cache added per extra token of context — the number that makes "can I raise
 * the context?" answerable without re-running the whole estimate. Windowed layers contribute
 * nothing here; their cost is a fixed floor, not a slope.
 * @param {ModelGeometry} geometry
 * @param {string} [cacheType]
 */
export function kvBytesPerToken(geometry, cacheType = 'f16') {
  const bytesPerElement = kvElementBytes(cacheType);
  return 2 * fullAttentionLayers(geometry) * geometry.nKvHeads * geometry.headDim * bytesPerElement;
}

/**
 * Compute-graph buffer. Dominated by the logits tensor (`n_vocab x ubatch`), which is why
 * a 0.6B model with a 152k vocabulary reserves nearly as much scratch as an 8B one.
 *
 * Assumes flash attention, which is llama.cpp's default (`--flash-attn auto`). Without it the
 * graph also holds `n_head x ctx x ubatch` attention scores, which at long context is larger
 * than everything else here combined.
 * @param {ModelGeometry} geometry
 * @param {{ ubatch?: number }} [opts]
 */
export function computeBufferBytes(geometry, opts = {}) {
  const ubatch = opts.ubatch ?? DEFAULT_UBATCH;
  const logits = geometry.nVocab * ubatch * 4;
  const scratch = ubatch * geometry.nEmbd * 4 * GRAPH_SCRATCH_TENSORS;
  return logits + scratch;
}

/**
 * @param {string | null | undefined} backend
 * @param {number} [deviceCount]
 */
export function backendOverheadBytes(backend, deviceCount = 1) {
  const key = String(backend ?? 'cpu').toLowerCase();
  const perDevice = BACKEND_OVERHEAD_GIB[key] ?? BACKEND_OVERHEAD_GIB.cpu;
  return perDevice * Math.max(1, deviceCount) * GIB;
}

/**
 * On-disk weights size for a parameter count and quant tier.
 * @param {number} paramsB
 * @param {string} quant
 * @returns {number} bytes
 */
export function weightsBytesFor(paramsB, quant) {
  const perBillion = WEIGHT_GIB_PER_BILLION[quant] ?? DEFAULT_WEIGHT_GIB_PER_BILLION;
  return Math.max(0, paramsB) * perBillion * GIB;
}

/**
 * @typedef {object} MemoryEstimateInput
 * @property {ModelGeometry} geometry
 * @property {number} weightsBytes Exact file size when the weights are on disk.
 * @property {number} ctx
 * @property {string} [cacheType] `--cache-type-k/v`; defaults to f16.
 * @property {number} [nGpuLayers] llama.cpp `-ngl`. Undefined or >= nLayers means all.
 * @property {string} [backend] cuda | rocm | vulkan | metal | cpu.
 * @property {number} [deviceCount]
 * @property {number} [ubatch]
 */

/**
 * @typedef {object} MemoryEstimate
 * @property {number} vramGb
 * @property {number} ramGb
 * @property {number} totalGb
 * @property {number} vramBytes
 * @property {number} ramBytes
 * @property {number} totalBytes
 * @property {number} kvBytesPerToken
 * @property {number} gpuLayers
 * @property {number} nLayers
 * @property {import('./model-geometry.d.mts').GeometrySource} geometrySource
 * @property {{ weightsVram: number, weightsRam: number, kvVram: number, kvRam: number, compute: number, overhead: number }} breakdown Bytes.
 */

/** @param {number} bytes */
function toGb(bytes) {
  return Math.round((bytes / GIB) * 10) / 10;
}

/**
 * Split weights between GPU and CPU for a partial offload.
 *
 * llama.cpp moves whole transformer blocks, and the embedding / output tensors only once
 * `-ngl` exceeds the block count. When the GGUF header gave us exact per-tensor sizes we use
 * the real repeating/fixed split; otherwise we fall back to a proportional one, which
 * overstates GPU use for models with a large vocabulary.
 * @param {ModelGeometry} geometry
 * @param {number} weightsBytes
 * @param {number} gpuLayers
 * @param {boolean} offloadOutput
 */
function splitWeights(geometry, weightsBytes, gpuLayers, offloadOutput) {
  const layerFraction = geometry.nLayers > 0 ? gpuLayers / geometry.nLayers : 0;
  const exactTotal = (geometry.layerBytes ?? 0) + (geometry.fixedBytes ?? 0);

  let repeating = weightsBytes;
  let fixed = 0;
  if (exactTotal > 0) {
    // Scale the measured ratio onto the caller's byte count, which stays authoritative
    // (a split GGUF reports only the part we parsed).
    repeating = weightsBytes * ((geometry.layerBytes ?? 0) / exactTotal);
    fixed = weightsBytes - repeating;
  }

  const onGpu = repeating * layerFraction + (offloadOutput ? fixed : 0);
  return { weightsVram: onGpu, weightsRam: weightsBytes - onGpu };
}

/**
 * Memory needed to run a model at given settings.
 * @param {MemoryEstimateInput} input
 * @returns {MemoryEstimate}
 */
export function estimateRunMemory(input) {
  const { geometry } = input;
  const weightsBytes = Math.max(0, input.weightsBytes || 0);
  const ctx = Math.max(0, input.ctx || 0);
  const ubatch = input.ubatch ?? DEFAULT_UBATCH;
  const requested = input.nGpuLayers ?? geometry.nLayers;
  const gpuLayers = Math.max(0, Math.min(geometry.nLayers, requested));
  const offloadOutput = requested > geometry.nLayers;
  const onGpu = gpuLayers > 0;

  const kvTotal = kvCacheBytes(geometry, ctx, input.cacheType, { ubatch });
  // KV lives wherever its layer lives — the old model charged every byte of it to VRAM even
  // at `-ngl 1`, which made partial offload look far more expensive than it is.
  const kvVram = geometry.nLayers > 0 ? kvTotal * (gpuLayers / geometry.nLayers) : 0;
  const kvRam = kvTotal - kvVram;

  const { weightsVram, weightsRam } = splitWeights(
    geometry,
    weightsBytes,
    gpuLayers,
    offloadOutput,
  );

  const compute = computeBufferBytes(geometry, { ubatch });
  const backendOverhead = backendOverheadBytes(
    onGpu ? (input.backend ?? 'cuda') : 'cpu',
    input.deviceCount ?? 1,
  );
  const hostOverhead = HOST_OVERHEAD_GIB * GIB;

  const vramBytes = onGpu ? weightsVram + kvVram + compute + backendOverhead : 0;
  const ramBytes = onGpu
    ? weightsRam + kvRam + hostOverhead
    : weightsRam + kvRam + compute + backendOverhead + hostOverhead;

  return {
    vramGb: toGb(vramBytes),
    ramGb: toGb(ramBytes),
    totalGb: toGb(vramBytes + ramBytes),
    vramBytes,
    ramBytes,
    totalBytes: vramBytes + ramBytes,
    kvBytesPerToken: kvBytesPerToken(geometry, input.cacheType),
    gpuLayers,
    nLayers: geometry.nLayers,
    geometrySource: geometry.source,
    breakdown: {
      weightsVram,
      weightsRam,
      kvVram,
      kvRam,
      compute,
      overhead: backendOverhead + hostOverhead,
    },
  };
}

/**
 * Largest context that fits a byte budget, rounded down to a power of two.
 *
 * Solves for context directly instead of the old halve-and-retry loop, which could only ever
 * report ctx/2, ctx/4, ... and so under-reported what a machine can actually hold.
 * @param {ModelGeometry} geometry
 * @param {number} budgetBytes bytes left after weights, compute, and overhead
 * @param {string} [cacheType]
 * @param {{ ubatch?: number, minCtx?: number, maxCtx?: number }} [opts]
 * @returns {number} 0 when even the minimum does not fit
 */
export function maxContextForBudget(geometry, budgetBytes, cacheType = 'f16', opts = {}) {
  const minCtx = opts.minCtx ?? 1024;
  const maxCtx = opts.maxCtx ?? 1_048_576;
  if (budgetBytes <= 0) return 0;

  const perToken = kvBytesPerToken(geometry, cacheType);
  if (perToken <= 0) return maxCtx;

  // Windowed layers add a context-independent floor; take it off the budget first.
  const floor = kvCacheBytes(geometry, maxCtx, cacheType, opts) - perToken * maxCtx;
  const usable = budgetBytes - floor;
  if (usable <= 0) return 0;

  const raw = Math.floor(usable / perToken);
  if (raw < minCtx) return 0;

  const power = 2 ** Math.floor(Math.log2(raw));
  return Math.min(maxCtx, power);
}

/**
 * Human-readable split for a hint line.
 * @param {MemoryEstimate} estimate
 */
export function formatMemoryEstimate(estimate) {
  if (estimate.vramGb > 0 && estimate.ramGb > 0) {
    return `~${estimate.vramGb} GB VRAM + ~${estimate.ramGb} GB RAM`;
  }
  if (estimate.vramGb > 0) return `~${estimate.vramGb} GB VRAM`;
  return `~${estimate.ramGb} GB RAM`;
}
