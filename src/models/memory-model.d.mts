import type { GeometrySource, ModelGeometry } from './model-geometry.d.mts';

export declare const GIB: number;
export declare const KV_TYPE_BYTES: Record<string, number>;
export declare const WEIGHT_GIB_PER_BILLION: Record<string, number>;
export declare const DEFAULT_WEIGHT_GIB_PER_BILLION: number;
export declare const DEFAULT_UBATCH: number;

/**
 * A KV cache quantization: one value for both caches, or a `--cache-type-k` /
 * `--cache-type-v` pair when the user set them independently.
 */
export type KvCacheType = string | { k?: string; v?: string };

export interface MemoryEstimateInput {
  geometry: ModelGeometry;
  /** Exact file size when the weights are on disk. */
  weightsBytes: number;
  ctx: number;
  /** `--cache-type-k/v`; a single value or a `{k, v}` pair. Defaults to f16. */
  cacheType?: KvCacheType;
  /** llama.cpp `-ngl`. Undefined or >= nLayers means all layers on GPU. */
  nGpuLayers?: number;
  /** cuda | rocm | vulkan | metal | cpu. */
  backend?: string;
  deviceCount?: number;
  ubatch?: number;
  /** `--swa-full`: sliding-window layers hold the full context. */
  swaFull?: boolean;
  /** Speculative draft model file size, when one is set. */
  draftWeightsBytes?: number;
}

export interface MemoryEstimateBreakdown {
  weightsVram: number;
  weightsRam: number;
  kvVram: number;
  kvRam: number;
  compute: number;
  overhead: number;
}

export interface MemoryEstimate {
  vramGb: number;
  ramGb: number;
  totalGb: number;
  vramBytes: number;
  ramBytes: number;
  totalBytes: number;
  kvBytesPerToken: number;
  gpuLayers: number;
  nLayers: number;
  geometrySource: GeometrySource;
  /** Bytes. */
  breakdown: MemoryEstimateBreakdown;
}

export declare function kvElementBytes(cacheType?: string | null): number;
export declare function kvElementBytesPair(
  cacheType?: KvCacheType | null,
): { k: number; v: number };
export declare function fullAttentionLayers(geometry: ModelGeometry): number;
export declare function kvCacheBytes(
  geometry: ModelGeometry,
  ctx: number,
  cacheType?: KvCacheType,
  opts?: { ubatch?: number; parallel?: number; swaFull?: boolean },
): number;
export declare function kvBytesPerToken(
  geometry: ModelGeometry,
  cacheType?: KvCacheType,
): number;
export declare function computeBufferBytes(
  geometry: ModelGeometry,
  opts?: { ubatch?: number },
): number;
export declare function backendOverheadBytes(
  backend?: string | null,
  deviceCount?: number,
): number;
export declare function weightsBytesFor(paramsB: number, quant: string): number;
export declare function estimateRunMemory(input: MemoryEstimateInput): MemoryEstimate;
export declare function maxContextForBudget(
  geometry: ModelGeometry,
  budgetBytes: number,
  cacheType?: KvCacheType,
  opts?: {
    ubatch?: number;
    minCtx?: number;
    maxCtx?: number;
    /**
     * `'power2'` (default) preserves Discover/fit.ts display values.
     * `'none'` returns the raw token count so launch-plan can snap to CONTEXT_LADDER.
     */
    snap?: 'power2' | 'none';
  },
): number;
export declare function formatMemoryEstimate(estimate: MemoryEstimate): string;
