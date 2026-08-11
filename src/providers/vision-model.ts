/**
 * Shared vision-model detection (catalog type + optional capabilities matrix).
 */

import { getModelRowForSelectOrCanonicalId } from '../api/models';
import { catalogRowHasVision } from './model-capabilities';
import type { LmModelRecord } from '../types';

/** Best-effort id heuristic when catalog and cache lack a row (benchmark fallback only). */
const VISION_ID_FALLBACK = /vlm|vision|llava|bakllava|moondream|multimodal/i;

function visionFromRow(row: LmModelRecord): boolean | null {
  if (catalogRowHasVision(row)) return true;
  const vision = row.capabilities?.vision;
  if (vision === true) return true;
  if (vision === false) return false;
  if (row.catalogVision === false) return false;
  if (row.type === 'llm') return false;
  return null;
}

/**
 * True when the model accepts image_url multimodal user content.
 * Resolution: modelCache → optional catalog list → id regex fallback (benchmark only, when catalog arg passed).
 */
export function isVisionModel(modelId: string | undefined, catalog?: LmModelRecord[]): boolean {
  if (!modelId) return false;

  if (catalog !== undefined) {
    const row = catalog.find((m) => m.id === modelId);
    if (row) {
      const fromCatalog = visionFromRow(row);
      if (fromCatalog !== null) return fromCatalog;
    }
    return VISION_ID_FALLBACK.test(modelId);
  }

  const cached = getModelRowForSelectOrCanonicalId(modelId);
  if (cached) {
    const fromCache = visionFromRow(cached);
    if (fromCache !== null) return fromCache;
  }

  return false;
}
