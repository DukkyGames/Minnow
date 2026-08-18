/**
 * VRAM / RAM estimates for llama.cpp launch settings in the Models inspector.
 *
 * A thin adapter over the shared model in memory-model.mjs. The arithmetic used to live here
 * as its own set of constants, which is how the Load tab and the discovery ranking ended up
 * disagreeing by 2x about the same model at the same context — this file applied a KV
 * precision factor that the ranking path did not, on top of a KV term that was wrong in both.
 */

import { estimateRunMemory, kvBytesPerToken, GIB } from './memory-model.mjs';
import { geometryFromGgufMetadata, resolveGeometry } from './model-geometry.mjs';
import type { GeometrySource, ModelGeometry } from './model-geometry.d.mts';

export interface ServeMemoryEstimate {
  vramGb: number;
  ramGb: number;
  totalGb: number;
  /** Cost of one more token of context, for the "can I raise ctx?" hint. */
  kvGbPer1kTokens: number;
  /** Transformer blocks — the real maximum for the GPU-layers slider. */
  layerCount: number;
  geometrySource: GeometrySource;
}

/** GGUF header facts, as returned by `GET /api/models/gguf-meta`. */
export interface GgufGeometryFacts {
  arch?: string;
  nLayers?: number;
  nKvHeads?: number;
  headDim?: number;
  nEmbd?: number;
  nVocab?: number;
  nExperts?: number;
  swaWindow?: number;
  swaPeriod?: number;
  /** Exact full-attention layer count (hybrid / SWA pattern). */
  nFullAttentionLayers?: number;
  /** `{arch}.full_attention_interval` — Gated DeltaNet hybrids (Qwen3.5 / 3.8). */
  fullAttentionInterval?: number;
  swaHeadDim?: number;
  layerBytes?: number;
  fixedBytes?: number;
  /** Trained context window from the header — hard ceiling for the inspector slider. */
  trainCtx?: number;
}

export interface ServeMemoryInput {
  weightsGb: number;
  paramsB: number | null | undefined;
  ctx: number;
  cacheType?: string;
  /** llama.cpp `-ngl`: 0 = CPU, 999 = every layer on GPU. */
  nGpuLayers?: number;
  /** Exact header facts when the weights are on disk — always preferred. */
  gguf?: GgufGeometryFacts | null;
  /** Catalog hints, used only when the header is unavailable. */
  arch?: string | null;
  name?: string | null;
  backend?: string | null;
  deviceCount?: number;
}

/** Best geometry available for a library row. */
export function geometryForServe(input: ServeMemoryInput): ModelGeometry {
  const exact = input.gguf ? geometryFromGgufMetadata(input.gguf) : null;
  if (exact) return exact;
  return resolveGeometry({
    architecture: input.arch ?? undefined,
    name: input.name ?? undefined,
    paramsB: input.paramsB ?? undefined,
  });
}

/**
 * Transformer block count — exact from the GGUF header when we have it, otherwise the best
 * guess from architecture and parameter count.
 */
export function estimateTransformerLayerCount(
  paramsB: number | null | undefined,
  hints: { gguf?: GgufGeometryFacts | null; arch?: string | null; name?: string | null } = {},
): number {
  return geometryForServe({ weightsGb: 0, paramsB, ctx: 0, ...hints }).nLayers;
}

/**
 * Estimate the memory split for a launch configuration.
 *
 * `nGpuLayers` uses llama.cpp semantics: 0 = CPU, 999 = all layers on GPU. Partial offload
 * splits the KV cache along with the layers, which the previous version did not — it charged
 * the whole cache to VRAM even at `-ngl 1`.
 */
export function estimateServeMemory(input: ServeMemoryInput): ServeMemoryEstimate {
  const geometry = geometryForServe(input);
  const cacheType = input.cacheType ?? 'f16';
  const estimate = estimateRunMemory({
    geometry,
    weightsBytes: Math.max(0, input.weightsGb) * GIB,
    ctx: Math.max(0, input.ctx),
    cacheType,
    nGpuLayers: input.nGpuLayers,
    backend: input.backend ?? undefined,
    deviceCount: input.deviceCount,
  });

  return {
    vramGb: estimate.vramGb,
    ramGb: estimate.ramGb,
    totalGb: estimate.totalGb,
    kvGbPer1kTokens: Math.round((kvBytesPerToken(geometry, cacheType) * 1000) / GIB * 100) / 100,
    layerCount: geometry.nLayers,
    geometrySource: geometry.source,
  };
}

/**
 * Host allocations below this never decide whether a configuration fits, so a fully offloaded
 * run reads as plain "VRAM" rather than dragging a 0.2 GB RAM term through the hint.
 */
export const RAM_TERM_FLOOR_GB = 0.5;

/** Human-readable estimate for the Load tab hint line. */
export function formatServeMemoryEstimate(estimate: ServeMemoryEstimate): string {
  if (estimate.vramGb > 0 && estimate.ramGb >= RAM_TERM_FLOOR_GB) {
    return `~${estimate.vramGb} GB VRAM + ~${estimate.ramGb} GB RAM`;
  }
  if (estimate.vramGb > 0) return `~${estimate.vramGb} GB VRAM`;
  return `~${estimate.ramGb} GB RAM`;
}
