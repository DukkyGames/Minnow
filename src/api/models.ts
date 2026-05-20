import { modelCache, modelsFetchAbort, setModelsFetchAbort } from '../app-state';
import { fetchModelsForProvider } from '../providers/fetch-models';
import { getActiveProvider } from '../providers/store';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { LmModelRecord, ModelInfo } from '../types';
import { renderSidebar } from '../ui/sidebar';
import { setStatus } from '../ui/status';
import { updateStrip } from '../ui/stats';

export { modelCache };

/** Merge cached model row with optional fields from a chat completion response. */
export function resolveModelInfo(
  modelId: string,
  fromResponse?: ModelInfo | null,
): ModelInfo {
  const cached = modelCache.get(modelId);
  const fromCache: ModelInfo = cached
    ? {
        arch: cached.arch,
        quant: cached.quantization,
        context_length: cached.max_context_length,
      }
    : {};
  return { ...fromCache, ...(fromResponse || {}) };
}

/** Refresh the stats strip from the model select + cache (no new inference). */
export function showCachedModelInfo(): void {
  const modelId = (document.getElementById('modelSelect') as HTMLSelectElement).value;
  if (!modelId) return;
  updateStrip({}, {}, resolveModelInfo(modelId));
}

/** Load models from the active provider and populate the model select. */
export async function fetchModels(): Promise<void> {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const chat = getActiveChat();

  if (modelsFetchAbort) modelsFetchAbort.abort();
  const controller = new AbortController();
  setModelsFetchAbort(controller);
  const { signal } = controller;

  sel.innerHTML = '<option value="">Loading models…</option>';
  setStatus('spin', 'Loading models…');

  let providerLabel = 'provider';
  try {
    const provider = await getActiveProvider(chat.providerId);
    providerLabel = provider.label;

    const models = await fetchModelsForProvider(provider, signal);

    if (!models.length) {
      sel.innerHTML = '<option value="">No models found</option>';
      setStatus('err', `No models for ${provider.label}`);
      return;
    }

    sel.innerHTML = models
      .map((m) => {
        const loaded = m.state === 'loaded';
        const tag = m.quantization ? ` · ${m.quantization}` : '';
        const stateLabel = loaded ? 'loaded' : 'not loaded';
        return `<option value="${m.id}">${m.id}${tag} (${stateLabel})</option>`;
      })
      .join('');

    modelCache.clear();
    models.forEach((m) => modelCache.set(m.id, m));

    const ac = getActiveChat();
    const optionIds = models.map((m) => m.id);
    if (ac.modelId && optionIds.includes(ac.modelId)) {
      sel.value = ac.modelId;
    } else {
      const loadedIdx = models.findIndex((m) => m.state === 'loaded');
      if (loadedIdx >= 0) sel.selectedIndex = loadedIdx;
      ac.modelId = sel.value;
    }

    const nLoaded = models.filter((m) => m.state === 'loaded').length;
    setStatus('ok', `${models.length} models, ${nLoaded} loaded`);
    showCachedModelInfo();
    renderSidebar();
    scheduleSaveSessions();
  } catch (err) {
    const e = err as { name?: string };
    if (e && e.name === 'AbortError') return;
    sel.innerHTML = '<option value="">Cannot reach provider</option>';
    setStatus('err', `Cannot reach ${providerLabel}`);
  } finally {
    if (modelsFetchAbort && modelsFetchAbort.signal === signal) {
      setModelsFetchAbort(null);
    }
  }
}
