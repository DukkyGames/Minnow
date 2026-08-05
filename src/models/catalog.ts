import { inferQuantizationFromName } from './quant';
import type { CatalogModel } from './types';

let modelsCache: CatalogModel[] | null = null;
let modelsLoad: Promise<CatalogModel[]> | null = null;

/** Normalizes a catalog model entry. */
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

/** Load bundled catalog with module-level cache (dynamic import keeps JSON off the boot graph). */
export async function getModels(): Promise<CatalogModel[]> {
  if (modelsCache !== null) return modelsCache;
  if (!modelsLoad) {
    modelsLoad = import('./catalog.json')
      .then((mod) => {
        const raw = (mod as { default?: CatalogModel[] }).default ?? (mod as CatalogModel[]);
        try {
          modelsCache = raw.map(normalizeModelEntry);
        } catch {
          modelsCache = [];
        }
        return modelsCache;
      })
      .catch(() => {
        modelsCache = [];
        return modelsCache;
      });
  }
  return modelsLoad;
}

/** Test helper — reset in-module cache. */
export function clearModelsCacheForTests(): void {
  modelsCache = null;
  modelsLoad = null;
}
