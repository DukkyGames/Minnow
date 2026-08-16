import { getModels } from './catalog';
import {
  DEFAULT_WEIGHT_GIB_PER_BILLION,
  estimateRunMemory,
  GIB,
  maxContextForBudget,
  weightsBytesFor,
  WEIGHT_GIB_PER_BILLION,
} from './memory-model.mjs';
import { GEOMETRY_UNCERTAINTY } from './model-geometry.mjs';
import {
  activeParamsB,
  estimateMemoryGb,
  estimateFileSizeGb,
  geometryForModel,
  inferUseCase,
  isPrequantized,
  paramsB,
  QUANT_QUALITY_PENALTY,
  QUANT_SPEED_MULT,
} from './quant';
import type { GeometrySource } from './model-geometry.d.mts';
import type { CatalogModel, HardwareSnapshot, ModelFitResult } from './types';

export const GPU_BANDWIDTH: Record<string, number> = {
  '5090': 1792,
  '5080': 960,
  '5070 ti': 896,
  '5070': 672,
  '5060 ti': 448,
  '5060': 256,
  '4090': 1008,
  '4080 super': 736,
  '4080': 717,
  '4070 ti super': 672,
  '4070 ti': 504,
  '4070 super': 504,
  '4070': 504,
  '4060 ti': 288,
  '4060': 272,
  '3090 ti': 1008,
  '3090': 936,
  '3080 ti': 912,
  '3080': 760,
  '3070 ti': 608,
  '3070': 448,
  '3060 ti': 448,
  '3060': 360,
  '2080 ti': 616,
  '2080 super': 496,
  '2080': 448,
  '2070 super': 448,
  '2070': 448,
  '2060 super': 448,
  '2060': 336,
  '1660 ti': 288,
  '1660 super': 336,
  '1660': 192,
  '1650 super': 192,
  '1650': 128,
  'h100 sxm': 3350,
  h100: 2039,
  h200: 4800,
  'a100 sxm': 2039,
  a100: 1555,
  l40s: 864,
  l40: 864,
  l4: 300,
  a10g: 600,
  a10: 600,
  t4: 320,
  'v100 sxm': 900,
  v100: 897,
  a6000: 768,
  a5000: 768,
  a4000: 448,
  '7900 xtx': 960,
  '7900 xt': 800,
  '7900 gre': 576,
  '7800 xt': 624,
  '7700 xt': 432,
  '7600': 288,
  '6950 xt': 576,
  '6900 xt': 512,
  '6800 xt': 512,
  '6800': 512,
  '6700 xt': 384,
  '6600 xt': 256,
  '6600': 224,
  mi300x: 5300,
  mi300: 5300,
  mi250x: 3277,
  mi250: 3277,
  mi210: 1638,
  mi100: 1229,
  '9070 xt': 624,
  '9070': 488,
  '9060 xt': 322,
  '9060': 322,
  'm1 ultra': 800,
  'm1 max': 400,
  'm1 pro': 200,
  m1: 68,
  'm2 ultra': 800,
  'm2 max': 400,
  'm2 pro': 200,
  m2: 100,
  'm3 ultra': 800,
  'm3 max': 300,
  'm3 pro': 150,
  m3: 100,
  'm4 max': 546,
  'm4 pro': 273,
  m4: 120,
  'm5 max': 546,
  'm5 pro': 273,
  m5: 150,
};

const BW_KEYS_SORTED = Object.keys(GPU_BANDWIDTH).sort((a, b) => b.length - a.length);

export const FALLBACK_K: Record<string, number> = {
  cuda: 220,
  rocm: 180,
  metal: 150,
  cpu_x86: 70,
  cpu_arm: 90,
};

export const USE_CASE_WEIGHTS: Record<string, [number, number, number, number]> = {
  general: [0.45, 0.3, 0.15, 0.1],
  coding: [0.5, 0.2, 0.15, 0.15],
  reasoning: [0.55, 0.15, 0.15, 0.15],
  chat: [0.4, 0.35, 0.15, 0.1],
  multimodal: [0.5, 0.2, 0.15, 0.15],
  embedding: [0.3, 0.4, 0.2, 0.1],
  tts: [0.4, 0.35, 0.15, 0.1],
  stt: [0.4, 0.35, 0.15, 0.1],
};

export const SPEED_TARGET: Record<string, number> = {
  general: 40,
  coding: 40,
  multimodal: 40,
  chat: 40,
  reasoning: 25,
  embedding: 200,
  tts: 40,
  stt: 40,
};

export const CONTEXT_TARGET: Record<string, number> = {
  general: 4096,
  chat: 4096,
  coding: 8192,
  reasoning: 8192,
  multimodal: 4096,
  embedding: 512,
  tts: 2048,
  stt: 2048,
};

function lookupBandwidth(gpuName: string | null | undefined): number | null {
  if (typeof gpuName !== 'string' || !gpuName) return null;
  const gn = gpuName.toLowerCase();
  for (const key of BW_KEYS_SORTED) {
    if (gn.includes(key)) return GPU_BANDWIDTH[key];
  }
  return null;
}

function estimateSpeed(
  model: CatalogModel,
  quant: string,
  runMode: string,
  system: HardwareSnapshot,
  offloadFrac = 0.0,
): number {
  const pb = activeParamsB(model);
  const isMoe = model.is_moe ?? false;
  const bw = lookupBandwidth(system.gpuName);
  const backend = system.backend || 'cpu_x86';

  if (bw && (runMode === 'gpu' || runMode === 'cpu_offload')) {
    // Streaming the weights once per token is what sets the ceiling, so this is the real
    // file size, not the quant's nominal bit width.
    const bpp = WEIGHT_GIB_PER_BILLION[quant] ?? DEFAULT_WEIGHT_GIB_PER_BILLION;
    const modelGb = pb * bpp;
    if (modelGb <= 0) return 0.0;
    const efficiency = 0.55;
    if (runMode === 'cpu_offload') {
      const cpuBw = 55.0;
      let frac = Math.min(Math.max(offloadFrac, 0.0), 1.0);
      if (frac <= 0.0) frac = 0.5;
      const effBw = 1.0 / (frac / cpuBw + (1.0 - frac) / bw);
      const rawTps = (effBw / modelGb) * efficiency;
      return rawTps * (isMoe ? 0.8 : 1.0);
    }
    const rawTps = (bw / modelGb) * efficiency;
    return rawTps * (isMoe ? 0.8 : 1.0);
  }

  const k = FALLBACK_K[backend] ?? 70;
  if (pb <= 0) return 0.0;
  const sm = QUANT_SPEED_MULT[quant] ?? 1.0;
  return (k / pb) * sm;
}

export function architectureBonus(model: CatalogModel): number {
  const name = (model.name || '').toLowerCase();
  const arch = (model.architecture || '').toLowerCase();
  const text = `${name} ${arch}`;

  if (text.includes('qwen3.8') || text.includes('qwen3_8')) return 10;
  if (text.includes('qwen3.6') || text.includes('qwen3_6')) return 9;
  if (text.includes('qwen3.5') || text.includes('qwen3_5')) return 8;
  if (text.includes('qwen3-next') || text.includes('qwen3_next')) return 6;
  if (text.includes('qwen3') || arch.startsWith('qwen3')) return 4;
  if (text.includes('qwen2.5') || text.includes('qwen2_5')) return 2;
  return 0;
}

function qualityScore(model: CatalogModel, quant: string, useCase: string): number {
  const pb = paramsB(model);
  let base: number;
  if (pb < 1) base = 30;
  else if (pb < 3) base = 45;
  else if (pb < 7) base = 60;
  else if (pb < 10) base = 75;
  else if (pb < 20) base = 82;
  else if (pb < 40) base = 89;
  else base = 95;

  const nameLower = (model.name || '').toLowerCase();
  if (nameLower.includes('qwen')) base += 2;
  if (nameLower.includes('deepseek')) base += 3;
  if (nameLower.includes('llama')) base += 2;
  if (nameLower.includes('mistral') || nameLower.includes('mixtral')) base += 1;
  if (nameLower.includes('gemma')) base += 1;

  base += architectureBonus(model);
  base += QUANT_QUALITY_PENALTY[quant] ?? 0;

  const modelUc = inferUseCase(model);
  if (modelUc === 'coding' && useCase === 'coding') base += 6;
  else if (modelUc === 'coding' && (useCase === 'general' || useCase === 'chat')) base -= 10;
  if (modelUc === 'reasoning' && useCase === 'reasoning' && pb >= 13) base += 5;
  else if (modelUc === 'reasoning' && useCase === 'chat') base -= 4;
  if (modelUc === 'multimodal' && useCase === 'multimodal') base += 6;

  return Math.max(0, Math.min(100, base));
}

function speedScore(tps: number, useCase: string): number {
  const target = SPEED_TARGET[useCase] ?? 40;
  return Math.max(0, Math.min(100, (tps / target) * 100));
}

function fitScore(required: number, available: number): number {
  if (required > available) return 0;
  if (available <= 0) return 0;
  const ratio = required / available;
  if (ratio <= 0.5) return 60 + (ratio / 0.5) * 40;
  if (ratio <= 0.8) return 100;
  if (ratio <= 0.9) return 70;
  return 50;
}

function contextScore(ctx: number, useCase: string): number {
  const target = CONTEXT_TARGET[useCase] ?? 4096;
  if (ctx >= target) return 100;
  if (ctx >= target / 2) return 70;
  return 30;
}

interface QuantFit {
  runMode: string;
  quant: string;
  ctx: number;
  requiredGb: number;
  geometrySource: GeometrySource;
}

/**
 * Largest configuration of `quant` that fits, preferring VRAM and then falling back to RAM.
 *
 * Weights, compute graph, and backend overhead are fixed once the quant is chosen, so the
 * context that fits a budget is solved directly. The previous halve-until-it-fits loop could
 * only ever report ctx, ctx/2, ctx/4 …, so a model that had room for 30k context was listed
 * at 16k, and one needing a 5% trim was cut in half.
 */
function tryQuantAt(
  model: CatalogModel,
  quant: string,
  ctx: number,
  gpuVram: number,
  availableRam: number,
): QuantFit | null {
  const geometry = geometryForModel(model);
  const weightsBytes = weightsBytesFor(paramsB(model), quant);
  // Guessed geometry earns a margin; a confident-looking number that OOMs is worse than a
  // conservative one. See GEOMETRY_UNCERTAINTY.
  const headroom = GEOMETRY_UNCERTAINTY[geometry.source] ?? 1;

  const estimateAt = (context: number, onGpu: boolean) =>
    estimateRunMemory({
      geometry,
      weightsBytes,
      ctx: context,
      backend: onGpu ? 'cuda' : 'cpu',
      nGpuLayers: onGpu ? undefined : 0,
    });

  const bestContextFor = (budgetGb: number, onGpu: boolean): number => {
    if (budgetGb <= 0) return 0;
    const budgetBytes = (budgetGb * GIB) / headroom;
    if (estimateAt(ctx, onGpu).totalBytes <= budgetBytes) return ctx;
    const kvBudget = budgetBytes - estimateAt(0, onGpu).totalBytes;
    return Math.min(ctx, maxContextForBudget(geometry, kvBudget, 'f16'));
  };

  const gpuCtx = gpuVram > 0 ? bestContextFor(gpuVram, true) : 0;
  if (gpuCtx > 0) {
    return {
      runMode: 'gpu',
      quant,
      ctx: gpuCtx,
      requiredGb: estimateAt(gpuCtx, true).totalGb,
      geometrySource: geometry.source,
    };
  }

  const cpuCtx = bestContextFor(availableRam, false);
  if (cpuCtx > 0) {
    return {
      runMode: gpuVram > 0 ? 'cpu_offload' : 'cpu_only',
      quant,
      ctx: cpuCtx,
      requiredGb: estimateAt(cpuCtx, false).totalGb,
      geometrySource: geometry.source,
    };
  }
  return null;
}

function quantBits(q: string | null | undefined): number {
  const qu = (q || '').toUpperCase().replace(/-/g, '').replace(/_/g, '').replace(/ /g, '');
  if (qu.startsWith('Q8') || qu.includes('FP8') || qu.includes('INT8') || qu.startsWith('W8')) return 8;
  if (
    qu.startsWith('Q4') ||
    qu.startsWith('IQ4') ||
    qu.includes('FP4') ||
    qu.includes('NF4') ||
    qu.includes('INT4') ||
    qu.startsWith('W4')
  )
    return 4;
  if (qu.startsWith('Q2') || qu.startsWith('IQ2')) return 2;
  if (qu.startsWith('Q3') || qu.startsWith('IQ3')) return 3;
  if (qu.startsWith('Q5')) return 5;
  if (qu.startsWith('Q6')) return 6;
  if (qu.startsWith('F16') || qu.startsWith('BF16') || qu.startsWith('F32')) return 16;
  const m =
    qu.match(/(?:AWQ|GPTQ|MLX|EXL2|BNB|INT|W)(\d{1,2})/) || qu.match(/(\d{1,2})BIT/);
  if (m) {
    const b = Number.parseInt(m[1], 10);
    if (b >= 2 && b <= 16) return b;
  }
  return 0;
}

function nativeQuant(model: CatalogModel): string {
  let nativeQuantLabel = model.quantization ?? 'Q4_K_M';
  const name = (model.name || '').toLowerCase();
  const fmt = (model.format || '').toLowerCase();
  const text = `${name} ${fmt}`;
  if (text.includes('nvfp4')) return 'NVFP4';
  if (/(^|[-_/])fp8($|[-_/\s])/.test(text)) return 'FP8';
  if (text.includes('gptq')) {
    const m = text.match(/(?:gptq|int|w)(?:[-_]?)(\d{1,2})(?:bit)?/);
    return m ? `GPTQ-Int${m[1]}` : 'GPTQ-Int4';
  }
  if (text.includes('awq')) {
    const m = text.match(/(?:awq|int|w)(?:[-_]?)(\d{1,2})(?:bit)?/);
    return m ? `AWQ-${m[1]}bit` : 'AWQ-4bit';
  }
  if (text.includes('mlx')) {
    const m = text.match(/mlx[-_]?(\d{1,2})bit/);
    return m ? `mlx-${m[1]}bit` : nativeQuantLabel;
  }
  if (
    !(model.is_gguf || model.gguf_sources?.length) &&
    /(^|[-_/])(?:int)?8bit($|[-_/\s])/.test(text)
  ) {
    return 'INT8';
  }
  return nativeQuantLabel;
}

export interface AnalyzeModelOptions {
  targetQuant?: string | null;
  scoringUseCase?: string | null;
  targetContext?: number | null;
}

export function analyzeModel(
  model: CatalogModel,
  system: HardwareSnapshot,
  options: AnalyzeModelOptions = {},
): ModelFitResult | null {
  const { targetQuant = null, scoringUseCase = null, targetContext = null } = options;

  const pb = paramsB(model);
  if (pb <= 0) return null;

  const modelUseCase = inferUseCase(model);
  const scoreUseCase = scoringUseCase || 'general';
  const hasGpu = system.hasGpu;
  const gpuVram = hasGpu ? (system.gpuVramGb ?? 0) : 0;
  const gpuCount = system.gpuCount || 1;
  const singleGpuVram = gpuCount > 1 ? gpuVram / gpuCount : gpuVram;
  const availableRam = system.availableRamGb;
  const gpuOnly = Boolean(system.gpu_only) && hasGpu && gpuVram > 0;
  const effRam = gpuOnly ? 0 : availableRam;
  const isMoe = model.is_moe ?? false;
  const modelCtx = model.context_length ?? 4096;
  let parsedTargetContext = 0;
  if (targetContext != null) {
    const n = Number(targetContext);
    parsedTargetContext = Number.isFinite(n) ? Math.trunc(n) : 0;
  }
  const ctx =
    parsedTargetContext > 0 ? Math.min(modelCtx, parsedTargetContext) : modelCtx;

  const nativeQuantLabel = nativeQuant(model);
  const preq = isPrequantized(model);

  const isGguf = Boolean(model.gguf_sources?.length);
  const quantUpper = (nativeQuantLabel || '').toUpperCase();
  const isGgufQuant = ['Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q8', 'IQ', 'F16', 'F32'].some((p) =>
    quantUpper.startsWith(p),
  );
  const effectiveVram =
    (isGguf || isGgufQuant) && !preq ? singleGpuVram : gpuVram;

  const nativeGpuOnly = preq && !nativeQuantLabel.startsWith('mlx-');

  const nativeQuantPrefixes = [
    'AWQ-',
    'GPTQ-',
    'FP8',
    'FP4',
    'NVFP4',
    'MXFP4',
    'NF4',
    'INT4',
    'INT8',
    'W4A16',
    'W8A8',
    'W8A16',
  ];

  let quantToTry: string;
  if (preq) {
    if (targetQuant) {
      if (!nativeQuantPrefixes.some((p) => targetQuant.startsWith(p))) return null;
      const tb = quantBits(targetQuant);
      const nb = quantBits(nativeQuantLabel);
      if (tb && nb && tb !== nb) return null;
    }
    quantToTry = nativeQuantLabel;
  } else if (targetQuant) {
    quantToTry = targetQuant;
  } else if (gpuCount >= 2) {
    quantToTry = 'BF16';
  } else {
    quantToTry = 'Q4_K_M';
  }

  if (
    gpuCount >= 2 &&
    quantToTry &&
    !targetQuant &&
    ['Q2', 'Q3', 'Q4', 'Q5', 'Q6', 'Q8', 'IQ'].some((p) => quantToTry.toUpperCase().startsWith(p))
  ) {
    return null;
  }

  const result = tryQuantAt(
    model,
    quantToTry,
    ctx,
    effectiveVram,
    nativeGpuOnly ? 0 : effRam,
  );

  if (result === null) {
    const oversizedRequired = estimateMemoryGb(model, quantToTry, ctx);
    return {
      geometry_source: geometryForModel(model).source,
      name: model.name,
      provider: model.provider,
      parameter_count: model.parameter_count,
      params_b: Math.round(pb * 10) / 10,
      is_moe: isMoe,
      use_case: modelUseCase,
      fit_level: 'too_tight',
      run_mode: 'no_fit',
      quant: quantToTry,
      context: ctx,
      size_gb: estimateFileSizeGb(pb, quantToTry),
      required_gb: Math.round(oversizedRequired * 10) / 10,
      speed_tps: 0,
      score: 0,
      scores: { quality: 0, speed: 0, fit: 0, context: 0 },
      gguf_sources: model.gguf_sources ?? [],
      context_length: modelCtx,
      target_context: parsedTargetContext || null,
    };
  }

  const { runMode, quant, ctx: fitCtx, requiredGb } = result;

  const budget = runMode === 'gpu' ? effectiveVram : availableRam;
  if (requiredGb > budget) return null;

  let fitLevel: string;
  if (runMode === 'gpu') {
    const rec = model.recommended_ram_gb ?? requiredGb;
    if (rec <= gpuVram) fitLevel = 'perfect';
    else if (gpuVram >= requiredGb * 1.2) fitLevel = 'good';
    else fitLevel = 'marginal';
  } else if (runMode === 'cpu_offload') {
    fitLevel = availableRam >= requiredGb * 1.2 ? 'good' : 'marginal';
  } else {
    fitLevel = 'marginal';
  }

  let offloadFrac = 0.0;
  if (runMode === 'cpu_offload' && requiredGb > 0 && effectiveVram > 0) {
    offloadFrac = Math.max(0.0, (requiredGb - effectiveVram) / requiredGb);
  }
  const tps = estimateSpeed(model, quant, runMode, system, offloadFrac);

  const qScore = qualityScore(model, quant, scoreUseCase);
  const sScore = speedScore(tps, scoreUseCase);
  const fScore = fitScore(requiredGb, budget);
  const cScore = contextScore(fitCtx, scoreUseCase);

  const [wq, ws, wf, wc] = USE_CASE_WEIGHTS[scoreUseCase] ?? [0.45, 0.3, 0.15, 0.1];
  const composite = qScore * wq + sScore * ws + fScore * wf + cScore * wc;

  return {
    name: model.name,
    provider: model.provider,
    parameter_count: model.parameter_count,
    params_b: Math.round(pb * 10) / 10,
    is_moe: isMoe,
    use_case: modelUseCase,
    fit_level: fitLevel,
    run_mode: runMode,
    quant,
    context: fitCtx,
    size_gb: estimateFileSizeGb(pb, quant),
    required_gb: Math.round(requiredGb * 10) / 10,
    speed_tps: Math.round(tps * 10) / 10,
    score: Math.round(composite * 10) / 10,
    scores: {
      quality: Math.round(qScore * 10) / 10,
      speed: Math.round(sScore * 10) / 10,
      fit: Math.round(fScore * 10) / 10,
      context: Math.round(cScore * 10) / 10,
    },
    gguf_sources: model.gguf_sources ?? [],
    context_length: modelCtx,
    release_date: model.release_date ?? '',
    target_context: parsedTargetContext || null,
    geometry_source: result.geometrySource,
  };
}

function versionKey(name: string | null | undefined): number {
  if (!name) return 0.0;
  const re = /[A-Za-z](\d+(?:\.\d+)?)(?![A-Za-z])/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(name)) !== null) {
    const val = match[1];
    let f: number;
    try {
      f = Number.parseFloat(val);
    } catch {
      continue;
    }
    if (!Number.isFinite(f)) continue;
    if (!val.includes('.') && f >= 100) continue;
    return f;
  }
  return 0.0;
}

type SortKey = number | string | [number, number];

export const SORT_KEYS: Record<string, (r: ModelFitResult) => SortKey> = {
  score: (r) => [r.score, versionKey(r.name)],
  speed: (r) => r.speed_tps,
  quality: (r) => r.scores.quality,
  size: (r) => -r.size_gb,
  vram: (r) => r.required_gb,
  params: (r) => r.params_b,
  context: (r) => r.context,
  newest: (r) => r.release_date ?? '',
};

/**
 * Apply the Models "GPU budget" toggle to a hardware snapshot before ranking.
 * Index 0 = RAM only (no GPU). Index 1+ = a specific homogeneous GPU pool.
 */
export function hardwareForGpuBudget(
  hw: HardwareSnapshot,
  gpuGroupIndex: number,
): HardwareSnapshot {
  if (gpuGroupIndex <= 0) {
    return {
      ...hw,
      hasGpu: false,
      gpuVramGb: 0,
      gpuCount: 0,
      gpu_only: false,
    };
  }
  const group = hw.gpuGroups?.[gpuGroupIndex - 1];
  if (!group) return hw;
  return {
    ...hw,
    hasGpu: true,
    gpuVramGb: group.vramTotal,
    gpuCount: group.count,
    gpuName: group.name,
    gpu_only: true,
  };
}

/** Default GPU budget index when hardware is first probed (prefer GPU when present). */
export function defaultGpuGroupIndex(hw: HardwareSnapshot): number {
  return hw.gpuGroups?.length ? 1 : 0;
}

/** Keep a prior GPU budget selection when rescanning if the pool still exists. */
export function resolveGpuGroupIndexAfterRescan(
  hw: HardwareSnapshot,
  previousIndex: number,
): number {
  if (previousIndex === 0) return 0;
  const max = hw.gpuGroups?.length ?? 0;
  if (previousIndex > 0 && previousIndex <= max) return previousIndex;
  return defaultGpuGroupIndex(hw);
}

export interface RankModelsOptions {
  useCase?: string | null;
  limit?: number;
  search?: string | null;
  sort?: string;
  quant?: string | null;
  targetContext?: number | null;
  fitOnly?: boolean;
}

export async function rankModels(
  system: HardwareSnapshot,
  options: RankModelsOptions = {},
): Promise<ModelFitResult[]> {
  const {
    useCase = null,
    limit = 50,
    search = null,
    sort = 'score',
    quant = null,
    targetContext = null,
    fitOnly = false,
  } = options;

  const models = await getModels();
  const results: ModelFitResult[] = [];

  const filterNative =
    quant &&
    ['AWQ-', 'GPTQ-', 'FP8', 'FP4', 'NVFP4', 'MXFP4', 'NF4', 'INT4', 'INT8', 'W4A16', 'W8A8', 'W8A16'].some(
      (p) => quant.startsWith(p),
    );

  const systemBackend = (system.backend || '').toLowerCase();
  const appleSilicon = ['mps', 'metal', 'apple'].includes(systemBackend);
  const rocm = systemBackend === 'rocm';
  const isWindows = system.platform === 'windows';
  const gpuFamily = (system.gpuFamily || '').toLowerCase();
  const consumerAmd = systemBackend === 'rocm' && gpuFamily === 'rdna';

  for (const m of models) {
    const nativeQ = nativeQuant(m);

    if (nativeQ.startsWith('mlx-') || (m.name || '').toLowerCase().includes('mlx')) continue;

    if (rocm && isPrequantized(m) && !filterNative) continue;

    if (
      (appleSilicon || consumerAmd || isWindows) &&
      !(m.is_gguf || m.gguf_sources?.length)
    ) {
      continue;
    }

    if (filterNative) {
      if (quant === 'FP8' && nativeQ !== 'FP8') continue;
      if (quant === 'FP4' && !['FP4', 'NVFP4', 'MXFP4', 'NF4'].includes(nativeQ)) continue;
      if (quant.startsWith('AWQ') && !nativeQ.startsWith('AWQ')) continue;
      if (quant.startsWith('GPTQ') && !nativeQ.startsWith('GPTQ')) continue;
      if (quant.startsWith('NVFP4') && !nativeQ.startsWith('NVFP4')) continue;
      if (
        ['INT4', 'INT8', 'W4A16', 'W8A8', 'W8A16'].includes(quant) &&
        nativeQ !== quant
      ) {
        continue;
      }
    }

    if (search) {
      const name = (m.name || '').toLowerCase();
      const provider = (m.provider || '').toLowerCase();
      const needle = search.toLowerCase();
      if (!name.includes(needle) && !provider.includes(needle)) continue;
    }

    const result = analyzeModel(m, system, {
      targetQuant: quant,
      scoringUseCase: useCase || 'general',
      targetContext,
    });
    if (result === null) continue;

    if (useCase) {
      const modelUc = inferUseCase(m);
      if (useCase !== modelUc && useCase !== 'general') continue;
    }

    results.push(result);
  }

  let filtered = results;
  if (fitOnly) {
    filtered = results.filter((r) => r.fit_level !== 'too_tight');
  }

  const sortFn = SORT_KEYS[sort] ?? SORT_KEYS.score;
  filtered.sort((a, b) => {
    const ka = sortFn(a);
    const kb = sortFn(b);
    if (Array.isArray(ka) && Array.isArray(kb)) {
      if (kb[0] !== ka[0]) return kb[0] - ka[0];
      return kb[1] - ka[1];
    }
    if (typeof ka === 'number' && typeof kb === 'number') return kb - ka;
    if (typeof ka === 'string' && typeof kb === 'string') return kb.localeCompare(ka);
    return 0;
  });

  if (fitOnly) {
    return filtered.slice(0, limit);
  }

  // Score sort pushes too_tight rows to the bottom; without a reserved slice they
  // never appear in the UI limit and the "Fit only" toggle looks broken.
  const fitting = filtered.filter((r) => r.fit_level !== 'too_tight');
  const tight = filtered.filter((r) => r.fit_level === 'too_tight');
  if (tight.length === 0) {
    return fitting.slice(0, limit);
  }

  const tightSlots = Math.min(tight.length, Math.max(1, Math.floor(limit * 0.25)));
  const fitSlots = Math.max(0, limit - tightSlots);
  return [...fitting.slice(0, fitSlots), ...tight.slice(0, tightSlots)];
}

/** Exposed for UI / tests that need native quant resolution. */
export { nativeQuant, lookupBandwidth, versionKey };
