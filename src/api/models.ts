import { modelCache, modelsFetchAbort, setModelsFetchAbort } from '../app-state';
import { isServerStorageMode } from '../config/storage-mode';
import { fetchModelsForProvider } from '../providers/fetch-models';
import { providerSupportsModelLoadUnload } from '../providers/capabilities';
import { resolveProviderEndpoints } from '../providers/resolve';
import { getActiveProvider } from '../providers/store';
import {
  getActiveChat,
  scheduleSaveSessions,
  touchChat,
} from '../state/sessions';
import { buildModelOptionHtml } from '../lib/format-model-label';
import type { ModelInfo } from '../types';
import { updateModelStateDot } from '../ui/model-state-dot';
import { renderSidebar } from '../ui/sidebar';
import { setReadyStatus, setStatus } from '../ui/status';
import { updateStrip } from '../ui/stats';

export { modelCache };

/** LM Studio v0 uses "loaded" / "not-loaded" for model rows. */
export function isModelLoaded(state?: string): boolean {
  return state === 'loaded';
}

let modelLoadUnloadInFlight = false;
let activeProviderSupportsLoadUnload = false;

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

/** Update Load/Unload visibility and disabled state from selection + provider. */
export function updateModelLoadUnloadButtons(): void {
  const loadBtn = document.getElementById('btnLoadModel') as HTMLButtonElement | null;
  const unloadBtn = document.getElementById('btnUnloadModel') as HTMLButtonElement | null;
  if (!loadBtn || !unloadBtn) return;

  const serverMode = isServerStorageMode();
  const supports = serverMode && activeProviderSupportsLoadUnload;

  loadBtn.hidden = !supports;
  unloadBtn.hidden = !supports;
  if (!supports) {
    loadBtn.disabled = true;
    unloadBtn.disabled = true;
    loadBtn.title = serverMode
      ? 'Model load/unload is not supported for this provider'
      : 'Start with npm start to load or unload models';
    unloadBtn.title = loadBtn.title;
    return;
  }

  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const modelId = sel.value;
  const row = modelId ? modelCache.get(modelId) : undefined;
  const loaded = row ? isModelLoaded(row.state) : false;
  const busy = modelLoadUnloadInFlight;

  loadBtn.disabled = busy || !modelId || loaded;
  unloadBtn.disabled = busy || !modelId || !loaded;

  if (busy) {
    loadBtn.title = 'Model action in progress…';
    unloadBtn.title = loadBtn.title;
  } else if (!modelId) {
    loadBtn.title = 'Select a model to load';
    unloadBtn.title = 'Select a model to unload';
  } else if (loaded) {
    loadBtn.title = 'Model is already loaded';
    unloadBtn.title = 'Unload selected model from VRAM';
  } else {
    loadBtn.title = 'Load selected model into VRAM';
    unloadBtn.title = 'Model is not loaded';
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

/** Load a model via the active provider (v1 REST, proxied or direct). */
export async function loadModel(modelId: string): Promise<void> {
  const chat = getActiveChat();
  const provider = await getActiveProvider(chat.providerId);
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

/** Unload a model instance via the active provider. */
export async function unloadModel(modelId: string): Promise<void> {
  const chat = getActiveChat();
  const provider = await getActiveProvider(chat.providerId);
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
  const modelId = sel.value;
  if (!modelId) return;

  modelLoadUnloadInFlight = true;
  updateModelLoadUnloadButtons();
  setStatus('spin', 'Loading model…');
  try {
    await loadModel(modelId);
    setStatus('ok', 'Model loaded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  } finally {
    modelLoadUnloadInFlight = false;
    updateModelLoadUnloadButtons();
  }
}

/** Unload the model currently selected in the topbar picker. */
export async function unloadSelectedModel(): Promise<void> {
  if (modelLoadUnloadInFlight) return;
  const sel = document.getElementById('modelSelect') as HTMLSelectElement;
  const modelId = sel.value;
  if (!modelId) return;

  modelLoadUnloadInFlight = true;
  updateModelLoadUnloadButtons();
  setStatus('spin', 'Unloading model…');
  try {
    await unloadModel(modelId);
    setStatus('ok', 'Model unloaded');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setStatus('err', message);
  } finally {
    modelLoadUnloadInFlight = false;
    updateModelLoadUnloadButtons();
  }
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
  updateModelLoadUnloadButtons();

  let providerLabel = 'provider';
  try {
    const provider = await getActiveProvider(chat.providerId);
    providerLabel = provider.label;
    activeProviderSupportsLoadUnload = providerSupportsModelLoadUnload(provider);

    const models = await fetchModelsForProvider(provider, signal);

    if (!models.length) {
      sel.innerHTML = '<option value="">No models found</option>';
      setStatus('err', `No models for ${provider.label}`);
      updateModelLoadUnloadButtons();
      return;
    }

    sel.innerHTML = models.map((m) => buildModelOptionHtml(m)).join('');

    modelCache.clear();
    models.forEach((m) => modelCache.set(m.id, m));

    const ac = getActiveChat();
    const optionIds = models.map((m) => m.id);
    if (ac.modelId && optionIds.includes(ac.modelId)) {
      sel.value = ac.modelId;
    } else {
      const loadedIdx = models.findIndex((m) => isModelLoaded(m.state));
      if (loadedIdx >= 0) sel.selectedIndex = loadedIdx;
      ac.modelId = sel.value;
    }

    setReadyStatus();
    updateModelStateDot(sel.value);
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
    updateModelLoadUnloadButtons();
    updateModelStateDot(sel.value);
  }
}
