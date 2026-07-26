/**
 * Local model rows for the system tray — LM Studio loaded instances and Minnow serves.
 */

import { modelCache } from '../app-state';
import { isModelLoaded } from '../api/model-loaded-state';
import { unloadModel } from '../api/models';
import { decodeModelSelectKey } from '../lib/model-select-key';
import { listModelServes, stopModelServe } from '../models/api-client';
import { listProviders } from '../providers/store';
import { providerSupportsModelLoadUnload } from '../providers/capabilities';
import { formatModelLabel } from '../lib/format-model-label';
import type { MinnowTrayLoadedModelRow } from '../electron.d.ts';
import { buildTrayStatusSnapshot } from './tray-status-snapshot';

export type LocalModelTrayRow = MinnowTrayLoadedModelRow;
export { buildTrayStatusSnapshot };

/** Collect loaded LM Studio instances and active Minnow-managed llama.cpp serves. */
export async function collectLocalModelTrayRows(): Promise<LocalModelTrayRow[]> {
  const rows: LocalModelTrayRow[] = [];
  const seen = new Set<string>();

  const { providers } = await listProviders();
  const unloadableProviders = new Set(
    providers.filter((p) => p.enabled !== false && providerSupportsModelLoadUnload(p)).map((p) => p.id),
  );

  for (const [key, record] of modelCache.entries()) {
    if (!isModelLoaded(record.state)) continue;
    const decoded = decodeModelSelectKey(key);
    const providerId = decoded?.providerId;
    const modelId = decoded?.modelId ?? record.id;
    if (!providerId || !unloadableProviders.has(providerId)) continue;
    const dedupeKey = `lm:${providerId}:${modelId}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    rows.push({
      id: dedupeKey,
      label: formatModelLabel({ id: modelId }).primary,
      source: 'lm-studio',
    });
  }

  try {
    const serves = await listModelServes();
    for (const serve of serves) {
      if (serve.status !== 'starting' && serve.status !== 'running') continue;
      const dedupeKey = `serve:${serve.id}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const label = serve.modelLabel?.trim() || serve.modelPath || serve.id;
      rows.push({
        id: dedupeKey,
        label,
        source: 'minnow-serve',
      });
    }
  } catch {
    /* models API may be offline during boot */
  }

  return rows;
}

export interface UnloadAllLocalModelsResult {
  unloaded: number;
  errors: string[];
}

/**
 * Unload every controllable local model. Deduplicates requests and aggregates failures
 * without treating cloud catalog rows as local models.
 */
export async function unloadAllLocalModels(): Promise<UnloadAllLocalModelsResult> {
  const rows = await collectLocalModelTrayRows();
  const errors: string[] = [];
  let unloaded = 0;

  const lmTargets = new Map<string, { providerId: string; modelId: string }>();
  const serveIds: string[] = [];

  for (const row of rows) {
    if (row.source === 'minnow-serve') {
      const serveId = row.id.replace(/^serve:/, '');
      if (serveId) serveIds.push(serveId);
      continue;
    }
    const parts = row.id.replace(/^lm:/, '').split(':');
    const providerId = parts[0];
    const modelId = parts.slice(1).join(':');
    if (providerId && modelId) {
      lmTargets.set(`${providerId}:${modelId}`, { providerId, modelId });
    }
  }

  for (const { providerId, modelId } of lmTargets.values()) {
    try {
      await unloadModel(modelId, providerId);
      unloaded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${modelId}: ${message}`);
    }
  }

  for (const serveId of [...new Set(serveIds)]) {
    try {
      await stopModelServe(serveId);
      unloaded += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`Serve ${serveId}: ${message}`);
    }
  }

  return { unloaded, errors };
}
