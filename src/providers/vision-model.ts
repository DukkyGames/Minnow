/**
 * Shared vision-model detection (catalog type + optional capabilities matrix).
 */

import { getModelRowForSelectOrCanonicalId } from '../api/models';
import { catalogRowHasVision } from './model-capabilities';
import type { LmModelRecord } from '../types';

/**
 * Positive-only id heuristic for catalogs that carry no vision signal at all
 * (llama.cpp, mlx-lm, MTPLX and friends list bare `{ id }` rows). Never used to
 * turn vision *off* — a false positive would send image parts to a text-only
 * runtime, which answers with an HTTP error instead of a reply.
 */
const VISION_ID_FALLBACK =
  /vlm|vision|llava|bakllava|moondream|multimodal|internvl|pixtral|idefics|\bvl\b|minicpm-?v\b/i;

/**
 * `type: 'llm'` is only evidence on LM Studio, whose catalog distinguishes `vlm`.
 * Every other normalizer stamps `llm` on rows that never carried a type at all.
 */
function catalogRowTypeIsAuthoritative(row: LmModelRecord): boolean {
  return row.api === 'lm-studio-v0';
}

function visionFromRow(row: LmModelRecord): boolean | null {
  if (catalogRowHasVision(row)) return true;
  const vision = row.capabilities?.vision;
  if (vision === true) return true;
  if (vision === false && row.capabilities?.sources?.vision === 'probe') return false;
  if (row.catalogVision === false) return false;
  if (vision === false && catalogRowTypeIsAuthoritative(row)) return false;
  if (row.type === 'llm' && catalogRowTypeIsAuthoritative(row)) return false;
  return null;
}

/**
 * True when the model accepts image_url multimodal user content.
 * Resolution: modelCache (or the passed catalog) → id heuristic when neither the
 * catalog nor a probe has said anything about this model.
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
    return VISION_ID_FALLBACK.test(cached.id) || VISION_ID_FALLBACK.test(modelId);
  }

  return VISION_ID_FALLBACK.test(modelId);
}
