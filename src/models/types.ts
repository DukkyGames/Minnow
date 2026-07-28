/** Catalog model entry — hwfit catalog JSON shape. */
export interface CatalogModel {
  name: string;
  provider: string;
  parameter_count?: string;
  parameters_raw?: number;
  active_parameters?: number;
  min_ram_gb?: number;
  recommended_ram_gb?: number;
  min_vram_gb?: number;
  quantization?: string;
  context_length?: number;
  use_case?: string;
  capabilities?: string[];
  pipeline_tag?: string;
  architecture?: string;
  release_date?: string;
  is_moe?: boolean;
  is_gguf?: boolean;
  gguf_sources?: Array<{ repo: string; provider?: string }>;
  format?: string;
  _discovered?: boolean;
}

/** Hardware snapshot from GET /api/system/hardware. */
export interface HardwareSnapshot {
  os: string;
  platform: string;
  arch: string;
  cpuName: string;
  cpuCores: number;
  totalRamGb: number;
  availableRamGb: number;
  hasGpu: boolean;
  gpuName: string | null;
  gpuVramGb: number | null;
  gpuCount: number;
  gpus: Array<{ index: number; name: string; vramGb: number }>;
  gpuGroups: Array<{
    name: string;
    vramEach: number;
    count: number;
    indices: number[];
    vramTotal: number;
  }>;
  homogeneous: boolean;
  backend: string;
  unifiedMemory: boolean;
  gpuFamily?: string | null;
  gpuError?: string | null;
  detectedAt: number;
  gpu_only?: boolean;
}

/** Ranked model row from analyze_model / rank_models. */
export interface ModelFitResult {
  name: string;
  provider: string;
  parameter_count?: string;
  params_b: number;
  is_moe: boolean;
  use_case: string;
  fit_level: string;
  run_mode: string;
  quant: string;
  context: number;
  size_gb: number;
  required_gb: number;
  speed_tps: number;
  score: number;
  scores: { quality: number; speed: number; fit: number; context: number };
  gguf_sources: string[] | Array<{ repo: string; provider?: string }>;
  context_length: number;
  release_date?: string;
  target_context?: number | null;
  is_image_gen?: boolean;
}
