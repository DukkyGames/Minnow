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

/** Pick the best-fitting catalog row for this machine. */
export function pickRecommendedModel(hw: HardwareSnapshot): ModelFitResult | null {
  const gpuIndex = defaultGpuGroupIndex(hw);
  const budgetHw = hardwareForGpuBudget(hw, gpuIndex);
  const rows = rankModels(budgetHw, { limit: 8, fitOnly: true, useCase: 'general' });
  return rows.find((row) => row.fit_level !== 'too_tight') ?? rows[0] ?? null;
}

/** Resolve on-disk GGUF path for a ranked catalog row. */
export function artifactPathForFitRow(
  row: ModelFitResult,
  cached: CachedModelRow[],
): string | null {
  const entry = getModels().find((m) => m.name === row.name) ?? null;
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
