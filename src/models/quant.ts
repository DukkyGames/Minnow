import { estimateRunMemory, GIB, weightsBytesFor } from './memory-model.mjs';
import { resolveGeometry } from './model-geometry.mjs';
import type { ModelGeometry } from './model-geometry.d.mts';
import type { CatalogModel } from './types';

/** GGUF quant tiers ordered best-quality first. */
export const QUANT_HIERARCHY = ['Q8_0', 'Q6_K', 'Q5_K_M', 'Q4_K_M', 'Q3_K_M', 'Q2_K'] as const;

export const QUANT_SPEED_MULT: Record<string, number> = {
  F16: 0.6,
  BF16: 0.6,
  FP8: 0.85,
  FP4: 1.15,
  NVFP4: 1.15,
  MXFP4: 1.15,
  NF4: 1.1,
  INT4: 1.15,
  INT8: 0.85,
  W4A16: 1.15,
  W8A8: 0.85,
  W8A16: 0.85,
  Q8_0: 0.8,
  Q6_K: 0.95,
  Q5_K_M: 1.0,
  Q4_K_M: 1.15,
  Q4_0: 1.15,
  Q3_K_M: 1.25,
  Q2_K: 1.35,
  'AWQ-4bit': 1.2,
  'AWQ-8bit': 0.85,
  'GPTQ-Int4': 1.2,
  'GPTQ-Int8': 0.85,
  'mlx-4bit': 1.15,
  'mlx-8bit': 0.85,
  'mlx-6bit': 1.0,
  'FP4-MoE-Mixed': 1.1,
  'FP8-Mixed': 0.85,
};

export const QUANT_QUALITY_PENALTY: Record<string, number> = {
  F16: 0.0,
  BF16: 0.0,
  FP8: 0.0,
  FP4: -3.0,
  NVFP4: -3.0,
  MXFP4: -3.0,
  NF4: -4.0,
  INT4: -4.0,
  INT8: 0.0,
  W4A16: -4.0,
  W8A8: 0.0,
  W8A16: 0.0,
  Q8_0: 0.0,
  Q6_K: -1.0,
  Q5_K_M: -2.0,
  Q4_K_M: -5.0,
  Q4_0: -5.0,
  Q3_K_M: -8.0,
  Q2_K: -12.0,
  AWQ: -1.0,
  'AWQ-4bit': -4.0,
  'AWQ-8bit': -1.0,
  GPTQ: -1.0,
  'GPTQ-Int4': -4.0,
  'GPTQ-Int8': -1.0,
  'mlx-4bit': -4.0,
  'mlx-8bit': -0.5,
  'mlx-6bit': -1.5,
  'FP4-MoE-Mixed': -0.5,
  'FP8-Mixed': 0.0,
};


/** Pre-quantized formats that should NOT go through the GGUF quant hierarchy. */
export const PREQUANTIZED_PREFIXES = [
  'AWQ-',
  'GPTQ-',
  'mlx-',
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
  'FP4-MoE-Mixed',
  'FP8-Mixed',
] as const;

export function inferQuantizationFromName(name: string | undefined | null): string {
  const n = (name || '').toLowerCase();
  if (n.includes('nvfp4')) return 'NVFP4';
  if (n.includes('mxfp4')) return 'MXFP4';
  if (/(^|[-_/])nf4($|[-_/])/.test(n)) return 'NF4';
  if (/(^|[-_/])fp4($|[-_/])/.test(n)) return 'FP4';
  if (/(^|[-_/])w4a16($|[-_/])/.test(n)) return 'W4A16';
  if (/(^|[-_/])w8a8($|[-_/])/.test(n)) return 'W8A8';
  if (/(^|[-_/])w8a16($|[-_/])/.test(n)) return 'W8A16';
  const is8 = n.includes('8bit') || n.includes('8-bit') || n.includes('int8');
  if (n.includes('awq')) return is8 ? 'AWQ-8bit' : 'AWQ-4bit';
  if (n.includes('gptq')) return is8 ? 'GPTQ-Int8' : 'GPTQ-Int4';
  if (n.includes('mlx')) {
    if (n.includes('6bit')) return 'mlx-6bit';
    return is8 ? 'mlx-8bit' : 'mlx-4bit';
  }
  if (n.includes('fp8')) return 'FP8';
  if (n.includes('int4') || n.includes('4bit') || n.includes('4-bit')) return 'INT4';
  if (n.includes('int8') || n.includes('8bit') || n.includes('8-bit')) return 'INT8';
  return '';
}

export function isPrequantized(model: CatalogModel): boolean {
  const q = model.quantization ?? '';
  const name = (model.name || '').toLowerCase();
  const fmt = (model.format || '').toLowerCase();
  const text = `${name} ${fmt}`;
  return (
    text.includes('nvfp4') ||
    /(^|[-_/])fp8($|[-_/\s])/.test(text) ||
    (!(model.is_gguf || model.gguf_sources?.length) &&
      /(^|[-_/])(?:int)?8bit($|[-_/\s])/.test(text)) ||
    ['awq', 'gptq', 'mlx'].some((x) => text.includes(x)) ||
    PREQUANTIZED_PREFIXES.some((p) => q.startsWith(p))
  );
}

export function paramsB(model: CatalogModel): number {
  const raw = model.parameters_raw;
  if (raw && raw > 0) return raw / 1_000_000_000.0;

  const pc = model.parameter_count;
  if (pc) {
    const normalized = pc.trim().toUpperCase();
    const m = normalized.match(/^([\d.]+)\s*([BKMGT]?)$/);
    if (m) {
      let val: number;
      try {
        val = Number.parseFloat(m[1]);
      } catch {
        return 0.0;
      }
      if (!Number.isFinite(val)) return 0.0;
      const suffix = m[2];
      if (suffix === 'B') return val;
      if (suffix === 'M') return val / 1000.0;
      if (suffix === 'K') return val / 1_000_000.0;
      if (suffix === 'T') return val * 1000.0;
      if (val >= 1_000_000) return val / 1_000_000_000.0;
      if (val >= 1000) return val / 1000.0;
      return val / 1000.0;
    }
  }
  return 0.0;
}

export function activeParamsB(model: CatalogModel): number {
  if (model.is_moe && model.active_parameters) {
    return model.active_parameters / 1_000_000_000.0;
  }
  return paramsB(model);
}

/** Attention geometry for a catalog row, resolved from architecture + parameter count. */
export function geometryForModel(model: CatalogModel): ModelGeometry {
  return resolveGeometry({
    architecture: model.architecture,
    name: model.name,
    paramsB: paramsB(model),
    activeParamsB: activeParamsB(model),
    nExperts: model.num_experts,
  });
}

/**
 * Memory a model needs to run, all layers on GPU.
 *
 * Delegates to the shared physical model in memory-model.mjs. The previous formula here was
 * `pb * bpp + 0.000008 * activeParams * ctx + 0.5`, whose KV term scaled with parameter count
 * — a relationship that does not exist — and landed anywhere from 17x low (Qwen3-0.6B) to
 * 1.9x high (Llama-3.3-70B).
 */
export function estimateMemoryGb(model: CatalogModel, quant: string, ctx: number): number {
  return estimateRunMemory({
    geometry: geometryForModel(model),
    weightsBytes: weightsBytesFor(paramsB(model), quant),
    ctx,
  }).totalGb;
}

/** Approximate on-disk GGUF / weights size from parameter count and quant tier. */
export function estimateFileSizeGb(paramsBillion: number, quant: string): number {
  return Math.round((weightsBytesFor(paramsBillion, quant) / GIB) * 10) / 10;
}

export function bestQuantForBudget(
  model: CatalogModel,
  budgetGb: number,
  ctx: number,
): [string, number, number] | [null, null, null] {
  if (isPrequantized(model)) {
    const q = model.quantization ?? 'Q4_K_M';
    let mem = estimateMemoryGb(model, q, ctx);
    if (mem <= budgetGb) return [q, ctx, mem];
    let curCtx = Math.floor(ctx / 2);
    while (curCtx >= 1024) {
      mem = estimateMemoryGb(model, q, curCtx);
      if (mem <= budgetGb) return [q, curCtx, mem];
      curCtx = Math.floor(curCtx / 2);
    }
    return [null, null, null];
  }

  for (const q of QUANT_HIERARCHY) {
    const mem = estimateMemoryGb(model, q, ctx);
    if (mem <= budgetGb) return [q, ctx, mem];
  }

  let curCtx = Math.floor(ctx / 2);
  while (curCtx >= 1024) {
    for (const q of QUANT_HIERARCHY) {
      const mem = estimateMemoryGb(model, q, curCtx);
      if (mem <= budgetGb) return [q, curCtx, mem];
    }
    curCtx = Math.floor(curCtx / 2);
  }

  return [null, null, null];
}

export function inferUseCase(model: CatalogModel): string {
  const name = (model.name || '').toLowerCase();
  const uc = (model.use_case || '').toLowerCase();
  const combined = name + ' ' + uc;

  if (['embedding', 'embed', 'bge'].some((k) => combined.includes(k))) return 'embedding';
  if (['tts', 'text-to-speech', 'speech-synthesis', 'cosyvoice', 'parler'].some((k) => combined.includes(k)))
    return 'tts';
  if (['stt', 'speech-to-text', 'whisper', 'transcri', 'asr'].some((k) => combined.includes(k))) return 'stt';
  if (combined.includes('code')) return 'coding';
  if (['vision', 'multimodal', 'vlm', 'vl-'].some((k) => combined.includes(k))) return 'multimodal';
  if (['reason', 'chain-of-thought', 'deepseek-r1'].some((k) => combined.includes(k))) return 'reasoning';
  if (['chat', 'instruction'].some((k) => combined.includes(k))) return 'chat';
  return 'general';
}
