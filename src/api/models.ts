import { modelCache, modelsFetchAbort, setModelsFetchAbort } from '../app-state';
import { isServerStorageMode } from '../config/storage-mode';
import { buildTopBarModelOptionHtml, escapeHtml } from '../lib/format-model-label';
import {
  decodeModelSelectKey,
  encodeModelSelectKey,
  findFirstSelectKeyForCanonicalModelId,
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
import { updateModelStateDot } from '../ui/model-state-dot';
import {
  catalogCapabilitiesFromRow,
  fetchProviderCapabilities,
  mergeCapabilitiesIntoModelCache,
} from '../providers/model-capabilities';
import { syncModelSelectPicker } from '../ui/model-select-picker';
import { renderSidebar } from '../ui/sidebar';
import { setReadyStatus, setStatus } from '../ui/status';
import { updateStrip } from '../ui/stats';

export { modelCache };
export { isModelLoaded } from './model-loaded-state';

let modelLoadUnloadInFlight = false;

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
  return { ...fromCache, ...(fromResponse || {}) };
}

/** Refresh the stats strip from the model select + cache (no new inference). */
export function showCachedModelInfo(): void {
  const modelIdOrKey = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  if (!modelIdOrKey) return;
  updateStrip({}, {}, resolveModelInfo(modelIdOrKey));
}

/** Update the combined Load/Unload button from selection + provider. */
export function updateModelLoadUnloadButtons(): void {
  const btn = document.getElementById('btnModelLoadUnload') as HTMLButtonElement | null;
  if (!btn) return;

  const serverMode = isServerStorageMode();
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const opt = sel.options[sel.selectedIndex];
  const supportsUnload =
    serverMode && opt?.getAttribute('data-supports-load-unload') === '1';

  btn.hidden = !supportsUnload;
  if (!supportsUnload) {
    btn.disabled = true;
    btn.textContent = 'Load';
    btn.setAttribute('aria-label', 'Load model');
    btn.title = serverMode
      ? 'Model load/unload is not supported for this provider'
      : 'Start with npm start to load or unload models';
    return;
  }

  const raw = sel.value.trim();
  const row = raw ? getModelRowForSelectOrCanonicalId(raw) : undefined;
  const loaded = row ? isModelLoaded(row.state) : false;
  const busy = modelLoadUnloadInFlight;

  btn.textContent = loaded ? 'Unload' : 'Load';
  btn.setAttribute('aria-label', loaded ? 'Unload model' : 'Load model');
  btn.disabled = busy || !raw;

  if (busy) {
    btn.title = 'Model action in progress…';
  } else if (!raw) {
    btn.title = 'Select a model to load or unload';
  } else if (loaded) {
    btn.title = 'Unload selected model from VRAM';
  } else {
    btn.title = 'Load selected model into VRAM';
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
  if (modelLoadUnloadInFlight) return;
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const raw = sel.value.trim();
  if (!raw) return;
  const decoded = decodeModelSelectKey(raw);
  const modelId = decoded?.modelId ?? raw;
  const chat = getActiveChat();
  const providerId = decoded?.providerId ?? chat.providerId;
  if (!providerId) return;

  modelLoadUnloadInFlight = true;
  updateModelLoadUnloadButtons();
  setStatus('spin', 'Loading model…');
  try {
    await loadModel(modelId, providerId);
    setStatus('ok', 'Model loaded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  } finally {
    modelLoadUnloadInFlight = false;
    updateModelLoadUnloadButtons();
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
  if (modelLoadUnloadInFlight) return;
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const raw = sel.value.trim();
  if (!raw) return;
  const decoded = decodeModelSelectKey(raw);
  const modelId = decoded?.modelId ?? raw;
  const chat = getActiveChat();
  const providerId = decoded?.providerId ?? chat.providerId;
  if (!providerId) return;

  modelLoadUnloadInFlight = true;
  updateModelLoadUnloadButtons();
  setStatus('spin', 'Unloading model…');
  try {
    await unloadModel(modelId, providerId);
    setStatus('ok', 'Model unloaded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  } finally {
    modelLoadUnloadInFlight = false;
    updateModelLoadUnloadButtons();
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
          supportsModelLoadUnload: providerSupportsModelLoadUnload(provider),
          model: { id: m.id, quantization: m.quantization, state: m.state },
        }),
      )
      .join('');
    chunks.push(`<optgroup label="${escapeHtml(provider.label)}">${opts}</optgroup>`);
  }
  return chunks.join('');
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
  const chat = getActiveChat();

  if (modelsFetchAbort) modelsFetchAbort.abort();
  const controller = new AbortController();
  setModelsFetchAbort(controller);
  const { signal } = controller;

  sel.innerHTML = '<option value="">Loading models…</option>';
  syncModelSelectPicker();
  setStatus('spin', 'Loading models…');
  updateModelLoadUnloadButtons();

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

    const results = await fetchModelsForAllProviders(enabled, signal);
    const failures = results.filter((r) => r.error);
    const withModels = results.filter((r) => r.models.length > 0);
    const totalModels = withModels.reduce((n, r) => n + r.models.length, 0);

    if (totalModels === 0) {
      sel.innerHTML = '<option value="">No models found</option>';
      syncModelSelectPicker();
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

    sel.innerHTML = buildMultiProviderModelSelectInnerHtml(results);
    syncModelSelectPicker();

    modelCache.clear();
    for (const { provider, models } of results) {
      for (const m of models) {
        const key = encodeModelSelectKey(provider.id, m.id);
        modelCache.set(key, { ...m, capabilities: catalogCapabilitiesFromRow(m) });
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

    const ac = getActiveChat();
    const chosen = pickInitialSelectValue(results, ac);
    sel.value = chosen;
    const picked = decodeModelSelectKey(chosen);
    if (picked) {
      ac.providerId = picked.providerId;
      ac.modelId = picked.modelId;
      touchChat(ac);
    } else if (chosen) {
      ac.modelId = chosen;
      touchChat(ac);
    }

    const okCount = withModels.length;
    if (failures.length > 0) {
      const failedLabels = failures.map((f) => f.provider.label).join(', ');
      setStatus('ok', `${totalModels} models · ${okCount} providers (${failedLabels} unreachable)`);
    } else {
      setStatus('ok', `${totalModels} models · ${okCount} provider${okCount === 1 ? '' : 's'}`);
    }

    setReadyStatus();
    updateModelStateDot(sel.value);
    showCachedModelInfo();
    syncModelSelectPicker();
    renderSidebar();
    scheduleSaveSessions();
    void import('../ui/context-usage-ring').then((m) => m.refreshContextUsageRing());
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
