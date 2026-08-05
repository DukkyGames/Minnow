/**
 * Rough VRAM / RAM estimates for llama.cpp launch settings in the Models inspector.
 * Mirrors the heuristics in server/models/profiles.js (weights + KV + overhead).
 */

const KV_FACTOR: Record<string, number> = { q4_0: 0.5, q8_0: 1.0, f16: 2.0 };
const RUNTIME_OVERHEAD_GB = 0.6;

export interface ServeMemoryEstimate {
  vramGb: number;
  ramGb: number;
  totalGb: number;
}

/** Heuristic transformer block count from parameter size (for partial GPU offload). */
export function estimateTransformerLayerCount(paramsB: number | null | undefined): number {
  const p = paramsB ?? 7;
  if (p <= 3) return 28;
  if (p <= 9) return 32;
  if (p <= 15) return 40;
  if (p <= 35) return 48;
  if (p <= 55) return 64;
  return 80;
}

function kvCacheGb(paramsB: number | null | undefined, ctx: number, cacheType: string): number {
  const active = paramsB ?? 7;
  return 0.000008 * active * ctx * (KV_FACTOR[cacheType] ?? 1.0);
}

function roundGb(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Estimate memory split from weights size, context, KV precision, and -ngl.
 * `nGpuLayers` uses llama.cpp semantics: 0 = CPU, 999 = all layers on GPU.
 */
export function estimateServeMemory(input: {
  weightsGb: number;
  paramsB: number | null | undefined;
  ctx: number;
  cacheType?: string;
  nGpuLayers?: number;
}): ServeMemoryEstimate {
  const weightsGb = Math.max(0, input.weightsGb);
  const ctx = Math.max(0, input.ctx);
  const cacheType = input.cacheType ?? 'f16';
  const ngl = input.nGpuLayers ?? 999;
  const layers = estimateTransformerLayerCount(input.paramsB);
  const kv = kvCacheGb(input.paramsB, ctx, cacheType);

  if (ngl === 0) {
    const ramGb = roundGb(weightsGb + kv + RUNTIME_OVERHEAD_GB);
    return { vramGb: 0, ramGb, totalGb: ramGb };
  }

  if (ngl === 999) {
    const vramGb = roundGb(weightsGb + kv + RUNTIME_OVERHEAD_GB);
    return { vramGb, ramGb: 0, totalGb: vramGb };
  }

  const gpuFrac = Math.min(1, Math.max(0, ngl / layers));
  const vramGb = roundGb(weightsGb * gpuFrac + kv + RUNTIME_OVERHEAD_GB);
  const ramGb = roundGb(weightsGb * (1 - gpuFrac) + 0.4);
  return { vramGb, ramGb, totalGb: roundGb(vramGb + ramGb) };
}

/** Human-readable estimate for the Load tab hint line. */
export function formatServeMemoryEstimate(estimate: ServeMemoryEstimate): string {
  if (estimate.vramGb > 0 && estimate.ramGb > 0) {
    return `~${estimate.vramGb} GB VRAM + ~${estimate.ramGb} GB RAM`;
  }
  if (estimate.vramGb > 0) {
    return `~${estimate.vramGb} GB VRAM`;
  }
  return `~${estimate.ramGb} GB RAM`;
}
