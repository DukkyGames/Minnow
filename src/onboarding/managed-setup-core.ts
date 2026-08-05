/**
 * Pure managed-model helpers (no browser API imports) — unit-testable.
 */

import { getModels } from '../models/catalog';
import { resolveDownloadRepo, type CachedModelRow } from '../models/api-client';
import {
  defaultGpuGroupIndex,
  hardwareForGpuBudget,
  rankModels,
} from '../models/fit';
import type { HardwareSnapshot, ModelFitResult } from '../models/types';

/** Rank catalog rows for this machine (hardware-aware budget). */
export async function listModelsForHardware(
  hw: HardwareSnapshot,
  options: { limit?: number; fitOnly?: boolean; search?: string } = {},
): Promise<ModelFitResult[]> {
  const gpuIndex = defaultGpuGroupIndex(hw);
  const budgetHw = hardwareForGpuBudget(hw, gpuIndex);
  return rankModels(budgetHw, {
    limit: options.limit ?? 40,
    fitOnly: options.fitOnly ?? false,
    search: options.search || null,
    useCase: 'general',
  });
}

/** Pick the best-fitting catalog row for this machine. */
export async function pickRecommendedModel(
  hw: HardwareSnapshot,
): Promise<ModelFitResult | null> {
  const rows = await listModelsForHardware(hw, { limit: 8, fitOnly: true });
  return rows.find((row) => row.fit_level !== 'too_tight') ?? rows[0] ?? null;
}

/** Resolve on-disk GGUF path for a ranked catalog row. */
export async function artifactPathForFitRow(
  row: ModelFitResult,
  cached: CachedModelRow[],
): Promise<string | null> {
  const entry = (await getModels()).find((m) => m.name === row.name) ?? null;
  const repoId = entry ? resolveDownloadRepo(entry) : row.name.includes('/') ? row.name : null;
  if (!repoId) return null;
  const match = cached.find((c) => c.repo_id === repoId);
  if (!match?.gguf_files?.length) {
    const art = cached.find((c) => c.repo_id === repoId && c.is_gguf);
    if (art?.gguf_files?.[0]) {
      return `${art.path}/${art.gguf_files[0].rel_path}`;
    }
    return null;
  }
  const quantHint = row.quant.toUpperCase();
  const file =
    match.gguf_files.find((g) => g.quant === quantHint) ||
    match.gguf_files.find((g) => g.role === 'model') ||
    match.gguf_files[0];
  if (!file) return null;
  if (match.path.includes('huggingface') || match.path.includes('models--')) {
    return null;
  }
  return `${match.path}/${file.rel_path}`;
}
