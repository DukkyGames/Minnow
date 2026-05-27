/**
 * Per-model capability matrix: fetch, merge with catalog, probe trigger.
 */

import { isModelLoaded } from '../api/model-loaded-state';
import { modelCache } from '../app-state';
import { isServerStorageMode } from '../config/storage-mode';
import { contextLengthFromModelRow } from '../lib/context-length';
import { decodeModelSelectKey, findFirstSelectKeyForCanonicalModelId } from '../lib/model-select-key';
import type { LmModelRecord, ModelCapabilities } from '../types';

export type { CapabilitySource, ModelCapabilities } from '../types';

export interface ProviderCapabilitiesFile {
  schemaVersion: number;
  providerId: string;
  probedAt: string;
  apiKind: string;
  models: Record<string, ModelCapabilities>;
}

const providerCapabilitiesCache = new Map<string, ProviderCapabilitiesFile>();

let lastAppliedCapabilities: ProviderCapabilitiesFile | null = null;

let probeAbort: AbortController | null = null;

/** ISO timestamp of the last capabilities file applied to modelCache. */
export function getLastCapabilitiesProbedAt(): string | undefined {
  const at = lastAppliedCapabilities?.probedAt;
  if (!at?.trim()) return undefined;
  return at;
}

/** Cached capabilities file for a provider (in-memory). */
export function getCachedProviderCapabilities(
  providerId: string,
): ProviderCapabilitiesFile | undefined {
  return providerCapabilitiesCache.get(providerId);
}

/** Apply fetched capabilities file to cache and merge into model rows. */
export function applyProviderCapabilities(file: ProviderCapabilitiesFile): void {
  providerCapabilitiesCache.set(file.providerId, file);
  for (const [modelId, caps] of Object.entries(file.models)) {
    for (const [cacheKey, row] of modelCache.entries()) {
      const decoded = decodeModelSelectKey(cacheKey);
      const logicalId = decoded?.modelId ?? cacheKey;
      const rowProvider = decoded?.providerId;
      if (rowProvider !== undefined && rowProvider !== file.providerId) continue;
      if (logicalId !== modelId) continue;
      row.capabilities = mergeModelCapabilities(row, caps);
    }
  }
}

/** Build catalog-derived capabilities from a models-list row. */
export function catalogCapabilitiesFromRow(row: LmModelRecord): ModelCapabilities {
  const contextLength = contextLengthFromModelRow(row) ?? null;
  const isVlm = row.type === 'vlm';
  return {
    vision: isVlm ? true : false,
    tools: null,
    streaming: null,
    grammar: null,
    reasoning: null,
    contextLength,
    loadState: row.state?.trim() || null,
    sources: {
      vision: 'catalog',
      contextLength: contextLength !== null ? 'catalog' : undefined,
      loadState: 'catalog',
    },
    probeErrors: {},
  };
}

/**
 * Merge catalog row with persisted probe file entry.
 * Catalog wins when probe source is not set for a field that catalog provides.
 */
export function mergeModelCapabilities(
  row: LmModelRecord,
  fromFile?: ModelCapabilities | null,
): ModelCapabilities {
  const catalog = catalogCapabilitiesFromRow(row);
  if (!fromFile) return catalog;

  const merged: ModelCapabilities = { ...catalog };

  const preferProbe = (field: keyof ModelCapabilities, catalogValue: boolean | number | null) => {
    const fileValue = fromFile[field];
    if (fileValue === null || fileValue === undefined) return;
    const source = fromFile.sources?.[field as keyof ModelCapabilities];
    if (source === 'catalog' && catalogValue !== null && catalogValue !== undefined) {
      merged[field] = catalogValue as never;
      return;
    }
    merged[field] = fileValue as never;
    if (source) {
      merged.sources = { ...merged.sources, [field]: source };
    }
  };

  preferProbe('vision', catalog.vision);
  preferProbe('tools', catalog.tools);
  preferProbe('streaming', catalog.streaming);
  preferProbe('grammar', catalog.grammar);
  preferProbe('reasoning', catalog.reasoning);
  preferProbe('contextLength', catalog.contextLength);
  if (fromFile.loadState) {
    merged.loadState = fromFile.loadState;
    if (fromFile.sources?.loadState) {
      merged.sources = { ...merged.sources, loadState: fromFile.sources.loadState };
    }
  }
  if (fromFile.probeErrors && Object.keys(fromFile.probeErrors).length > 0) {
    merged.probeErrors = { ...catalog.probeErrors, ...fromFile.probeErrors };
  }

  return merged;
}

/** Attach merged capabilities to every row in modelCache for a provider file. */
export function mergeCapabilitiesIntoModelCache(file: ProviderCapabilitiesFile): void {
  lastAppliedCapabilities = file;
  applyProviderCapabilities(file);
  for (const [cacheKey, row] of modelCache.entries()) {
    const decoded = decodeModelSelectKey(cacheKey);
    const logicalId = decoded?.modelId ?? cacheKey;
    if (decoded && decoded.providerId !== file.providerId) continue;
    const fromFile = file.models[logicalId];
    row.capabilities = mergeModelCapabilities(row, fromFile);
  }
}

/** GET persisted capabilities for a provider. */
export async function fetchProviderCapabilities(
  providerId: string,
  signal?: AbortSignal,
): Promise<ProviderCapabilitiesFile> {
  const encoded = encodeURIComponent(providerId);
  const res = await fetch(`/api/providers/${encoded}/capabilities`, {
    signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Capabilities HTTP ${res.status}`);
  }
  const json = (await res.json()) as ProviderCapabilitiesFile;
  return json;
}

/** POST capability probe; returns updated file. */
export async function runCapabilityProbe(
  providerId: string,
  options: {
    modelIds?: string[];
    selectedModelId?: string;
    signal?: AbortSignal;
  } = {},
): Promise<ProviderCapabilitiesFile> {
  const encoded = encodeURIComponent(providerId);
  const res = await fetch(`/api/providers/${encoded}/capabilities/probe`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      modelIds: options.modelIds,
      selectedModelId: options.selectedModelId,
    }),
    signal: options.signal,
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `Probe HTTP ${res.status}`;
    try {
      const errJson = JSON.parse(text) as { error?: string };
      if (errJson.error) message = errJson.error;
    } catch {
      if (text.trim()) message = text.slice(0, 200);
    }
    throw new Error(message);
  }
  return (await res.json()) as ProviderCapabilitiesFile;
}

/**
 * First loaded model id for a provider (selected chat model preferred when loaded).
 */
export function findLoadedModelIdForProvider(
  providerId: string,
  selectedModelId?: string,
): string | null {
  const pid = providerId.trim();
  if (!pid) return null;

  const loaded: string[] = [];
  for (const [key, row] of modelCache.entries()) {
    const decoded = decodeModelSelectKey(key);
    if (!decoded || decoded.providerId !== pid) continue;
    if (!isModelLoaded(row.state)) continue;
    loaded.push(decoded.modelId);
  }

  if (loaded.length === 0) return null;
  const [first] = prioritizeModelIdsForProbe(loaded, selectedModelId);
  return first ?? null;
}

/**
 * Prioritize model ids for probe (selected → loaded → alphabetical), cap at 8.
 */
export function prioritizeModelIdsForProbe(
  modelIds: string[],
  selectedModelId?: string,
): string[] {
  const selectedCanonical = selectedModelId
    ? decodeModelSelectKey(selectedModelId)?.modelId ?? selectedModelId
    : undefined;
  const loaded = new Set(
    [...modelCache.entries()]
      .filter(([, row]) => row.state === 'loaded')
      .map(([id]) => decodeModelSelectKey(id)?.modelId ?? id),
  );
  const score = (id: string) => {
    if (selectedCanonical && id === selectedCanonical) return 0;
    if (loaded.has(id)) return 1;
    return 2;
  };
  return [...new Set(modelIds)]
    .sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      return a.localeCompare(b);
    })
    .slice(0, 8);
}

/** Run capability matrix probe (Settings → Providers button; optional model id filter). */
export async function runCapabilityProbeForProvider(
  providerId: string,
  options: { modelIds?: string[]; selectedModelId?: string } = {},
): Promise<void> {
  if (!isServerStorageMode()) return;

  if (probeAbort) probeAbort.abort();
  const controller = new AbortController();
  probeAbort = controller;

  try {
    const prioritized =
      options.modelIds !== undefined
        ? prioritizeModelIdsForProbe(options.modelIds, options.selectedModelId)
        : undefined;
    const file = await runCapabilityProbe(providerId, {
      modelIds: prioritized,
      selectedModelId: options.selectedModelId,
      signal: controller.signal,
    });
    if (probeAbort === controller) {
      mergeCapabilitiesIntoModelCache(file);
    }
  } catch (err) {
    const e = err as { name?: string };
    if (e?.name === 'AbortError') return;
    throw err;
  } finally {
    if (probeAbort === controller) {
      probeAbort = null;
    }
  }
}

/** Whether merged capabilities indicate vision / VLM support. */
export function modelSupportsVision(modelId: string | undefined): boolean {
  if (!modelId) return false;
  let row = modelCache.get(modelId);
  if (!row) {
    const key = findFirstSelectKeyForCanonicalModelId(modelCache.keys(), modelId);
    if (key) row = modelCache.get(key);
  }
  if (!row) return false;
  const caps = row.capabilities ?? catalogCapabilitiesFromRow(row);
  if (caps.vision === true) return true;
  if (caps.vision === false) return false;
  return row.type === 'vlm';
}
