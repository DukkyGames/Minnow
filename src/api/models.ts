import { modelCache, modelsFetchAbort, setModelsFetchAbort } from '../app-state';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import type { LmModelRecord, ModelInfo } from '../types';
import { renderSidebar } from '../ui/sidebar';
import { parseServerBaseUrl, serverUrl, setStatus } from '../ui/status';
import { updateStrip } from '../ui/stats';

export { modelCache };

/** Merge cached model row with optional fields from a chat completion response. */
export function resolveModelInfo(
  modelId: string,
  fromResponse?: ModelInfo | null
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

/** Load LLM/VLM models from LM Studio and populate the model select. */
export async function fetchModels(): Promise<void> {
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const base = parseServerBaseUrl(serverUrl());
  if (!base) {
    sel.innerHTML = '<option value="">Invalid server URL</option>';
    setStatus('err', 'Check server URL in Settings');
    return;
  }

  if (modelsFetchAbort) modelsFetchAbort.abort();
  const controller = new AbortController();
  setModelsFetchAbort(controller);
  const { signal } = controller;

  sel.innerHTML = '<option value="">Loading models…</option>';
  setStatus('spin', 'Loading models…');
  try {
    const res = await fetch(`${base}/api/v0/models`, { signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { data?: LmModelRecord[] };
    const models = (data.data || []).filter((m) => m.type === 'llm' || m.type === 'vlm');

    if (!models.length) {
      sel.innerHTML = '<option value="">No models found</option>';
      setStatus('err', 'No models in LM Studio');
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
    sel.innerHTML = '<option value="">Cannot reach server</option>';
    setStatus('err', 'Cannot reach LM Studio');
  } finally {
    if (modelsFetchAbort && modelsFetchAbort.signal === signal) {
      setModelsFetchAbort(null);
    }
  }
}
