/**
 * Models app server API client.
 */

export interface DownloadJob {
  id: string;
  repoId: string;
  filename: string;
  quant: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  bytesReceived: number;
  totalBytes: number | null;
  destPath: string;
  error: string | null;
  createdAt: number;
  finishedAt: number | null;
}

export interface InstalledArtifact {
  repoId: string;
  filename: string;
  path: string;
  sizeBytes: number;
  mtimeMs: number;
}

export interface ServeRecord {
  id: string;
  runtime: string;
  modelPath: string;
  modelLabel: string;
  port: number;
  baseUrl: string;
  providerId: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  runId: string | null;
  pid: number | null;
  error: string | null;
  startedAt: number;
  stoppedAt: number | null;
}

export interface CachedModelRow {
  repo_id: string;
  size_bytes: number;
  nb_files: number;
  has_incomplete: boolean;
  path: string;
  is_gguf?: boolean;
  is_ollama?: boolean;
  is_local_dir?: boolean;
  status?: string;
  gguf_files?: Array<{
    name: string;
    rel_path: string;
    size_bytes: number;
    role: string;
    quant: string;
  }>;
}

export interface ServeProfile {
  key: string;
  label: string;
  quant: string;
  n_gpu_layers: number;
  n_cpu_moe: number;
  cache_type: string;
  ctx: number;
  est_vram_gb: number;
  fits: boolean;
  note: string;
}

export interface ModelsConfigView {
  hfTokenConfigured: boolean;
  hfTokenMasked: string;
  modelDirs: string[];
}

export interface RuntimeDetection {
  llamaCpp: {
    available: boolean;
    path: string | null;
    bundled: boolean;
    installable: boolean;
  };
  ollama: { available: boolean; path: string | null; serving: boolean; baseUrl: string | null };
  lmStudio: { available: boolean; baseUrl: string | null };
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export async function fetchModelsPing(): Promise<boolean> {
  const res = await fetch('/api/models/ping');
  return res.ok;
}

export async function startModelDownload(payload: {
  repoId: string;
  quant?: string;
  filename?: string;
}): Promise<DownloadJob> {
  const res = await fetch('/api/models/download', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ job: DownloadJob }>(res);
  return data.job;
}

export function subscribeDownloadProgress(
  jobId: string,
  onEvent: (event: {
    jobId: string;
    status: DownloadJob['status'];
    bytesReceived: number;
    totalBytes: number | null;
    error?: string | null;
  }) => void,
): () => void {
  const source = new EventSource(`/api/models/download/${jobId}/stream`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      /* ignore malformed */
    }
  };
  return () => source.close();
}

export async function cancelModelDownload(jobId: string): Promise<DownloadJob> {
  const res = await fetch(`/api/models/download/${jobId}/cancel`, { method: 'POST' });
  const data = await parseJson<{ job: DownloadJob }>(res);
  return data.job;
}

export async function listModelDownloads(): Promise<DownloadJob[]> {
  const res = await fetch('/api/models/downloads');
  const data = await parseJson<{ jobs: DownloadJob[] }>(res);
  return data.jobs;
}

export async function fetchInstalledModels(): Promise<{
  artifacts: InstalledArtifact[];
  downloads: DownloadJob[];
}> {
  const res = await fetch('/api/models/installed');
  return parseJson(res);
}

export async function fetchRuntimes(): Promise<RuntimeDetection> {
  const res = await fetch('/api/models/runtimes');
  return parseJson(res);
}

export async function fetchCachedModels(): Promise<CachedModelRow[]> {
  const res = await fetch('/api/models/cached');
  const data = await parseJson<{ models: CachedModelRow[] }>(res);
  return data.models;
}

export async function fetchModelsConfig(): Promise<ModelsConfigView> {
  const res = await fetch('/api/models/config');
  return parseJson(res);
}

export async function saveModelsConfig(patch: {
  hfToken?: string;
  clearHfToken?: boolean;
  modelDirs?: string[];
}): Promise<ModelsConfigView> {
  const res = await fetch('/api/models/config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return parseJson(res);
}

export async function fetchServeProfiles(query: {
  model: string;
  quant?: string;
  params_b?: number;
  weights_gb?: number;
  is_moe?: boolean;
}): Promise<{ profiles: ServeProfile[] }> {
  const qp = new URLSearchParams();
  qp.set('model', query.model);
  if (query.quant) qp.set('quant', query.quant);
  if (query.params_b != null) qp.set('params_b', String(query.params_b));
  if (query.weights_gb != null) qp.set('weights_gb', String(query.weights_gb));
  if (query.is_moe) qp.set('is_moe', '1');
  const res = await fetch(`/api/models/profiles?${qp}`);
  return parseJson(res);
}

export async function startModelServe(payload: {
  modelPath: string;
  runtime?: 'llama-cpp' | 'ollama' | 'lm-studio';
  modelLabel?: string;
  profile?: string;
  hardware?: Record<string, unknown>;
  quant?: string;
  paramsB?: number;
  isMoe?: boolean;
  weightsGb?: number;
}): Promise<ServeRecord> {
  const res = await fetch('/api/models/serve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await parseJson<{ serve: ServeRecord }>(res);
  return data.serve;
}

export async function stopModelServe(serveId: string): Promise<ServeRecord> {
  const res = await fetch(`/api/models/serve/${serveId}/stop`, { method: 'POST' });
  const data = await parseJson<{ serve: ServeRecord }>(res);
  return data.serve;
}

export async function listModelServes(): Promise<ServeRecord[]> {
  const res = await fetch('/api/models/serve');
  const data = await parseJson<{ serves: ServeRecord[] }>(res);
  return data.serves;
}

/** Resolve the GGUF download repo for a catalog row. */
export function resolveDownloadRepo(model: {
  name: string;
  gguf_sources?: Array<{ repo: string }>;
}): string | null {
  const gguf = model.gguf_sources?.[0]?.repo;
  if (gguf) return gguf;
  if (model.name.includes('/')) return model.name;
  return null;
}
