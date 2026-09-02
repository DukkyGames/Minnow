import { decodeModelSelectKey } from '../../lib/model-select-key';
import { resolveProvider } from '../../providers/store';
import { getActiveChat } from '../../state/sessions';
import {
  EDITOR_AI_NO_MODEL_MESSAGE,
  getActiveModelIdFromDom,
} from '../editor-ai-binding';

export interface BrainCleanupModelBinding {
  providerId: string;
  modelId: string;
}

/** Active chat + top-bar model select (same source as composer). */
export async function resolveBrainCleanupModelBinding(): Promise<BrainCleanupModelBinding> {
  const chat = getActiveChat();
  const raw = getActiveModelIdFromDom();
  const parsed = decodeModelSelectKey(raw);
  const modelId =
    (parsed?.modelId ?? raw).trim() || chat.modelId?.trim() || '';
  const providerId =
    parsed?.providerId?.trim() ||
    chat.providerId?.trim() ||
    (await resolveProvider()).id;
  return { providerId, modelId };
}

/** Return a user-facing error when binding has no model; null when ready. */
export function preflightBrainCleanupModel(binding: BrainCleanupModelBinding): string | null {
  if (!binding.providerId.trim()) {
    return 'No provider configured. Add one in Settings → Providers.';
  }
  if (!binding.modelId.trim()) {
    return EDITOR_AI_NO_MODEL_MESSAGE;
  }
  return null;
}
