import { modelCache } from '../app-state';
import { isServerStorageMode } from '../config/storage-mode';
import { encodeModelSelectKey } from '../lib/model-select-key';
import { providerSupportsModelLoadUnload } from '../providers/capabilities';
import {
  isLibraryModelBinding,
  loadLibraryModelFromPicker,
} from '../models/model-select-library';
import { invalidateProviderCache, listProviders } from '../providers/store';
import type { ProviderPublic } from '../providers/types';
import {
  beginModelLoadUnload,
  endModelLoadUnload,
  isModelLoadUnloadBusy,
} from '../ui/model-load-unload-button';
import { updateModelStateDot } from '../ui/model-state-dot';
import { syncModelSelectPicker } from '../ui/model-select-picker';
import { fetchModels, loadModel, updateModelLoadUnloadButtons } from './models';
import { isModelLoaded } from './model-loaded-state';

const POLL_MS = 400;

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** Wait until the global load/unload action started from the model picker finishes. */
async function waitForModelLoadUnloadIdle(signal?: AbortSignal): Promise<void> {
  while (isModelLoadUnloadBusy()) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await delay(POLL_MS, signal);
  }
}

/** Loaded state for one provider+model pair (no cross-provider canonical fallback). */
function modelRowIsLoaded(providerId: string, modelId: string): boolean {
  const pid = providerId.trim();
  const mid = modelId.trim();
  if (!pid || !mid) return true;
  const row = modelCache.get(encodeModelSelectKey(pid, mid));
  if (!row) return false;
  return isModelLoaded(row.state);
}

/** True when a local load-unload provider needs the model in memory before chat. */
export function chatTurnNeedsModelLoad(
  provider: ProviderPublic | null | undefined,
  modelId: string,
): boolean {
  if (!isServerStorageMode()) return false;
  const mid = modelId.trim();
  if (!mid) return false;

  if (isLibraryModelBinding(provider?.id, mid)) {
    const row = modelCache.get(encodeModelSelectKey(provider!.id, mid));
    if (row && isModelLoaded(row.state)) return false;
    return true;
  }

  if (!provider || !providerSupportsModelLoadUnload(provider)) return false;
  return !modelRowIsLoaded(provider.id, mid);
}

async function runModelLoad(providerId: string, modelId: string): Promise<void> {
  const selectValue = encodeModelSelectKey(providerId, modelId);
  beginModelLoadUnload('load');
  updateModelLoadUnloadButtons();
  updateModelStateDot(selectValue);
  syncModelSelectPicker();
  try {
    await loadModel(modelId, providerId);
  } finally {
    endModelLoadUnload();
    updateModelLoadUnloadButtons();
    updateModelStateDot(selectValue);
    syncModelSelectPicker();
  }
}

/**
 * Load the model or wait for an in-flight load. Throws on abort or load failure.
 */
export async function ensureChatModelLoadedForTurn(
  providerId: string,
  modelId: string,
  signal?: AbortSignal,
): Promise<void> {
  const pid = providerId.trim();
  const mid = modelId.trim();
  if (!pid || !mid) return;

  if (isLibraryModelBinding(pid, mid)) {
    const selectValue = encodeModelSelectKey(pid, mid);

    if (isModelLoadUnloadBusy()) {
      await waitForModelLoadUnloadIdle(signal);
    }

    beginModelLoadUnload('load');
    updateModelLoadUnloadButtons();
    updateModelStateDot(selectValue);
    syncModelSelectPicker();
    try {
      await loadLibraryModelFromPicker(mid);
      invalidateProviderCache();
      await fetchModels();
    } finally {
      endModelLoadUnload();
      updateModelLoadUnloadButtons();
      updateModelStateDot(selectValue);
      syncModelSelectPicker();
    }

    return;
  }

  const { providers } = await listProviders();
  const provider = providers.find((p) => p.id === pid && p.enabled !== false);
  if (!provider || !providerSupportsModelLoadUnload(provider)) return;

  if (modelRowIsLoaded(pid, mid)) return;

  if (isModelLoadUnloadBusy()) {
    await waitForModelLoadUnloadIdle(signal);
    if (modelRowIsLoaded(pid, mid)) return;
  }

  if (!modelRowIsLoaded(pid, mid)) {
    await runModelLoad(pid, mid);
    return;
  }

  while (!modelRowIsLoaded(pid, mid)) {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    await fetchModels();
    if (modelRowIsLoaded(pid, mid)) return;
    await delay(POLL_MS, signal);
  }
}
