/**
 * llama.cpp serve profile presets — Quality / Balanced / Speed from hardware + model metadata.
 * Deterministic Quality / Balanced / Speed presets from hardware + model metadata.
 */

import { DEFAULT_CONTEXT_TOKENS } from './default-context-tokens.js';
import { estimateRunMemory, GIB, weightsBytesFor } from '../../src/models/memory-model.mjs';
import { geometryFromGgufMetadata, resolveGeometry } from '../../src/models/model-geometry.mjs';

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
 * @property {import('../../src/models/model-geometry.d.mts').GeometrySource} geometry_source
 * @property {boolean} fits
 * @property {string} note
 */

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
 * @param {string} quant
 * @param {number} [fixedGb]
 */
function weightsBytes(model, quant, fixedGb) {
  if (fixedGb && fixedGb > 0) return fixedGb * GIB;
  return weightsBytesFor(paramsB(model), quant);
}

/**
 * Attention geometry for a profile request. Exact when the caller passed a GGUF header we
 * already parsed; otherwise resolved from architecture and parameter count.
 * @param {Record<string, unknown>} model
 * @param {Record<string, unknown> | null} [ggufMeta]
 */
function geometryFor(model, ggufMeta) {
  const exact = ggufMeta ? geometryFromGgufMetadata(ggufMeta) : null;
  if (exact) return exact;
  const total = paramsB(model);
  const active = Number(model.active_parameters);
  return resolveGeometry({
    architecture: typeof model.architecture === 'string' ? model.architecture : undefined,
    name: typeof model.name === 'string' ? model.name : undefined,
    paramsB: total,
    activeParamsB: active > 0 ? active : total,
    nExperts: Number(model.num_experts) || 0,
  });
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
 * @param {{ serveWeightsGb?: number, serveQuant?: string, ggufMeta?: Record<string, unknown> | null }} [opts]
 * @returns {ServeProfile[]}
 */
export function computeServeProfiles(system, model, opts = {}) {
  const budget = vramBudgetGb(system);
  const fixedGb = opts.serveWeightsGb;
  const geometry = geometryFor(model, opts.ggufMeta ?? null);
  const onGpu = Number(system.gpuVramGb ?? system.gpu_vram_gb ?? 0) > 0;
  const backend = onGpu ? String(system.backend || 'cuda') : 'cpu';
  const baseQuant = (opts.serveQuant || model.quantization || model.quant || 'Q4_K_M')
    .toString()
    .toUpperCase();

  /** @type {Array<{ key: string, label: string, quant: string, ctx: number, cache: string, ngpu: number }>} */
  const templates = [
    { key: 'quality', label: 'Quality', quant: 'Q6_K', ctx: DEFAULT_CONTEXT_TOKENS, cache: 'f16', ngpu: 999 },
    {
      key: 'balanced',
      label: 'Balanced',
      quant: baseQuant.includes('Q') ? baseQuant : 'Q4_K_M',
      ctx: DEFAULT_CONTEXT_TOKENS,
      cache: 'f16',
      ngpu: 999,
    },
    { key: 'speed', label: 'Speed', quant: 'Q4_K_M', ctx: 2048, cache: 'q4_0', ngpu: 999 },
  ];

  const profiles = [];
  for (const t of templates) {
    const quant = fixedGb ? baseQuant : t.quant;
    const estimate = estimateRunMemory({
      geometry,
      weightsBytes: weightsBytes(model, quant, fixedGb),
      ctx: t.ctx,
      cacheType: t.cache,
      nGpuLayers: onGpu ? undefined : 0,
      backend,
      deviceCount: Number(system.gpuCount) || 1,
    });
    const est = estimate.totalGb;
    const fits = est <= budget;
    const unit = onGpu ? 'VRAM' : 'RAM';
    profiles.push({
      key: t.key,
      label: t.label,
      quant,
      n_gpu_layers: t.ngpu,
      n_cpu_moe: 0,
      cache_type: t.cache,
      ctx: t.ctx,
      est_vram_gb: est,
      geometry_source: geometry.source,
      fits,
      note: fits
        ? `Est. ${est} GB ${unit} at ${t.ctx} ctx`
        : `Needs ~${est} GB; budget ~${Math.round(budget * 10) / 10} GB`,
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
