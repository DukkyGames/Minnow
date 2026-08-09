/**
 * Editor AI provider/model binding — no CodeMirror dependency (boot-graph split).
 */

import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';
import { decodeModelSelectKey } from '../lib/model-select-key';
import {
  LIBRARY_MODEL_NOT_LOADED_MESSAGE,
  resolveLibraryRequestBinding,
} from '../models/library-request-binding';
import { resolveProvider } from '../providers/store';
import { getActiveChat } from '../state/sessions';

export interface EditorAiBinding {
  providerId: string;
  modelId: string;
  /**
   * Set when the binding cannot be sent as-is (My Models row with no serve).
   * `validateEditorAiBinding` surfaces it; editor AI never auto-loads a model —
   * a keystroke must not trigger a multi-minute weight load.
   */
  error?: string;
}

/** Shown in the file viewer status bar and Quick Edit panel when modelId is empty. */
export const EDITOR_AI_NO_MODEL_MESSAGE =
  'No model assigned — pick a model in the top bar or pin one in Settings → Editor.';

/** Generic fallback when the backend fails without a specific message. */
export const EDITOR_AI_REQUEST_FAILED_MESSAGE =
  'AI completion failed — check provider and model in Settings';

/** Shown when the model streams successfully but yields no insertable text. */
export const EDITOR_AI_EMPTY_COMPLETION_MESSAGE =
  'Model returned no completion text. Try a coder model or disable thinking in your provider.';

export const EDITOR_AI_COMPLETION_OVERSIZED_MESSAGE =
  'Completion too long for inline insert — lower max tokens or edit a smaller region.';

export const EDITOR_AI_COMPLETION_PROSE_MESSAGE =
  'Model returned explanation instead of code — try a coder model.';

export const EDITOR_AI_COMPLETION_PREFIX_ECHO_MESSAGE =
  'Model repeated existing text — no suggestion shown.';

export const EDITOR_AI_COMPLETION_FULL_REWRITE_MESSAGE =
  'Completion would replace most of the file — rejected.';

export type EditorAiBindingValidation =
  | { ok: true }
  | { ok: false; message: string };

/** Require a provider and model before editor AI requests (inline completion, Quick Edit). */
export function validateEditorAiBinding(
  binding: EditorAiBinding,
): EditorAiBindingValidation {
  if (!binding.providerId.trim()) {
    return {
      ok: false,
      message:
        'No provider configured for editor AI. Add one in Settings → Providers.',
    };
  }
  if (!binding.modelId.trim()) {
    return { ok: false, message: EDITOR_AI_NO_MODEL_MESSAGE };
  }
  if (binding.error) {
    return { ok: false, message: binding.error };
  }
  return { ok: true };
}

/** Active top-bar model select value (same source as composer send / benchmark). */
export function getActiveModelIdFromDom(): string {
  if (typeof document === 'undefined') return '';
  const sel = document.getElementById('modelSelect') as HTMLSelectElement | null;
  return sel?.value?.trim() ?? '';
}

/** Return a user-facing error when binding has no model; null when ready. */
export function preflightEditorAiBinding(binding: EditorAiBinding): string | null {
  if (binding.modelId.trim()) return null;
  return EDITOR_AI_NO_MODEL_MESSAGE;
}

/**
 * Remap a My Models row onto its running serve.
 * `minnow-library` is a synthetic picker id with no registry row, so sending it
 * unmapped lets `resolveProvider` fall through to an unrelated provider.
 */
async function applyLibraryBinding(binding: EditorAiBinding): Promise<EditorAiBinding> {
  if (!binding.modelId.trim()) return binding;
  const resolved = await resolveLibraryRequestBinding(
    binding.providerId,
    binding.modelId,
  );
  if (resolved.kind === 'needsLoad') {
    return { ...binding, error: LIBRARY_MODEL_NOT_LOADED_MESSAGE };
  }
  return { providerId: resolved.providerId, modelId: resolved.modelId };
}

/** Resolve provider/model from config + active chat. */
export async function resolveEditorAiBinding(
  config: EditorAiCompletionConfig,
): Promise<EditorAiBinding> {
  const chat = getActiveChat();
  const overrideProvider = config.providerId.trim();
  const overrideModel = config.modelId.trim();

  // Pinned provider + model (Settings → Editor → Pin).
  if (!config.useChatModel) {
    return applyLibraryBinding({ providerId: overrideProvider, modelId: overrideModel });
  }

  // Follow active chat / top-bar model picker (live DOM read on each request).
  const raw = getActiveModelIdFromDom();
  const parsed = decodeModelSelectKey(raw);
  const modelId =
    (parsed?.modelId ?? raw).trim() || chat.modelId?.trim() || '';
  const providerId =
    parsed?.providerId?.trim() ||
    chat.providerId?.trim() ||
    (await resolveProvider()).id;
  return applyLibraryBinding({ providerId, modelId });
}
