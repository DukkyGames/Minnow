import { modelCache, modelsFetchAbort, setModelsFetchAbort } from '../app-state';
import { isServerStorageMode } from '../config/storage-mode';
import { buildTopBarModelOptionHtml, escapeHtml } from '../lib/format-model-label';
import {
  applyModelSelectValueToChat,
  decodeModelSelectKey,
  encodeModelSelectKey,
  findFirstSelectKeyForCanonicalModelId,
  resolveModelSelectValueForChat,
} from '../lib/model-select-key';
import { contextLengthFromModelRow } from '../lib/context-length';
import {
  fetchModelsForAllProviders,
  type ProviderModelsResult,
} from '../providers/fetch-all-models';
import { providerSupportsModelLoadUnload } from '../providers/capabilities';
import { resolveProviderEndpoints } from '../providers/resolve';
import { listProviders } from '../providers/store';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { isModelLoaded } from './model-loaded-state';
import type { ModelInfo } from '../types';

export { contextLengthFromModelRow } from '../lib/context-length';
import {
  beginModelLoadUnload,
  endModelLoadUnload,
  getModelLoadUnloadPhase,
  isModelLoadUnloadBusy,
  setModelLoadUnloadButtonBusy,
  setModelLoadUnloadButtonIdle,
  setModelLoadUnloadButtonUnsupported,
  setModelLoadUnloadIconButtonBusy,
  setModelLoadUnloadIconButtonIdle,
  setModelLoadUnloadIconButtonUnsupported,
} from '../ui/model-load-unload-button';
import { updateModelStateDot } from '../ui/model-state-dot';
import {
  catalogCapabilitiesFromRow,
  fetchProviderCapabilities,
  mergeCapabilitiesIntoModelCache,
} from '../providers/model-capabilities';
import { syncComposerReasoningEffortFromActiveChat } from '../ui/composer-reasoning-effort';
import { syncModelSelectPicker } from '../ui/model-select-picker';
import { renderSidebar } from '../ui/sidebar';
import { setReadyStatus, setStatus } from '../ui/status';
import { updateStrip } from '../ui/stats';

export { modelCache };
export { isModelLoaded } from './model-loaded-state';

import type { LmModelRecord } from '../types';

/** Resolve a cached row for the top-bar value (composite key) or canonical id + chat provider. */
export function getModelRowForSelectOrCanonicalId(modelIdOrKey: string): LmModelRecord | undefined {
  const trimmed = modelIdOrKey.trim();
  if (!trimmed) return undefined;
  const direct = modelCache.get(trimmed);
  if (direct) return direct;
  const decoded = decodeModelSelectKey(trimmed);
  if (decoded) {
    return modelCache.get(encodeModelSelectKey(decoded.providerId, decoded.modelId));
  }
  const chat = getActiveChat();
  const pid = chat.providerId?.trim();
  if (pid) {
    const byChat = modelCache.get(encodeModelSelectKey(pid, trimmed));
    if (byChat) return byChat;
  }
  const k = findFirstSelectKeyForCanonicalModelId(modelCache.keys(), trimmed);
  return k ? modelCache.get(k) : undefined;
}

/** Merge cached model row with optional fields from a chat completion response. */
export function resolveModelInfo(modelIdOrKey: string, fromResponse?: ModelInfo | null): ModelInfo {
  const cached = getModelRowForSelectOrCanonicalId(modelIdOrKey);
  const fromCache: ModelInfo = cached
    ? {
        arch: cached.arch,
        quant: cached.quantization,
        context_length: contextLengthFromModelRow(cached),
      }
    : {};
  const merged = { ...fromCache, ...(fromResponse || {}) };
  // Live catalog context window wins over persisted per-chat snapshots (MIN-183).
  if (fromCache.context_length != null) {
    merged.context_length = fromCache.context_length;
  }
  return merged;
}

/** Refresh the stats strip from the model select + cache (no new inference). */
export function showCachedModelInfo(): void {
  const modelIdOrKey = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  if (!modelIdOrKey) return;
  updateStrip({}, {}, resolveModelInfo(modelIdOrKey));
}

/** Sync one Load/Unload button from selection + in-flight state. */
export function syncModelLoadUnloadButtonElement(btn: HTMLButtonElement): void {
  if (isModelLoadUnloadBusy()) {
    btn.hidden = false;
    setModelLoadUnloadButtonBusy(btn, getModelLoadUnloadPhase());
    return;
  }

  const serverMode = isServerStorageMode();
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  if (!sel) return;

  const opt = sel.options[sel.selectedIndex];
  const supportsUnload =
    serverMode && opt?.getAttribute('data-supports-load-unload') === '1';

  if (!supportsUnload) {
    setModelLoadUnloadButtonUnsupported(btn, serverMode);
    return;
  }

  btn.hidden = false;
  const raw = sel.value.trim();
  const row = raw ? getModelRowForSelectOrCanonicalId(raw) : undefined;
  const loaded = row ? isModelLoaded(row.state) : false;
  setModelLoadUnloadButtonIdle(btn, loaded, Boolean(raw));
}

/** Sync one icon-only Load/Unload control from selection + in-flight state. */
export function syncModelLoadUnloadIconButtonElement(btn: HTMLButtonElement): void {
  if (isModelLoadUnloadBusy()) {
    setModelLoadUnloadIconButtonBusy(btn, getModelLoadUnloadPhase());
    return;
  }

  const serverMode = isServerStorageMode();
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  if (!sel) return;

  const opt = sel.options[sel.selectedIndex];
  const supportsUnload =
    serverMode && opt?.getAttribute('data-supports-load-unload') === '1';

  if (!supportsUnload) {
    setModelLoadUnloadIconButtonUnsupported(btn, serverMode);
    return;
  }

  const raw = sel.value.trim();
  const row = raw ? getModelRowForSelectOrCanonicalId(raw) : undefined;
  const loaded = row ? isModelLoaded(row.state) : false;
  setModelLoadUnloadIconButtonIdle(btn, loaded, Boolean(raw));
}

/** Update the combined Load/Unload button from selection + provider. */
export function updateModelLoadUnloadButtons(): void {
  const btn = document.getElementById('btnModelLoadUnload') as HTMLButtonElement | null;
  if (btn) syncModelLoadUnloadButtonElement(btn);
  for (const iconBtn of document.querySelectorAll<HTMLButtonElement>(
    '.model-host-filter-action--load-unload',
  )) {
    syncModelLoadUnloadIconButtonElement(iconBtn);
  }
}

async function postModelAction(url: string, body: Record<string, string>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    let message = `HTTP ${res.status}`;
    try {
      const json = JSON.parse(text) as { error?: string };
      if (json.error) message = json.error;
    } catch {
      if (text.trim()) message = text.slice(0, 200);
    }
    throw new Error(message);
  }
}

/** Load a model via the given provider (v1 REST, proxied or direct). */
export async function loadModel(modelId: string, providerId: string): Promise<void> {
  const { providers } = await listProviders();
  const provider = providers.find((p) => p.id === providerId && p.enabled !== false);
  if (!provider) {
    throw new Error('Unknown provider');
  }
  if (!providerSupportsModelLoadUnload(provider)) {
    throw new Error('Provider does not support model load/unload');
  }
  if (!modelId.trim()) {
    throw new Error('No model selected');
  }

  const endpoints = resolveProviderEndpoints(provider);
  if (!endpoints.modelsLoadUrl) {
    throw new Error('Provider does not support model load/unload');
  }

  await postModelAction(endpoints.modelsLoadUrl, { model: modelId.trim() });
  await fetchModels();
}

/** Unload a model instance via the given provider. */
export async function unloadModel(modelId: string, providerId: string): Promise<void> {
  const { providers } = await listProviders();
  const provider = providers.find((p) => p.id === providerId && p.enabled !== false);
  if (!provider) {
    throw new Error('Unknown provider');
  }
  if (!providerSupportsModelLoadUnload(provider)) {
    throw new Error('Provider does not support model load/unload');
  }
  if (!modelId.trim()) {
    throw new Error('No model selected');
  }

  const endpoints = resolveProviderEndpoints(provider);
  if (!endpoints.modelsUnloadUrl) {
    throw new Error('Provider does not support model load/unload');
  }

  await postModelAction(endpoints.modelsUnloadUrl, { instance_id: modelId.trim() });
  await fetchModels();
}

/** Load the model currently selected in the topbar picker. */
export async function loadSelectedModel(): Promise<void> {
  if (isModelLoadUnloadBusy()) return;
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const raw = sel.value.trim();
  if (!raw) return;
  const decoded = decodeModelSelectKey(raw);
  const modelId = decoded?.modelId ?? raw;
  const chat = getActiveChat();
  const providerId = decoded?.providerId ?? chat.providerId;
  if (!providerId) return;

  beginModelLoadUnload('load');
  updateModelLoadUnloadButtons();
  updateModelStateDot(raw);
  syncModelSelectPicker();
  setStatus('spin', 'Loading model…');
  try {
    await loadModel(modelId, providerId);
    setStatus('ok', 'Model loaded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  } finally {
    endModelLoadUnload();
    updateModelLoadUnloadButtons();
    updateModelStateDot(raw);
    syncModelSelectPicker();
  }
}

/** Load or unload the model currently selected in the topbar picker. */
export async function toggleSelectedModelLoad(): Promise<void> {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const raw = sel.value.trim();
  if (!raw) return;
  const row = getModelRowForSelectOrCanonicalId(raw);
  const loaded = row ? isModelLoaded(row.state) : false;
  if (loaded) {
    await unloadSelectedModel();
  } else {
    await loadSelectedModel();
  }
}

/** Unload the model currently selected in the topbar picker. */
export async function unloadSelectedModel(): Promise<void> {
  if (isModelLoadUnloadBusy()) return;
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const raw = sel.value.trim();
  if (!raw) return;
  const decoded = decodeModelSelectKey(raw);
  const modelId = decoded?.modelId ?? raw;
  const chat = getActiveChat();
  const providerId = decoded?.providerId ?? chat.providerId;
  if (!providerId) return;

  beginModelLoadUnload('unload');
  updateModelLoadUnloadButtons();
  updateModelStateDot(raw);
  syncModelSelectPicker();
  setStatus('spin', 'Unloading model…');
  try {
    await unloadModel(modelId, providerId);
    setStatus('ok', 'Model unloaded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  } finally {
    endModelLoadUnload();
    updateModelLoadUnloadButtons();
    updateModelStateDot(raw);
    syncModelSelectPicker();
  }
}

/** Build optgroup HTML for all providers that returned at least one model. */
function buildMultiProviderModelSelectInnerHtml(results: ProviderModelsResult[]): string {
  const chunks: string[] = [];
  for (const { provider, models } of results) {
    if (models.length === 0) continue;
    const opts = models
      .map((m) =>
        buildTopBarModelOptionHtml({
          value: encodeModelSelectKey(provider.id, m.id),
          providerId: provider.id,
          providerLabel: provider.label,
          providerBaseUrl: provider.baseUrl,
          supportsModelLoadUnload: providerSupportsModelLoadUnload(provider),
          model: { id: m.id, quantization: m.quantization, state: m.state },
        }),
      )
      .join('');
    chunks.push(`<optgroup label="${escapeHtml(provider.label)}">${opts}</optgroup>`);
  }
  return chunks.join('');
}

/** Options for {@link populateMultiProviderModelSelect}. */
export interface PopulateMultiProviderModelSelectOptions {
  selectedProviderId?: string;
  selectedModelId?: string;
  includeEmptyOption?: boolean;
  emptyLabel?: string;
  signal?: AbortSignal;
}

/**
 * Load models from every enabled provider into a multi-provider &lt;select&gt;.
 * Populates {@link modelCache} for auxiliary combobox tooltips and load dots.
 * @returns Provider fetch results when models were loaded; `null` when the select was set to an error/empty state.
 */
export async function populateMultiProviderModelSelect(
  select: HTMLSelectElement,
  options?: PopulateMultiProviderModelSelectOptions,
): Promise<ProviderModelsResult[] | null> {
  const signal = options?.signal;
  const emptyLabel = options?.emptyLabel ?? '(use menubar default)';

  select.innerHTML = '<option value="">Loading models…</option>';
  syncModelSelectPicker();

  try {
    const { providers } = await listProviders();
    const enabled = providers.filter((p) => p.enabled !== false);

    if (enabled.length === 0) {
      select.innerHTML = '<option value="">No providers configured</option>';
      syncModelSelectPicker();
      return null;
    }

    const results = await fetchModelsForAllProviders(enabled, signal ?? new AbortController().signal);
    const withModels = results.filter((r) => r.models.length > 0);
    const totalModels = withModels.reduce((n, r) => n + r.models.length, 0);

    if (totalModels === 0) {
      select.innerHTML = '<option value="">No models found</option>';
      syncModelSelectPicker();
      return results;
    }

    let innerHtml = buildMultiProviderModelSelectInnerHtml(results);
    if (options?.includeEmptyOption) {
      innerHtml = `<option value="">${escapeHtml(emptyLabel)}</option>${innerHtml}`;
    }
    select.innerHTML = innerHtml;
    syncModelSelectPicker();

    modelCache.clear();
    for (const { provider, models } of results) {
      for (const m of models) {
        const key = encodeModelSelectKey(provider.id, m.id);
        modelCache.set(key, { ...m, capabilities: catalogCapabilitiesFromRow(m, provider.apiKind) });
      }
    }

    for (const { provider, error } of results) {
      if (error || provider.enabled === false) continue;
      try {
        const capsFile = await fetchProviderCapabilities(provider.id, signal);
        mergeCapabilitiesIntoModelCache(capsFile);
      } catch {
        /* stale or missing capabilities file is ok */
      }
    }

    const pid = options?.selectedProviderId?.trim();
    const mid = options?.selectedModelId?.trim();
    if (pid && mid) {
      const want = encodeModelSelectKey(pid, mid);
      if ([...select.options].some((opt) => opt.value === want)) {
        select.value = want;
      } else if (options?.includeEmptyOption) {
        select.value = '';
      }
    } else if (options?.includeEmptyOption) {
      select.value = '';
    }

    syncModelSelectPicker();
    return results;
  } catch (err) {
    const e = err as { name?: string };
    if (e && e.name === 'AbortError') return null;
    select.innerHTML = '<option value="">Cannot reach providers</option>';
    syncModelSelectPicker();
    return null;
  }
}

/** Pick initial <select> value: chat binding, else first loaded model, else first option. */
function pickInitialSelectValue(
  results: ProviderModelsResult[],
  chat: ReturnType<typeof getActiveChat>,
): string {
  const flat: { providerId: string; modelId: string; key: string; loaded: boolean }[] = [];
  for (const { provider, models } of results) {
    for (const m of models) {
      flat.push({
        providerId: provider.id,
        modelId: m.id,
        key: encodeModelSelectKey(provider.id, m.id),
        loaded: isModelLoaded(m.state),
      });
    }
  }
  if (flat.length === 0) return '';

  const pid = chat.providerId?.trim();
  const mid = chat.modelId?.trim();
  if (pid && mid) {
    const want = encodeModelSelectKey(pid, mid);
    if (flat.some((x) => x.key === want)) return want;
    const sameModel = flat.filter((x) => x.modelId === mid);
    if (sameModel.length === 1) return sameModel[0].key;
    if (sameModel.length > 1) return sameModel[0].key;
  }

  const loaded = flat.find((x) => x.loaded);
  if (loaded) return loaded.key;
  return flat[0].key;
}

/** Load models from every enabled provider and populate the model select. */
export async function fetchModels(): Promise<void> {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;

  if (modelsFetchAbort) modelsFetchAbort.abort();
  const controller = new AbortController();
  setModelsFetchAbort(controller);
  const { signal } = controller;

  sel.innerHTML = '<option value="">Loading models…</option>';
  syncModelSelectPicker();
  if (!isModelLoadUnloadBusy()) {
    setStatus('spin', 'Loading models…');
  }
  updateModelLoadUnloadButtons();
  if (isModelLoadUnloadBusy()) {
    updateModelStateDot();
  }

  try {
    const { providers } = await listProviders();
    const enabled = providers.filter((p) => p.enabled !== false);

    if (enabled.length === 0) {
      sel.innerHTML = '<option value="">No providers configured</option>';
      syncModelSelectPicker();
      setStatus('err', 'No providers configured. Use Settings → Providers.');
      updateModelLoadUnloadButtons();
      return;
    }

    const results = await populateMultiProviderModelSelect(sel, { signal });
    if (!results) {
      const { providers: listed } = await listProviders();
      const enabledCount = listed.filter((p) => p.enabled !== false).length;
      if (enabledCount === 0) {
        setStatus('err', 'No providers configured. Use Settings → Providers.');
      } else {
        setStatus('err', 'Cannot reach one or more providers. Check Settings → Providers.');
      }
      updateModelLoadUnloadButtons();
      return;
    }

    const failures = results.filter((r) => r.error);
    const withModels = results.filter((r) => r.models.length > 0);
    const totalModels = withModels.reduce((n, r) => n + r.models.length, 0);

    if (totalModels === 0) {
      const names = failures.map((f) => f.provider.label).join(', ');
      setStatus(
        'err',
        failures.length === results.length
          ? `Cannot reach providers (${names || 'unknown'}). Check Settings → Providers.`
          : 'No models returned from any provider.',
      );
      updateModelLoadUnloadButtons();
      return;
    }

    const ac = getActiveChat();
    const optionValues = [...sel.options].map((o) => o.value);
    const hadBinding = Boolean(ac.modelId?.trim());

    if (hadBinding) {
      const resolved = resolveModelSelectValueForChat(ac, optionValues);
      if (resolved) sel.value = resolved;
    } else {
      const chosen = pickInitialSelectValue(results, ac);
      sel.value = chosen;
      applyModelSelectValueToChat(ac, chosen);
      touchChat(ac);
    }

    const okCount = withModels.length;
    if (failures.length > 0) {
      const failedLabels = failures.map((f) => f.provider.label).join(', ');
      setStatus('ok', `${totalModels} models · ${okCount} providers (${failedLabels} unreachable)`);
    } else {
      setStatus('ok', `${totalModels} models · ${okCount} provider${okCount === 1 ? '' : 's'}`);
    }

    if (!isModelLoadUnloadBusy()) {
      setReadyStatus();
    }
    updateModelStateDot(sel.value);
    showCachedModelInfo();
    syncModelSelectPicker();
    syncComposerReasoningEffortFromActiveChat();
    renderSidebar();
    scheduleSaveSessions();
    void import('../ui/context-usage-ring').then((m) => m.refreshContextUsageRing());
    void import('../ui/benchmark/roster-picker.ts').then((m) => m.refreshBenchmarkRosterPicker());
  } catch (err) {
    const e = err as { name?: string };
    if (e && e.name === 'AbortError') return;
    sel.innerHTML = '<option value="">Cannot reach providers</option>';
    syncModelSelectPicker();
    setStatus('err', 'Cannot reach one or more providers. Check Settings → Providers.');
  } finally {
    if (modelsFetchAbort && modelsFetchAbort.signal === signal) {
      setModelsFetchAbort(null);
    }
    updateModelLoadUnloadButtons();
    updateModelStateDot(sel.value);
    syncModelSelectPicker();
  }
}

/**
 * After serve, pick the new provider's model in the top bar.
 * @returns true when a matching option was found and selected.
 */
export async function selectProviderModel(
  providerId: string,
  modelIdHint: string,
): Promise<boolean> {
  await fetchModels();
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const hint = modelIdHint.trim().toLowerCase();
  if (!hint) return false;

  for (const opt of [...sel.options]) {
    const decoded = decodeModelSelectKey(opt.value);
    if (!decoded || decoded.providerId !== providerId) continue;
    const mid = decoded.modelId.toLowerCase();
    if (mid.includes(hint) || hint.includes(mid) || mid.endsWith(hint) || hint.endsWith(mid)) {
      sel.value = opt.value;
      const chat = getActiveChat();
      applyModelSelectValueToChat(chat, opt.value);
      touchChat(chat);
      scheduleSaveSessions();
      syncModelSelectPicker();
      updateModelLoadUnloadButtons();
      showCachedModelInfo();
      renderSidebar();
      return true;
    }
  }
  return false;
}
