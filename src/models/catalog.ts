import catalogData from './catalog.json';
import { inferQuantizationFromName } from './quant';
import type { CatalogModel } from './types';

let modelsCache: CatalogModel[] | null = null;

/** Mirrors Odysseus _normalize_model_entry. */
export function normalizeModelEntry(model: CatalogModel): CatalogModel {
  const inferred = inferQuantizationFromName(model.name);
  const quant = model.quantization;
  if (
    inferred &&
    (quant == null || quant === '' || quant === 'Q4_K_M' || model._discovered)
  ) {
    return { ...model, quantization: inferred };
  }
  return model;
}

/** Load bundled catalog with module-level cache. */
export function getModels(): CatalogModel[] {
  if (modelsCache === null) {
    try {
      modelsCache = (catalogData as CatalogModel[]).map(normalizeModelEntry);
    } catch {
      modelsCache = [];
    }
  }
  return modelsCache;
}

/** Test helper — reset in-module cache. */
export function clearModelsCacheForTests(): void {
  modelsCache = null;
}
