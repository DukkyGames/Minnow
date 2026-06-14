/**
 * llama.cpp serve profile presets — simplified port of Odysseus hwfit/profiles.py.
 * Deterministic Quality / Balanced / Speed presets from hardware + model metadata.
 */

/**
 * @typedef {object} ServeProfile
 * @property {string} key
 * @property {string} label
 * @property {string} quant
 * @property {number} n_gpu_layers
 * @property {number} n_cpu_moe
 * @property {string} cache_type
 * @property {number} ctx
 * @property {number} est_vram_gb
 * @property {boolean} fits
 * @property {string} note
 */

const QUANT_BPP = {
  Q8_0: 1.0,
  Q6_K: 0.75,
  Q5_K_M: 0.65,
  Q4_K_M: 0.58,
  Q3_K_M: 0.45,
  Q2_K: 0.35,
};

const KV_FACTOR = { q4_0: 0.5, q8_0: 1.0, f16: 2.0 };

/**
 * @param {Record<string, unknown>} model
 */
function paramsB(model) {
  const raw = model.parameters_raw ?? model.params_b ?? model.paramsB;
  if (typeof raw === 'number' && raw > 0) return raw;
  const pc = String(model.parameter_count || model.params_b || '0');
  const m = pc.match(/([\d.]+)\s*([BM])/i);
  if (!m) return 7;
  const n = Number(m[1]);
  return m[2].toUpperCase() === 'B' ? n : n / 1000;
}

/**
 * @param {Record<string, unknown>} model
 * @param {number} ctx
 * @param {string} kvType
 */
function kvGb(model, ctx, kvType) {
  const active = Number(model.active_parameters ?? paramsB(model));
  return 0.000008 * active * ctx * (KV_FACTOR[kvType] ?? 1.0);
}

/**
 * @param {Record<string, unknown>} model
 * @param {string} quant
 * @param {number} [fixedGb]
 */
function weightsGb(model, quant, fixedGb) {
  if (fixedGb && fixedGb > 0) return fixedGb;
  return paramsB(model) * (QUANT_BPP[quant] ?? 0.58);
}

/**
 * @param {Record<string, unknown>} system
 */
function vramBudgetGb(system) {
  const gpu = Number(system.gpuVramGb ?? system.gpu_vram_gb ?? 0);
  const ram = Number(system.availableRamGb ?? system.avail_gb ?? system.totalRamGb ?? 8);
  if (gpu > 0) return Math.max(1, gpu * 0.92);
  return Math.max(2, ram * 0.55);
}

/**
 * Build serve profiles for a model on the given hardware snapshot.
 * @param {Record<string, unknown>} system — hardware probe row
 * @param {Record<string, unknown>} model — catalog or cached model metadata
 * @param {{ serveWeightsGb?: number, serveQuant?: string }} [opts]
 * @returns {ServeProfile[]}
 */
export function computeServeProfiles(system, model, opts = {}) {
  const budget = vramBudgetGb(system);
  const fixedGb = opts.serveWeightsGb;
  const baseQuant = (opts.serveQuant || model.quantization || model.quant || 'Q4_K_M')
    .toString()
    .toUpperCase();

  /** @type {Array<{ key: string, label: string, quant: string, ctx: number, cache: string, ngpu: number }>} */
  const templates = [
    { key: 'quality', label: 'Quality', quant: 'Q6_K', ctx: 8192, cache: 'q8_0', ngpu: 999 },
    { key: 'balanced', label: 'Balanced', quant: baseQuant.includes('Q') ? baseQuant : 'Q4_K_M', ctx: 4096, cache: 'q8_0', ngpu: 999 },
    { key: 'speed', label: 'Speed', quant: 'Q4_K_M', ctx: 2048, cache: 'q4_0', ngpu: 999 },
  ];

  const profiles = [];
  for (const t of templates) {
    const quant = fixedGb ? baseQuant : t.quant;
    const w = weightsGb(model, quant, fixedGb);
    const kv = kvGb(model, t.ctx, t.cache);
    const est = w + kv + 0.6;
    const fits = est <= budget;
    profiles.push({
      key: t.key,
      label: t.label,
      quant,
      n_gpu_layers: t.ngpu,
      n_cpu_moe: 0,
      cache_type: t.cache,
      ctx: t.ctx,
      est_vram_gb: Math.round(est * 10) / 10,
      fits,
      note: fits
        ? `Est. ${Math.round(est * 10) / 10} GB VRAM at ${t.ctx} ctx`
        : `Needs ~${Math.round(est * 10) / 10} GB; budget ~${Math.round(budget * 10) / 10} GB`,
    });
  }

  return profiles;
}

/**
 * Build llama-server CLI args from a profile.
 * @param {ServeProfile} profile
 * @param {string} modelPath
 * @param {number} port
 */
export function profileToLlamaArgs(profile, modelPath, port) {
  const args = [
    '-m',
    modelPath,
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '-c',
    String(profile.ctx),
    '-ngl',
    String(profile.n_gpu_layers),
  ];
  if (profile.cache_type && profile.cache_type !== 'f16') {
    args.push('--cache-type-k', profile.cache_type, '--cache-type-v', profile.cache_type);
  }
  if (profile.n_cpu_moe > 0) {
    args.push('--n-cpu-moe', String(profile.n_cpu_moe));
  }
  return args;
}
