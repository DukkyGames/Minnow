/**
 * Map chat/composer model bindings to provider + upstream model ids for completions.
 * My Models library rows (gguf:/mlx:) remap to llama-cpp-local / mlx-lm-local and local paths.
 */

import { modelCache } from '../app-state';
import { fetchModels } from './models';
import {
  fetchCachedModels,
  listModelServes,
  type ServeRecord,
} from '../models/api-client';
import type { LibraryModel } from '../models/library';
import {
  LIBRARY_MODEL_PROVIDER_ID,
  libraryBindingNeedsServeLoad,
  loadableLibraryFromCached,
  resolveLibraryModelIdForChatBinding,
  resolveLibrarySendBinding,
  resolveUpstreamProviderId,
} from '../models/model-select-library';
import {
  getActiveProvider,
  invalidateProviderCache,
} from '../providers/store';
import {
  LLAMA_CPP_LOCAL_PROVIDER_ID,
  MLX_LM_LOCAL_PROVIDER_ID,
} from '../providers/types';
import {
  chatTurnNeedsModelLoad,
  ensureChatModelLoadedForTurn,
} from './ensure-chat-model-loaded';

export interface ChatCompletionsBinding {
  providerId: string;
  modelId: string;
}

export interface ResolvedChatCompletionsBinding extends ChatCompletionsBinding {
  /** Library ids for ensure-load before remap (minnow-library + gguf:/mlx:). */
  libraryEnsure: { providerId: string; modelId: string } | null;
}

/**
 * Pure remap once library rows and serve status are known (mirrors chat send in loop.ts).
 */
export function resolveChatCompletionsBindingFromCatalog(
  providerId: string,
  modelId: string,
  library: LibraryModel[],
  serves: ServeRecord[],
): ResolvedChatCompletionsBinding {
  const pid = providerId.trim();
  const mid = modelId.trim();
  const libraryModelId = resolveLibraryModelIdForChatBinding(pid, mid, library);

  if (libraryModelId == null) {
    return { providerId: pid, modelId: mid, libraryEnsure: null };
  }

  const libraryEnsure = {
    providerId: LIBRARY_MODEL_PROVIDER_ID,
    modelId: libraryModelId,
  };
  const served = resolveLibrarySendBinding(libraryModelId, library, serves);
  if (served) {
    return { ...served, libraryEnsure };
  }

  let sendProviderId = resolveUpstreamProviderId(LIBRARY_MODEL_PROVIDER_ID, libraryModelId);
  let sendModelId = libraryModelId;
  const libRow = library.find((m) => m.id === libraryModelId);
  if (
    libRow?.format === 'MLX' &&
    libRow.path?.trim() &&
    sendModelId.trim().startsWith('mlx:')
  ) {
    sendModelId = libRow.path.trim();
  }
  return { providerId: sendProviderId, modelId: sendModelId, libraryEnsure };
}

/** Fetch library catalog and remap binding for one completions request. */
export async function resolveChatCompletionsBinding(
  providerId: string,
  modelId: string,
): Promise<ResolvedChatCompletionsBinding> {
  const cached = await fetchCachedModels().catch(() => []);
  const library = await loadableLibraryFromCached(cached);
  const serves = await listModelServes().catch(() => []);
  return resolveChatCompletionsBindingFromCatalog(providerId, modelId, library, serves);
}

/** Local serve providers are upserted on the server during load — refresh client caches. */
async function refreshLocalServeProviderCatalog(
  binding: ChatCompletionsBinding,
): Promise<void> {
  const pid = binding.providerId.trim();
  if (pid !== MLX_LM_LOCAL_PROVIDER_ID && pid !== LLAMA_CPP_LOCAL_PROVIDER_ID) return;
  invalidateProviderCache();
  try {
    await fetchModels();
  } catch {
    /* picker refresh is best-effort; listProviders will refetch on next resolve */
  }
}

/**
 * Ensure the model is loaded (My Models serve or provider load-unload) and return upstream ids.
 */
export async function prepareChatCompletionsBinding(
  providerId: string,
  modelId: string,
  signal?: AbortSignal,
): Promise<ChatCompletionsBinding> {
  const resolved = await resolveChatCompletionsBinding(providerId, modelId);

  if (resolved.libraryEnsure) {
    const cached = await fetchCachedModels().catch(() => []);
    const library = await loadableLibraryFromCached(cached);
    const serves = await listModelServes().catch(() => []);
    const needsLoad = libraryBindingNeedsServeLoad(
      resolved.libraryEnsure.modelId,
      library,
      serves,
      modelCache,
    );
    if (needsLoad) {
      await ensureChatModelLoadedForTurn(
        resolved.libraryEnsure.providerId,
        resolved.libraryEnsure.modelId,
        signal,
      );
      const cachedAfter = await fetchCachedModels().catch(() => []);
      const libraryAfter = await loadableLibraryFromCached(cachedAfter);
      const servesAfter = await listModelServes().catch(() => []);
      const served = resolveLibrarySendBinding(
        resolved.libraryEnsure.modelId,
        libraryAfter,
        servesAfter,
      );
      if (!served) {
        throw new Error('Failed to load My Models model — no running serve after load');
      }
      await refreshLocalServeProviderCatalog(served);
      return served;
    }
    const binding = { providerId: resolved.providerId, modelId: resolved.modelId };
    await refreshLocalServeProviderCatalog(binding);
    return binding;
  }

  const provider = await getActiveProvider(resolved.providerId);
  if (chatTurnNeedsModelLoad(provider, resolved.modelId)) {
    await ensureChatModelLoadedForTurn(
      resolved.providerId,
      resolved.modelId,
      signal,
    );
  }
  const binding = { providerId: resolved.providerId, modelId: resolved.modelId };
  await refreshLocalServeProviderCatalog(binding);
  return binding;
}
