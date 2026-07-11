/**
 * Managed models onboarding — hardware fit, download, and llama.cpp serve pipeline.
 */

import { selectProviderModel } from '../api/models';
import { getModels } from '../models/catalog';
import {
  fetchCachedModels,
  fetchLlamaRuntime,
  fetchServeProfiles,
  installLlamaRuntime,
  resolveDownloadRepo,
  startModelDownload,
  startModelServe,
  subscribeDownloadProgress,
  subscribeLlamaInstallProgress,
  type ServeRecord,
} from '../models/api-client';
import { fetchHardware } from '../models/hardware-client';
import type { HardwareSnapshot, ModelFitResult } from '../models/types';
import { artifactPathForFitRow, pickRecommendedModel } from './managed-setup-core';

export { pickRecommendedModel, artifactPathForFitRow } from './managed-setup-core';

export type ManagedSetupPhase =
  | 'idle'
  | 'probing'
  | 'installing-runtime'
  | 'downloading'
  | 'serving'
  | 'done'
  | 'error';

export interface ManagedSetupProgress {
  phase: ManagedSetupPhase;
  percent: number;
  message: string;
  error?: string;
}

export interface ManagedSetupResult {
  ok: boolean;
  providerId?: string;
  modelId?: string;
  modelLabel?: string;
  serve?: ServeRecord;
  error?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Wait for a model download job to finish. */
async function waitForDownload(
  jobId: string,
  onProgress: (progress: ManagedSetupProgress) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const unsub = subscribeDownloadProgress(jobId, (event) => {
      const total = event.totalBytes ?? 0;
      const pct =
        total > 0 ? Math.min(99, Math.round((event.bytesReceived / total) * 100)) : 40;
      onProgress({
        phase: 'downloading',
        percent: pct,
        message:
          event.status === 'running'
            ? `Downloading model… ${pct}%`
            : `Download ${event.status}`,
      });
      if (event.status === 'completed') {
        unsub();
        resolve();
      }
      if (event.status === 'failed' || event.status === 'cancelled') {
        unsub();
        reject(new Error(event.error || `Download ${event.status}`));
      }
    });
  });
}

/** Install llama.cpp runtime when missing. */
async function ensureRuntime(
  onProgress: (progress: ManagedSetupProgress) => void,
): Promise<void> {
  const runtime = await fetchLlamaRuntime();
  if (runtime.path) return;

  if (!runtime.installable) {
    throw new Error(
      'llama-server is not installed and cannot be auto-downloaded on this platform.',
    );
  }

  onProgress({
    phase: 'installing-runtime',
    percent: 5,
    message: `Installing llama.cpp (${runtime.preferredVariant})…`,
  });

  const unsub = subscribeLlamaInstallProgress((job) => {
    onProgress({
      phase: 'installing-runtime',
      percent: Math.min(30, job.percent || 10),
      message: job.message || 'Installing llama.cpp runtime…',
    });
  });

  try {
    const result = await installLlamaRuntime({ variant: runtime.preferredVariant });
    if (!result.path) {
      throw new Error('llama.cpp install did not return a binary path.');
    }
  } finally {
    unsub();
  }
}

/** Download catalog GGUF when not already on disk. */
async function ensureModelDownloaded(
  row: ModelFitResult,
  onProgress: (progress: ManagedSetupProgress) => void,
): Promise<void> {
  const cached = await fetchCachedModels();
  if (artifactPathForFitRow(row, cached)) return;

  const entry = getModels().find((m) => m.name === row.name);
  const repoId = entry ? resolveDownloadRepo(entry) : null;
  if (!repoId) {
    throw new Error(`No download source found for ${row.name}.`);
  }

  onProgress({ phase: 'downloading', percent: 32, message: `Downloading ${row.name}…` });
  const job = await startModelDownload({ repoId, quant: row.quant });
  await waitForDownload(job.id, onProgress);
}

/** Start llama.cpp serve with the balanced hardware profile. */
async function startRecommendedServe(
  row: ModelFitResult,
  hw: HardwareSnapshot,
  onProgress: (progress: ManagedSetupProgress) => void,
): Promise<ServeRecord> {
  onProgress({ phase: 'serving', percent: 85, message: 'Starting model server…' });

  const cached = await fetchCachedModels();
  const modelPath = artifactPathForFitRow(row, cached);
  if (!modelPath) {
    throw new Error('GGUF file not found after download.');
  }

  const modelLabel = row.name.split('/').pop() || row.name;
  const profiles = await fetchServeProfiles({
    model: modelLabel,
    quant: row.quant,
    params_b: row.params_b,
    weights_gb: row.size_gb,
    is_moe: row.is_moe,
  });
  const profile =
    profiles.profiles.find((p) => p.key === 'balanced') ?? profiles.profiles[0];

  const llama = profile
    ? {
        ctx: profile.ctx,
        n_gpu_layers: profile.n_gpu_layers,
        cache_type: profile.cache_type,
        fit: true,
      }
    : { fit: true };

  return startModelServe({
    modelPath,
    runtime: 'llama-cpp',
    modelLabel,
    profile: profile?.key ?? 'balanced',
    hardware: hw as unknown as Record<string, unknown>,
    quant: row.quant,
    paramsB: row.params_b,
    isMoe: row.is_moe,
    weightsGb: row.size_gb,
    llama,
  });
}

/**
 * Full managed path: probe hardware, install runtime, download model, serve, select provider.
 */
export async function runManagedModelSetup(
  onProgress: (progress: ManagedSetupProgress) => void,
): Promise<ManagedSetupResult> {
  try {
    onProgress({ phase: 'probing', percent: 2, message: 'Scanning hardware…' });
    const hw = await fetchHardware({ fresh: true });
    const row = pickRecommendedModel(hw);
    if (!row) {
      throw new Error('No catalog model fits this hardware. Try a local or cloud provider instead.');
    }

    onProgress({
      phase: 'probing',
      percent: 8,
      message: `Recommended: ${row.name} (${row.quant}, ${row.fit_level})`,
    });

    await ensureRuntime(onProgress);
    await ensureModelDownloaded(row, onProgress);
    const serve = await startRecommendedServe(row, hw, onProgress);

    await selectProviderModel(serve.providerId, serve.modelLabel).catch(() => false);
    await sleep(400);

    onProgress({ phase: 'done', percent: 100, message: 'Model server is running.' });
    return {
      ok: true,
      providerId: serve.providerId,
      modelId: serve.modelLabel,
      modelLabel: serve.modelLabel,
      serve,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Managed setup failed';
    onProgress({ phase: 'error', percent: 0, message, error: message });
    return { ok: false, error: message };
  }
}
