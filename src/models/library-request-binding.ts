/**
 * Map a model-picker binding onto the provider/model an upstream request must use.
 *
 * My Models rows carry the synthetic `minnow-library` provider id, which is not in
 * the registry — `resolveProvider` cannot route it. Completions need the running
 * serve's registry provider plus its upstream model id (an absolute snapshot
 * directory for MLX, since `mlx_lm.server` keys requests by path).
 *
 * Chat does this inline in the tool loop; every other caller (prompt expander,
 * inline completion, intent coding, Quick Edit, commit messages) goes through here.
 */

import { LLAMA_CPP_LOCAL_PROVIDER_ID, MLX_LM_LOCAL_PROVIDER_ID } from '../providers/types';
import { fetchCachedModels, listModelServes, type ServeRecord } from './api-client';
import {
  isLibraryModelBinding,
  loadableLibraryFromCached,
  resolveLibraryModelIdForChatBinding,
  resolveLibrarySendBinding,
} from './model-select-library';

/** Shown when a My Models row is selected but no serve is running behind it. */
export const LIBRARY_MODEL_NOT_LOADED_MESSAGE =
  'Model is not loaded — load it in Models, or send a chat message to start it.';

export type LibraryRequestBinding =
  /** Not a My Models row — send the binding as given. */
  | { kind: 'direct'; providerId: string; modelId: string }
  /** My Models row with a running serve; ids are the upstream ones. */
  | { kind: 'served'; providerId: string; modelId: string; libraryModelId: string }
  /** My Models row with no running serve — caller must load it or fail. */
  | { kind: 'needsLoad'; libraryModelId: string };

/**
 * Bindings worth a library scan: the synthetic picker id, plus the two local
 * runtime providers a previous served turn may have persisted onto the chat.
 */
function couldBeLibraryBinding(providerId: string, modelId: string): boolean {
  if (isLibraryModelBinding(providerId, modelId)) return true;
  return (
    providerId === LLAMA_CPP_LOCAL_PROVIDER_ID || providerId === MLX_LM_LOCAL_PROVIDER_ID
  );
}

/**
 * Resolve a picker binding to what the completions request should actually carry.
 * Soft-fails the models API so a transient tool-server blip degrades to `direct`
 * rather than blocking the request.
 */
export async function resolveLibraryRequestBinding(
  providerId: string,
  modelId: string,
): Promise<LibraryRequestBinding> {
  const pid = providerId.trim();
  const mid = modelId.trim();
  const direct = { kind: 'direct', providerId: pid, modelId: mid } as const;
  if (!pid || !mid) return direct;
  if (!couldBeLibraryBinding(pid, mid)) return direct;

  const [cached, serves] = await Promise.all([
    fetchCachedModels().catch(() => []),
    listModelServes().catch(() => [] as ServeRecord[]),
  ]);
  const library = await loadableLibraryFromCached(cached).catch(() => []);
  const libraryModelId = resolveLibraryModelIdForChatBinding(pid, mid, library);

  if (libraryModelId == null) {
    // A real llama-cpp-local / mlx-lm-local row that is not a library model.
    // The synthetic id has no upstream at all, so refuse rather than misroute it.
    if (isLibraryModelBinding(pid, mid)) {
      return { kind: 'needsLoad', libraryModelId: mid };
    }
    return direct;
  }

  const served = resolveLibrarySendBinding(libraryModelId, library, serves);
  if (served) {
    return {
      kind: 'served',
      providerId: served.providerId,
      modelId: served.modelId,
      libraryModelId,
    };
  }
  return { kind: 'needsLoad', libraryModelId };
}
