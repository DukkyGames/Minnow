export type GeometrySource = 'gguf' | 'family' | 'heuristic';

export interface ModelGeometry {
  /** Transformer blocks. */
  nLayers: number;
  /** Key/value heads per block (GQA width). */
  nKvHeads: number;
  /** Size of one attention head. */
  headDim: number;
  /** Hidden size. */
  nEmbd: number;
  /** Vocabulary size — drives the logits buffer. */
  nVocab: number;
  /** MoE expert count; 0 for dense models. */
  nExperts: number;
  /** Sliding-window size in tokens; 0 when every layer is full attention. */
  swaWindow: number;
  /** One full-attention layer every N layers; 1 when there is no SWA. */
  swaPeriod: number;
  source: GeometrySource;
  /** Exact full-attention layer count from a per-layer pattern; overrides `swaPeriod`. */
  nFullAttentionLayers?: number;
  /** Head size on sliding-window layers, when it differs from `headDim`. */
  swaHeadDim?: number;
  /** Exact bytes of repeating `blk.*` tensors (GGUF only). */
  layerBytes?: number;
  /** Exact bytes of embedding / output tensors (GGUF only). */
  fixedBytes?: number;
  /**
   * `<arch>.nextn_predict_layers` — multi-token-prediction heads shipped inside the
   * weights. Non-zero is what makes `--spec-type draft-mtp` startable with no draft
   * model. GGUF headers only; undefined for family-derived geometry.
   */
  nextnPredictLayers?: number;
}

export interface GeometryInput {
  /** HF `model_type` (catalog `architecture` field). */
  architecture?: string;
  /** Model or file name, used when architecture is missing. */
  name?: string;
  /** Total parameters in billions. */
  paramsB?: number;
  /** Active parameters in billions (MoE). */
  activeParamsB?: number;
  nExperts?: number;
}

export interface FamilySize {
  paramsB: number;
  nLayers: number;
  nEmbd: number;
  nKvHeads?: number;
  headDim?: number;
  nExperts?: number;
}

export interface Family {
  nKvHeads: number;
  headDim: number;
  nVocab: number;
  swaWindow?: number;
  swaPeriod?: number;
  sizes: FamilySize[];
}

export declare const GEOMETRY_FAMILIES: Record<string, Family>;
export declare const GEOMETRY_UNCERTAINTY: Record<GeometrySource, number>;
export declare function heuristicLayerCount(paramsB: number): number;
export declare function resolveFamilyKey(input: GeometryInput): string | null;
export declare function heuristicGeometry(input: GeometryInput, family?: Family): ModelGeometry;
export declare function resolveGeometry(input: GeometryInput): ModelGeometry;
/** Accepts a parsed GGUF header (see server/models/gguf-metadata.js). */
export declare function geometryFromGgufMetadata(
  meta: Partial<Record<string, unknown>> | object | null | undefined,
): ModelGeometry | null;
