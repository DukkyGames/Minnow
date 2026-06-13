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

export interface RuntimeDetection {
  llamaCpp: { available: boolean; path: string | null };
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

export async function startModelServe(payload: {
  modelPath: string;
  runtime?: 'llama-cpp' | 'ollama' | 'lm-studio';
  modelLabel?: string;
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
