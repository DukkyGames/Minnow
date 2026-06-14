/**
 * llama.cpp managed server provisioner — binary install via llama-runtime.js.
 */

import fsp from 'node:fs/promises';
import {
  ensureLlamaServer,
  getLlamaRuntimeStatus,
  getManagedLlamaMetaPath,
  getManagedLlamaRoot,
  resolveLlamaServer,
} from '../models/llama-runtime.js';

const SERVER_ID = 'llama-cpp';

/**
 * @param {(msg: string) => void} [onProgress]
 */
export async function provision(onProgress) {
  onProgress?.('Installing llama.cpp runtime…');
  await ensureLlamaServer({
    reinstall: true,
    onProgress: (patch) => onProgress?.(patch.message),
  });
}

export async function getInstallStatus() {
  const resolved = await resolveLlamaServer();
  let meta = null;
  try {
    meta = JSON.parse(await fsp.readFile(getManagedLlamaMetaPath(), 'utf8'));
  } catch {
    /* not installed */
  }

  return {
    installed: Boolean(resolved.path),
    version: meta?.version ?? null,
    variant: meta?.variant ?? null,
    path: resolved.path,
  };
}

/** llama.cpp is spawned per-model serve — no long-running managed process. */
export async function getSpawnSpec() {
  throw new Error('llama.cpp does not use managed server spawn — serve a model from Models');
}

export async function uninstall() {
  await fsp.rm(getManagedLlamaRoot(), { recursive: true, force: true });
}

/** Extended status for Settings UI. */
export async function getExtendedStatus() {
  return getLlamaRuntimeStatus();
}

export { SERVER_ID };
