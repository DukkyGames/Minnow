/**
 * Attention geometry — the shape that actually decides how much memory a model needs.
 *
 * The previous estimates derived KV cache from parameter count (`0.000008 * paramsB * ctx`),
 * a constant fitted to Llama-3-8B and then extrapolated linearly. Parameter count does not
 * predict KV size. Qwen3-0.6B and Qwen3-8B have near-identical KV geometry (28 vs 36 layers
 * of 8x128 GQA), so a linear fit lands 22x low on the small one while Llama-3.3-70B comes out
 * 1.9x high. What sets KV size is `layers x kv_heads x head_dim`, and whether the model uses
 * sliding-window attention — Gemma 3 and gpt-oss keep full attention on only 1-in-6 and
 * 1-in-2 layers respectively, which the old formula could not express at all.
 *
 * Geometry is resolved best-effort, in descending order of confidence:
 *   'gguf'      exact, read out of the file's own header (see server/models/gguf-metadata.js)
 *   'family'    a shipped model in the table below matched on architecture + parameter count
 *   'heuristic' fitted fallback from parameter count alone
 */

/**
 * @typedef {object} ModelGeometry
 * @property {number} nLayers Transformer blocks.
 * @property {number} nKvHeads Key/value heads per block (GQA width).
 * @property {number} headDim Size of one attention head.
 * @property {number} nEmbd Hidden size.
 * @property {number} nVocab Vocabulary size — drives the logits buffer.
 * @property {number} nExperts MoE expert count; 0 for dense models.
 * @property {number} swaWindow Sliding-window size in tokens; 0 when every layer is full attention.
 * @property {number} swaPeriod One full-attention layer every N layers; 1 when there is no SWA.
 * @property {GeometrySource} source Where the numbers came from.
 * @property {number} [nFullAttentionLayers] Exact full-attention layer count; overrides swaPeriod.
 * @property {number} [swaHeadDim] Head size on sliding-window layers, when it differs.
 * @property {number} [layerBytes] Exact bytes of repeating `blk.*` tensors (GGUF only).
 * @property {number} [fixedBytes] Exact bytes of embeddings / output tensors (GGUF only).
 */

/** @typedef {'gguf' | 'family' | 'heuristic'} GeometrySource */

/**
 * @typedef {object} GeometryInput
 * @property {string} [architecture] HF `model_type` (catalog `architecture` field).
 * @property {string} [name] Model or file name, used when architecture is missing.
 * @property {number} [paramsB] Total parameters in billions.
 * @property {number} [activeParamsB] Active parameters in billions (MoE).
 * @property {number} [nExperts]
 */

/**
 * @typedef {object} FamilySize
 * @property {number} paramsB
 * @property {number} nLayers
 * @property {number} nEmbd
 * @property {number} [nKvHeads]
 * @property {number} [headDim]
 * @property {number} [nExperts]
 */

/**
 * @typedef {object} Family
 * @property {number} nKvHeads Default key/value head count for the family.
 * @property {number} headDim
 * @property {number} nVocab
 * @property {number} [swaWindow]
 * @property {number} [swaPeriod]
 * @property {FamilySize[]} sizes
 */

/**
 * Shipped model geometry, read from each model's published `config.json`.
 *
 * Only families that are actually common in the catalog are listed; anything else falls
 * through to `heuristicGeometry`. Sizes are matched on parameter count, so variants of the
 * same architecture that differ only in size (Llama 2 7B vs Llama 3 8B) stay distinguishable.
 *
 * @type {Record<string, Family>}
 */
export const GEOMETRY_FAMILIES = {
  qwen3: {
    nKvHeads: 8,
    headDim: 128,
    nVocab: 151936,
    sizes: [
      { paramsB: 0.75, nLayers: 28, nEmbd: 1024 },
      { paramsB: 2.03, nLayers: 28, nEmbd: 2048 },
      { paramsB: 4.02, nLayers: 36, nEmbd: 2560 },
      { paramsB: 8.19, nLayers: 36, nEmbd: 4096 },
      { paramsB: 14.77, nLayers: 40, nEmbd: 5120 },
      { paramsB: 32.76, nLayers: 64, nEmbd: 5120 },
    ],
  },
  qwen3_moe: {
    nKvHeads: 4,
    headDim: 128,
    nVocab: 151936,
    sizes: [
      { paramsB: 30.5, nLayers: 48, nEmbd: 2048, nExperts: 128 },
      { paramsB: 235, nLayers: 94, nEmbd: 4096, nExperts: 128 },
      { paramsB: 480, nLayers: 62, nEmbd: 6144, nExperts: 160 },
    ],
  },
  // Gated DeltaNet: 3 linear-attention layers per full-attention layer. Linear layers hold a
  // constant-size state rather than a growing cache, approximated here as a zero-width window.
  qwen3_next: {
    nKvHeads: 2,
    headDim: 256,
    nVocab: 151936,
    swaWindow: 0,
    swaPeriod: 4,
    sizes: [{ paramsB: 80, nLayers: 48, nEmbd: 2048, nExperts: 512 }],
  },
  // Qwen3.5 / 3.8 hybrid (Gated DeltaNet 3:1). HF model_type is qwen3_5; GGUF arch is qwen35.
  // 16 of 64 layers are full attention (swaPeriod 4); linear layers hold a constant-size state.
  qwen3_5: {
    nKvHeads: 4,
    headDim: 256,
    nVocab: 248320,
    swaWindow: 0,
    swaPeriod: 4,
    sizes: [{ paramsB: 27.78, nLayers: 64, nEmbd: 5120, nKvHeads: 4, headDim: 256 }],
  },
  qwen2: {
    nKvHeads: 4,
    headDim: 128,
    nVocab: 152064,
    sizes: [
      { paramsB: 0.49, nLayers: 24, nEmbd: 896, nKvHeads: 2 },
      { paramsB: 1.54, nLayers: 28, nEmbd: 1536, nKvHeads: 2 },
      { paramsB: 3.09, nLayers: 36, nEmbd: 2048, nKvHeads: 2 },
      { paramsB: 7.62, nLayers: 28, nEmbd: 3584, nKvHeads: 4 },
      { paramsB: 14.8, nLayers: 48, nEmbd: 5120, nKvHeads: 8 },
      { paramsB: 32.8, nLayers: 64, nEmbd: 5120, nKvHeads: 8 },
      { paramsB: 72.7, nLayers: 80, nEmbd: 8192, nKvHeads: 8 },
    ],
  },
  llama: {
    nKvHeads: 8,
    headDim: 128,
    nVocab: 128256,
    sizes: [
      { paramsB: 1.24, nLayers: 16, nEmbd: 2048, headDim: 64 },
      { paramsB: 3.21, nLayers: 28, nEmbd: 3072 },
      { paramsB: 6.74, nLayers: 32, nEmbd: 4096, nKvHeads: 32 }, // Llama 2 7B — MHA, not GQA
      { paramsB: 8.03, nLayers: 32, nEmbd: 4096 },
      { paramsB: 13.0, nLayers: 40, nEmbd: 5120, nKvHeads: 40 }, // Llama 2 13B — MHA
      { paramsB: 70.6, nLayers: 80, nEmbd: 8192 },
      { paramsB: 405, nLayers: 126, nEmbd: 16384 },
    ],
  },
  mistral: {
    nKvHeads: 8,
    headDim: 128,
    nVocab: 32768,
    sizes: [
      { paramsB: 7.25, nLayers: 32, nEmbd: 4096 },
      { paramsB: 12.2, nLayers: 40, nEmbd: 5120 },
      { paramsB: 22.2, nLayers: 56, nEmbd: 6144 },
      { paramsB: 123, nLayers: 88, nEmbd: 12288 },
    ],
  },
  mixtral: {
    nKvHeads: 8,
    headDim: 128,
    nVocab: 32000,
    sizes: [
      { paramsB: 46.7, nLayers: 32, nEmbd: 4096, nExperts: 8 },
      { paramsB: 141, nLayers: 56, nEmbd: 6144, nExperts: 8 },
    ],
  },
  // 1 full-attention layer per 6; the other 5 use a 1024-token sliding window.
  gemma3: {
    nKvHeads: 8,
    headDim: 256,
    nVocab: 262144,
    swaWindow: 1024,
    swaPeriod: 6,
    sizes: [
      { paramsB: 1.0, nLayers: 26, nEmbd: 1152, nKvHeads: 1 },
      { paramsB: 4.3, nLayers: 34, nEmbd: 2560, nKvHeads: 4 },
      { paramsB: 12.2, nLayers: 48, nEmbd: 3840, nKvHeads: 8 },
      { paramsB: 27.4, nLayers: 62, nEmbd: 5376, nKvHeads: 16 },
    ],
  },
  gemma2: {
    nKvHeads: 8,
    headDim: 256,
    nVocab: 256000,
    swaWindow: 4096,
    swaPeriod: 2,
    sizes: [
      { paramsB: 2.6, nLayers: 26, nEmbd: 2304, nKvHeads: 4 },
      { paramsB: 9.24, nLayers: 42, nEmbd: 3584 },
      { paramsB: 27.2, nLayers: 46, nEmbd: 4608, nKvHeads: 16, headDim: 128 },
    ],
  },
  // Alternating dense / 128-token sliding-window attention.
  gpt_oss: {
    nKvHeads: 8,
    headDim: 64,
    nVocab: 201088,
    swaWindow: 128,
    swaPeriod: 2,
    sizes: [
      { paramsB: 20.9, nLayers: 24, nEmbd: 2880, nExperts: 32 },
      { paramsB: 117, nLayers: 36, nEmbd: 2880, nExperts: 128 },
    ],
  },
  phi3: {
    nKvHeads: 32,
    headDim: 96,
    nVocab: 32064,
    sizes: [
      { paramsB: 3.82, nLayers: 32, nEmbd: 3072 },
      { paramsB: 14.0, nLayers: 40, nEmbd: 5120, nKvHeads: 10, headDim: 128 },
    ],
  },
  phi4: {
    nKvHeads: 10,
    headDim: 128,
    nVocab: 100352,
    sizes: [
      { paramsB: 3.84, nLayers: 32, nEmbd: 3072, nKvHeads: 8, headDim: 96 },
      { paramsB: 14.7, nLayers: 40, nEmbd: 5120 },
    ],
  },
  glm4: {
    nKvHeads: 2,
    headDim: 128,
    nVocab: 151552,
    sizes: [
      { paramsB: 9.4, nLayers: 40, nEmbd: 4096 },
      { paramsB: 32.6, nLayers: 61, nEmbd: 6144, nKvHeads: 4 },
    ],
  },
  granite: {
    nKvHeads: 8,
    headDim: 128,
    nVocab: 49152,
    sizes: [
      { paramsB: 2.53, nLayers: 40, nEmbd: 2048 },
      { paramsB: 8.17, nLayers: 40, nEmbd: 4096 },
    ],
  },
  smollm2: {
    nKvHeads: 32,
    headDim: 64,
    nVocab: 49152,
    sizes: [
      { paramsB: 0.135, nLayers: 30, nEmbd: 576, nKvHeads: 3 },
      { paramsB: 0.36, nLayers: 32, nEmbd: 960, nKvHeads: 5 },
      { paramsB: 1.71, nLayers: 24, nEmbd: 2048 },
    ],
  },
  yi: {
    nKvHeads: 4,
    headDim: 128,
    nVocab: 64000,
    sizes: [
      { paramsB: 6.06, nLayers: 32, nEmbd: 4096 },
      { paramsB: 8.83, nLayers: 48, nEmbd: 4096 },
      { paramsB: 34.4, nLayers: 60, nEmbd: 7168, nKvHeads: 8 },
    ],
  },
  // Dense DeepSeek (deepseek-llm / deepseek-coder). The MoE V2/V3 line uses multi-head latent
  // attention, whose compressed cache this model does not describe — those fall through.
  deepseek: {
    nKvHeads: 32,
    headDim: 128,
    nVocab: 32256,
    sizes: [
      { paramsB: 1.35, nLayers: 24, nEmbd: 2048, nKvHeads: 16 },
      { paramsB: 6.74, nLayers: 32, nEmbd: 4096, nKvHeads: 32 },
      { paramsB: 33.3, nLayers: 62, nEmbd: 7168, nKvHeads: 8 },
      { paramsB: 67.4, nLayers: 95, nEmbd: 8192, nKvHeads: 8 },
    ],
  },
  command_r: {
    nKvHeads: 8,
    headDim: 128,
    nVocab: 256000,
    sizes: [
      { paramsB: 35.0, nLayers: 40, nEmbd: 8192 },
      { paramsB: 104, nLayers: 64, nEmbd: 12288 },
    ],
  },
  olmo2: {
    nKvHeads: 32,
    headDim: 128,
    nVocab: 100352,
    sizes: [
      { paramsB: 7.3, nLayers: 32, nEmbd: 4096, nKvHeads: 32 },
      { paramsB: 13.7, nLayers: 40, nEmbd: 5120, nKvHeads: 40 },
    ],
  },
};

/**
 * How far a geometry can be off, by where it came from. Used to require headroom before
 * claiming a model fits: a heuristic geometry that guesses GQA on an older multi-head model
 * understates KV by up to 4x, and reporting a confident number there is how users end up
 * loading something that OOMs.
 * @type {Record<import('./model-geometry.d.mts').GeometrySource, number>}
 */
export const GEOMETRY_UNCERTAINTY = {
  gguf: 1.0,
  family: 1.05,
  heuristic: 1.35,
};

/** HF `model_type` values that map onto one of the families above. */
const ARCH_ALIASES = {
  qwen3moe: 'qwen3_moe',
  qwen3_moe: 'qwen3_moe',
  qwen3next: 'qwen3_next',
  qwen3_next: 'qwen3_next',
  qwen3_5: 'qwen3_5',
  qwen35: 'qwen3_5',
  qwen3_8: 'qwen3_5',
  qwen3: 'qwen3',
  qwen2: 'qwen2',
  qwen2_5: 'qwen2',
  qwen25: 'qwen2',
  qwen2moe: 'qwen2',
  qwen: 'qwen2',
  llama: 'llama',
  llama4: 'llama',
  mistral: 'mistral',
  mistral3: 'mistral',
  ministral: 'mistral',
  mixtral: 'mixtral',
  gemma3: 'gemma3',
  gemma3_text: 'gemma3',
  gemma2: 'gemma2',
  gptoss: 'gpt_oss',
  gpt_oss: 'gpt_oss',
  phi3: 'phi3',
  phi4: 'phi4',
  phimoe: 'phi3',
  glm4: 'glm4',
  glm4_moe: 'glm4',
  chatglm: 'glm4',
  granite: 'granite',
  granitemoe: 'granite',
  smollm2: 'smollm2',
  smollm3: 'smollm2',
  yi: 'yi',
  deepseek: 'deepseek',
  deepseek_llm: 'deepseek',
  deepseek_coder: 'deepseek',
  cohere: 'command_r',
  cohere2: 'command_r',
  command_r: 'command_r',
  olmo2: 'olmo2',
  olmo: 'olmo2',
};

/** Ordered name probes for catalog rows with no usable `architecture`. */
const NAME_TO_FAMILY = [
  ['qwen3.8', 'qwen3_5'],
  // Underscore ids (GGUF / some providers) — keep ahead of generic `qwen3`.
  ['qwen3_8', 'qwen3_5'],
  ['qwen3.5', 'qwen3_5'],
  ['qwen3.6', 'qwen3_5'],
  ['qwen3-next', 'qwen3_next'],
  ['qwen3-coder', 'qwen3_moe'],
  ['a3b', 'qwen3_moe'],
  ['a22b', 'qwen3_moe'],
  ['qwen3', 'qwen3'],
  ['qwen2', 'qwen2'],
  ['qwq', 'qwen2'],
  ['gpt-oss', 'gpt_oss'],
  ['gemma-3', 'gemma3'],
  ['gemma3', 'gemma3'],
  ['gemma-2', 'gemma2'],
  ['mixtral', 'mixtral'],
  ['ministral', 'mistral'],
  ['mistral', 'mistral'],
  ['smollm', 'smollm2'],
  ['granite', 'granite'],
  ['phi-4', 'phi4'],
  ['phi-3', 'phi3'],
  ['glm-4', 'glm4'],
  ['command-r', 'command_r'],
  ['olmo', 'olmo2'],
  ['deepseek-coder', 'deepseek'],
  ['deepseek-llm', 'deepseek'],
  ['llama', 'llama'],
  ['yi-', 'yi'],
];

/**
 * Layer count fitted over the shipped models in `GEOMETRY_FAMILIES`.
 * Used only when neither the GGUF header nor a family match is available.
 * @param {number} paramsB
 */
export function heuristicLayerCount(paramsB) {
  const p = paramsB > 0 ? paramsB : 7;
  if (p < 1.5) return 24;
  if (p < 3.5) return 30;
  if (p < 6) return 34;
  if (p < 10) return 32;
  if (p < 16) return 42;
  if (p < 24) return 44;
  if (p < 40) return 60;
  if (p < 60) return 64;
  if (p < 90) return 80;
  return 88;
}

/** @param {string | null | undefined} value */
function normalizeArch(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[\s.\-]/g, '_')
    .replace(/_?(?:for)?_?causallm$/, '')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Family key for a catalog row, from `architecture` first and the name as a fallback.
 * @param {GeometryInput} input
 * @returns {string | null}
 */
export function resolveFamilyKey(input) {
  const arch = normalizeArch(input.architecture);
  if (arch && ARCH_ALIASES[arch]) return ARCH_ALIASES[arch];
  if (arch && GEOMETRY_FAMILIES[arch]) return arch;

  const name = String(input.name ?? '').toLowerCase();
  if (!name) return null;
  for (const [needle, family] of NAME_TO_FAMILY) {
    if (name.includes(needle)) return family;
  }
  return null;
}

/**
 * Hidden size implied by a parameter count, from the standard dense-transformer budget of
 * roughly 12 * nLayers * nEmbd^2 weights, rounded to a plausible multiple of 128.
 * @param {number} paramsB parameters (billions) attributable to the dense trunk
 * @param {number} nLayers
 */
function heuristicEmbeddingSize(paramsB, nLayers) {
  const dense = paramsB > 0 ? paramsB : 7;
  const raw = Math.sqrt((dense * 1e9) / (12 * Math.max(1, nLayers)));
  const rounded = Math.round(raw / 128) * 128;
  return Math.min(16384, Math.max(512, rounded));
}

/**
 * Fallback geometry from parameter count alone.
 * @param {GeometryInput} input
 * @param {Family} [family] family constants, when the family is known but the size is not
 * @returns {ModelGeometry}
 */
export function heuristicGeometry(input, family) {
  const paramsB = input.paramsB && input.paramsB > 0 ? input.paramsB : 7;
  const isMoe = Boolean(input.nExperts) || (input.activeParamsB ?? paramsB) < paramsB * 0.9;
  // For MoE the attention trunk is sized by the active path, not the full expert bank.
  const trunkB = isMoe && input.activeParamsB ? input.activeParamsB : paramsB;
  const nLayers = heuristicLayerCount(paramsB);
  const nEmbd = heuristicEmbeddingSize(trunkB, nLayers);
  // 8 KV heads of 128 is the near-universal GQA width on current models; never wider
  // than the hidden size, which is what multi-head attention on a tiny model degrades to.
  const headDim = family?.headDim ?? 128;
  const defaultKvHeads = family?.nKvHeads ?? 8;
  const nKvHeads = Math.max(1, Math.min(defaultKvHeads, Math.floor(nEmbd / headDim) || 1));
  return {
    nLayers,
    nKvHeads,
    headDim,
    nEmbd,
    nVocab: family?.nVocab ?? 128256,
    nExperts: input.nExperts ?? 0,
    swaWindow: family?.swaWindow ?? 0,
    swaPeriod: family?.swaPeriod ?? 1,
    source: 'heuristic',
  };
}

/**
 * Best-known geometry for a catalog or library model.
 *
 * Prefer `geometryFromGgufMetadata` when the weights are on disk — this path is for models
 * that have not been downloaded yet, where the header cannot be read.
 * @param {GeometryInput} input
 * @returns {ModelGeometry}
 */
export function resolveGeometry(input) {
  const familyKey = resolveFamilyKey(input);
  const family = familyKey ? GEOMETRY_FAMILIES[familyKey] : undefined;
  const paramsB = input.paramsB && input.paramsB > 0 ? input.paramsB : 0;

  if (!family || !paramsB) return heuristicGeometry(input, family);

  // Nearest shipped size on a log scale, so 8B matches 8.19B rather than 4B.
  let best = null;
  let bestDistance = Infinity;
  for (const size of family.sizes) {
    const distance = Math.abs(Math.log(paramsB / size.paramsB));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = size;
    }
  }
  // ~30% either way. Beyond that the row is a different model wearing a familiar name.
  if (!best || bestDistance > 0.3) return heuristicGeometry(input, family);

  return {
    nLayers: best.nLayers,
    nKvHeads: best.nKvHeads ?? family.nKvHeads,
    headDim: best.headDim ?? family.headDim,
    nEmbd: best.nEmbd,
    nVocab: family.nVocab,
    nExperts: input.nExperts ?? best.nExperts ?? 0,
    swaWindow: family.swaWindow ?? 0,
    swaPeriod: family.swaPeriod ?? 1,
    source: 'family',
  };
}

/**
 * Exact geometry from a parsed GGUF header.
 * @param {Record<string, unknown>} meta output of `readGgufMetadata`
 * @returns {ModelGeometry | null}
 */
export function geometryFromGgufMetadata(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const nLayers = Number(meta.nLayers);
  const nKvHeads = Number(meta.nKvHeads);
  const headDim = Number(meta.headDim);
  if (!(nLayers > 0) || !(nKvHeads > 0) || !(headDim > 0)) return null;

  // A file can declare a window without saying how often full attention returns. When the
  // header gives neither an exact per-layer count nor a scalar period, fall back to the family
  // table, then to "no windowing" — which overstates the cache rather than understating it.
  const swaWindow = Number(meta.swaWindow) > 0 ? Number(meta.swaWindow) : 0;
  const fullLayers = Number(meta.nFullAttentionLayers);
  let swaPeriod = Number(meta.swaPeriod) > 0 ? Number(meta.swaPeriod) : 0;
  if (swaWindow > 0 && !swaPeriod && !(fullLayers > 0)) {
    const familyKey = resolveFamilyKey({ architecture: String(meta.arch ?? '') });
    swaPeriod = (familyKey && GEOMETRY_FAMILIES[familyKey]?.swaPeriod) || 1;
  }

  return {
    nFullAttentionLayers: fullLayers > 0 ? fullLayers : undefined,
    swaHeadDim: Number(meta.swaHeadDim) > 0 ? Number(meta.swaHeadDim) : undefined,
    nLayers,
    nKvHeads,
    headDim,
    nEmbd: Number(meta.nEmbd) > 0 ? Number(meta.nEmbd) : nKvHeads * headDim,
    nVocab: Number(meta.nVocab) > 0 ? Number(meta.nVocab) : 128256,
    nExperts: Number(meta.nExperts) > 0 ? Number(meta.nExperts) : 0,
    swaWindow,
    swaPeriod: swaPeriod > 0 ? swaPeriod : 1,
    source: 'gguf',
    layerBytes: Number(meta.layerBytes) > 0 ? Number(meta.layerBytes) : undefined,
    fixedBytes: Number(meta.fixedBytes) > 0 ? Number(meta.fixedBytes) : undefined,
  };
}
