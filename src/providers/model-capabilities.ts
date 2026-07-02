/**
 * Per-model capability matrix: fetch, merge with catalog, probe trigger.
 */

import { isModelLoaded } from '../api/model-loaded-state';
import { modelCache } from '../app-state';
import { isServerStorageMode } from '../config/storage-mode';
import { contextLengthFromModelRow } from '../lib/context-length';
import {
  inferReasoningOptionsFromModelId,
  isReasoningEffortOption,
  normalizeReasoningAllowedOptions,
} from '../lib/reasoning-effort';
import { decodeModelSelectKey, encodeModelSelectKey, findFirstSelectKeyForCanonicalModelId } from '../lib/model-select-key';
import type { ApiKind } from './types';
import type { LmModelRecord, ModelCapabilities } from '../types';
import { getCachedProviderList } from './store';

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

function reasoningCatalogFromRow(
  row: LmModelRecord,
): Pick<ModelCapabilities, 'reasoning' | 'reasoningAllowedOptions' | 'reasoningDefault'> {
  const block = row.reasoning;
  if (!block || typeof block !== 'object') {
    return { reasoning: null };
  }
  const allowedRaw = Array.isArray(block.allowed_options)
    ? block.allowed_options
    : [];
  const allowed = normalizeReasoningAllowedOptions(allowedRaw);
  const def = isReasoningEffortOption(block.default) ? block.default : undefined;
  const reasoningOnDefault =
    def === 'on' || def === 'low' || def === 'medium' || def === 'high';
  const reasoning =
    allowed.length > 0 ? true : reasoningOnDefault ? true : def === 'off' ? false : null;
  return {
    reasoning,
    ...(allowed.length > 0 ? { reasoningAllowedOptions: allowed } : {}),
    ...(def ? { reasoningDefault: def } : {}),
  };
}

/** True when catalog row indicates multimodal vision (vlm type or LM Studio capabilities.vision). */
export function catalogRowHasVision(row: LmModelRecord): boolean {
  return row.type === 'vlm' || row.catalogVision === true;
}

/** Build catalog-derived capabilities from a models-list row. */
export function catalogCapabilitiesFromRow(
  row: LmModelRecord,
  apiKind?: ApiKind,
): ModelCapabilities {
  const contextLength = contextLengthFromModelRow(row) ?? null;
  const vision = catalogRowHasVision(row);
  const reasoningCaps = reasoningCatalogFromRow(row);
  let reasoningAllowedOptions = reasoningCaps.reasoningAllowedOptions;
  if ((!reasoningAllowedOptions || reasoningAllowedOptions.length === 0) && apiKind) {
    const inferred = inferReasoningOptionsFromModelId(row.id, apiKind);
    if (inferred.length > 0) {
      reasoningAllowedOptions = inferred;
    }
  }
  const isMiniMax = /minimax/i.test(row.id);
  return {
    vision,
    tools: null,
    streaming: null,
    grammar: null,
    reasoning: reasoningCaps.reasoning ?? (reasoningAllowedOptions?.length ? true : null),
    reasoningAllowedOptions,
    reasoningDefault: reasoningCaps.reasoningDefault ?? (reasoningAllowedOptions?.includes('medium') ? 'medium' : undefined),
    ...(isMiniMax ? { reasoningThinkingEnabledValue: 'adaptive' as const } : {}),
    contextLength,
    loadState: row.state?.trim() || null,
    sources: {
      vision: 'catalog',
      contextLength: contextLength !== null ? 'catalog' : undefined,
      loadState: 'catalog',
      ...(reasoningCaps.reasoning !== undefined && reasoningCaps.reasoning !== null
        ? { reasoning: 'catalog' as const }
        : {}),
    },
    probeErrors: {},
  };
}

/**
 * Resolve send-time capabilities for a provider-bound model row.
 * Re-applies openai-v1 inference when cached caps lack selectable reasoning options.
 */
export function resolveSendCapabilities(
  providerId: string,
  modelId: string,
  apiKind?: ApiKind,
): ModelCapabilities | undefined {
  const pid = providerId.trim();
  const mid = modelId.trim();
  if (!pid || !mid) return undefined;

  const row = modelCache.get(encodeModelSelectKey(pid, mid));
  if (!row) return undefined;

  const kind =
    apiKind ?? getCachedProviderList()?.providers.find((p) => p.id === pid)?.apiKind;
  const fromCatalog = catalogCapabilitiesFromRow(row, kind);
  const cached = row.capabilities;

  if (!cached) return fromCatalog;

  const cachedAllowed = cached.reasoningAllowedOptions?.length ?? 0;
  const catalogAllowed = fromCatalog.reasoningAllowedOptions?.length ?? 0;
  if (catalogAllowed >= 2 && cachedAllowed < 2) {
    return {
      ...cached,
      reasoning: fromCatalog.reasoning ?? cached.reasoning,
      reasoningAllowedOptions: fromCatalog.reasoningAllowedOptions,
      reasoningDefault: fromCatalog.reasoningDefault ?? cached.reasoningDefault,
    };
  }

  return cached;
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
  if (fromFile.reasoningAllowedOptions?.length) {
    merged.reasoningAllowedOptions = [...fromFile.reasoningAllowedOptions];
  } else if (catalog.reasoningAllowedOptions?.length) {
    merged.reasoningAllowedOptions = [...catalog.reasoningAllowedOptions];
  }
  if (fromFile.reasoningDefault) {
    merged.reasoningDefault = fromFile.reasoningDefault;
  } else if (catalog.reasoningDefault) {
    merged.reasoningDefault = catalog.reasoningDefault;
  }
  if (fromFile.reasoningThinkingEnabledValue) {
    merged.reasoningThinkingEnabledValue = fromFile.reasoningThinkingEnabledValue;
  } else if (catalog.reasoningThinkingEnabledValue) {
    merged.reasoningThinkingEnabledValue = catalog.reasoningThinkingEnabledValue;
  }
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

/** All loaded canonical model ids for a provider (from modelCache). */
export function findLoadedModelIdsForProvider(providerId: string): string[] {
  const pid = providerId.trim();
  if (!pid) return [];

  const loaded: string[] = [];
  for (const [key, row] of modelCache.entries()) {
    const decoded = decodeModelSelectKey(key);
    if (!decoded || decoded.providerId !== pid) continue;
    if (!isModelLoaded(row.state)) continue;
    loaded.push(decoded.modelId);
  }
  return [...new Set(loaded)];
}

/**
 * First loaded model id for a provider (selected chat model preferred when loaded).
 */
export function findLoadedModelIdForProvider(
  providerId: string,
  selectedModelId?: string,
): string | null {
  const loaded = findLoadedModelIdsForProvider(providerId);
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

export const NO_LOADED_MODEL_MATRIX_PROBE_MSG =
  'No loaded model found. Load a model in LM Studio, then run the probe again.';

/** Run capability matrix probe (Settings → Providers button; optional model id filter). */
export async function runCapabilityProbeForProvider(
  providerId: string,
  options: {
    modelIds?: string[];
    selectedModelId?: string;
    apiKind?: ApiKind;
  } = {},
): Promise<void> {
  if (!isServerStorageMode()) return;

  if (probeAbort) probeAbort.abort();
  const controller = new AbortController();
  probeAbort = controller;

  try {
    let modelIds = options.modelIds;
    const apiKind = options.apiKind;
    if (apiKind === 'lm-studio-v0' && modelIds === undefined) {
      const loadedIds = findLoadedModelIdsForProvider(providerId);
      if (loadedIds.length === 0) {
        throw new Error(NO_LOADED_MODEL_MATRIX_PROBE_MSG);
      }
      modelIds = loadedIds;
    }

    const prioritized =
      modelIds !== undefined
        ? prioritizeModelIdsForProbe(modelIds, options.selectedModelId)
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
  return catalogRowHasVision(row);
}
