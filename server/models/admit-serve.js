/**
 * Pure llama.cpp residency policy — cap, VRAM/RAM budget, LRU eviction order.
 *
 * Kept I/O-free so tests can lock cap/budget/LRU without spawning llama-server.
 * `serve.js` applies the result with `stopServe`. This is **not** llama-server
 * router mode: each resident is its own process; Minnow picks which `baseUrl`
 * a completion hits.
 */

import path from 'node:path';
import { isCpuLlamaVariant, launchBudgetBytes } from '../../src/models/launch-plan.mjs';
import { estimateRunMemory, GIB } from '../../src/models/memory-model.mjs';

/** Idle llama.cpp serves unload after 20 minutes of no completions. */
export const SERVE_IDLE_TTL_MS = 20 * 60 * 1000;

/**
 * Backend id for estimateRunMemory overhead tables.
 * @param {string | null | undefined} variant
 */
function backendFromVariant(variant) {
  const v = String(variant ?? '').toLowerCase();
  if (v.includes('cuda')) return 'cuda';
  if (v.includes('metal')) return 'metal';
  if (v.includes('rocm') || v.includes('hip')) return 'rocm';
  if (v.includes('vulkan')) return 'vulkan';
  if (v.includes('sycl')) return 'sycl';
  return 'cpu';
}

/**
 * How many llama.cpp processes may stay resident.
 *
 * GPU uses the **card rating** (`gpuVramGb`), not `launchBudgetBytes` (which
 * subtracts WDDM/UI reserve and would keep a 16 GB card at cap 1).
 * CPU defaults to **1**: llama.cpp already saturates host RAM bandwidth and
 * shares the box with the OS + Minnow renderer — two GGUFs would swap.
 * `llama-cpp.json` `models_max` (integer ≥ 1) always wins when set.
 *
 * @param {{ userModelsMax?: unknown, budgetGb: number, isCpu: boolean }} opts
 * @returns {number}
 */
export function resolveModelsMax(opts) {
  const raw = opts.userModelsMax;
  const parsed =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseInt(raw, 10)
        : Number.NaN;
  if (Number.isInteger(parsed) && parsed >= 1) return parsed;

  if (opts.isCpu) {
    return 1;
  }

  const gb = Number(opts.budgetGb) || 0;
  if (gb > 32) return 3;
  if (gb >= 16) return 2;
  return 1;
}

/**
 * Cap + byte budget for one incoming plan on this machine.
 * @param {{ hardware?: object, variant?: string, userModelsMax?: unknown }} opts
 */
export function resolveResidencyLimits(opts) {
  const hardware = opts.hardware && typeof opts.hardware === 'object' ? opts.hardware : {};
  const variant = opts.variant ?? 'cpu';
  const isCpu = isCpuLlamaVariant(variant);
  const budgetBytes = launchBudgetBytes(hardware, variant);
  // GPU: card size so 16 GB → cap 2. CPU: RAM launch budget (unused for the
  // default cap of 1, but still the over-budget ceiling when models_max is raised).
  const budgetGb = isCpu
    ? budgetBytes / GIB
    : Number(hardware.gpuVramGb) > 0
      ? Number(hardware.gpuVramGb)
      : budgetBytes / GIB;
  const modelsMax = resolveModelsMax({
    userModelsMax: opts.userModelsMax,
    budgetGb,
    isCpu,
  });
  return { modelsMax, budgetBytes, budgetGb, isCpu };
}

/**
 * Bytes the new (or resident) plan is expected to occupy on the constrained pool.
 * GPU → VRAM; CPU → RAM. Missing geometry (4-byte GGUF stubs in serve tests)
 * returns 0 so only `models_max` evicts — typical fixtures stay at cap 1.
 *
 * @param {object | null | undefined} plan
 * @returns {number}
 */
export function estimatePlanMemoryBytes(plan) {
  if (!plan || typeof plan !== 'object') return 0;
  const isCpu = isCpuLlamaVariant(plan.variant);
  if (plan.geometry && typeof plan.geometry === 'object') {
    const est = estimateRunMemory({
      geometry: plan.geometry,
      weightsBytes: Number(plan.weightsBytes) || 0,
      ctx: Number(plan.ctx) || 0,
      cacheType: typeof plan.cache_type === 'string' ? plan.cache_type : 'f16',
      // null ngl (GPU auto) ⇒ full-offload estimate, matching unset `-ngl`.
      nGpuLayers: plan.n_gpu_layers == null ? undefined : Number(plan.n_gpu_layers),
      backend: backendFromVariant(plan.variant),
    });
    return isCpu ? est.ramBytes : est.vramBytes;
  }
  if (Number(plan.estimateGb) > 0) return Number(plan.estimateGb) * GIB;
  return 0;
}

/**
 * LRU victims to stop before starting `incoming`. Never includes `incomingId`.
 * Missing `lastUsedAt` is treated as oldest (0) so a restored row is first out.
 *
 * @param {{
 *   residents: Array<{ id: string, lastUsedAt?: number, estimateBytes?: number }>,
 *   incomingEstimateBytes: number,
 *   incomingId?: string,
 *   modelsMax: number,
 *   budgetBytes: number,
 * }} opts
 * @returns {Array<{ id: string, lastUsedAt?: number, estimateBytes?: number }>}
 */
export function pickEvictions(opts) {
  const incomingId = opts.incomingId;
  const remaining = opts.residents.filter((row) => row.id !== incomingId);
  const incomingBytes = Number(opts.incomingEstimateBytes) || 0;
  const modelsMax = Math.max(1, Number(opts.modelsMax) || 1);
  const budgetBytes = Number(opts.budgetBytes) || 0;
  const evicted = [];

  const overLimit = () => {
    const used = remaining.reduce((sum, row) => sum + (Number(row.estimateBytes) || 0), 0);
    return remaining.length >= modelsMax || used + incomingBytes > budgetBytes;
  };

  while (remaining.length > 0 && overLimit()) {
    let victimIdx = 0;
    for (let i = 1; i < remaining.length; i += 1) {
      const t = remaining[i].lastUsedAt ?? 0;
      const vt = remaining[victimIdx].lastUsedAt ?? 0;
      if (t < vt) victimIdx = i;
    }
    evicted.push(remaining[victimIdx]);
    remaining.splice(victimIdx, 1);
  }
  return evicted;
}

/**
 * Match a completion `model` id to a serve row: `--alias` (libraryId), label, filename, stem.
 * @param {{ libraryId?: string, modelLabel?: string, modelPath?: string }} row
 * @param {string | null | undefined} modelId
 */
export function serveMatchesModelId(row, modelId) {
  const id = String(modelId ?? '').trim();
  if (!id || !row) return false;
  const base = path.basename(String(row.modelPath || ''));
  const stem = base.replace(/\.gguf$/i, '');
  const needles = [row.libraryId, row.modelLabel, base, stem].filter(
    (value) => typeof value === 'string' && value.trim(),
  );
  const idLower = id.toLowerCase();
  return needles.some((needle) => needle === id || needle.toLowerCase() === idLower);
}
