import {
  cancelGeneration,
  createGeneration,
  subscribeToGeneration,
  type GenerationEndEvent,
} from '../api/generations';
import type { ChatCompletionChunk } from '../types';
import type { CompletionMode } from './editor-completion-policy';

/** Server fallback-chain role for all editor AI completion-style requests. */
export const EDITOR_AI_GENERATION_FALLBACK_ROLE = 'editor-completion';

/** OpenAI-style stop sequences for inline completion by insert mode. */
export function editorCompletionStopSequences(mode: CompletionMode): string[] {
  if (mode === 'single') {
    return ['\n'];
  }
  return ['\n\n\n', '```', '<|fim|>', '\n</file>'].slice(0, 4);
}

/** Cap generation max_tokens for inline completion (single vs multi-line). */
export function editorCompletionMaxTokens(
  configMaxTokens: number,
  mode: CompletionMode,
): number {
  const modeCap = mode === 'single' ? 96 : 192;
  return Math.min(configMaxTokens, modeCap);
}

export interface EditorAiStreamDeps {
  createGeneration?: typeof createGeneration;
  subscribeToGeneration?: typeof subscribeToGeneration;
  cancelGeneration?: typeof cancelGeneration;
}

export interface StreamEditorGenerationHandlers {
  onChunk: (chunk: ChatCompletionChunk) => void;
  onEnd: (event?: GenerationEndEvent) => void;
  onTransportError: (err: unknown) => void;
  /** Fired when `signal` aborts (after cancel is requested). */
  onAbort?: () => void;
}

/**
 * Start a non-persisted generation with editor-completion fallback routing and wire SSE + abort.
 */
export async function streamEditorGeneration(
  providerId: string,
  body: Record<string, unknown>,
  signal: AbortSignal,
  handlers: StreamEditorGenerationHandlers,
  deps: EditorAiStreamDeps = {},
): Promise<{ generationId: string }> {
  const createGen = deps.createGeneration ?? createGeneration;
  const subscribeGen = deps.subscribeToGeneration ?? subscribeToGeneration;
  const cancelGen = deps.cancelGeneration ?? cancelGeneration;

  const { generationId } = await createGen(providerId, body, {
    persist: false,
    fallbackRole: EDITOR_AI_GENERATION_FALLBACK_ROLE,
  });

  let settled = false;
  let unsubscribe: (() => void) | null = null;

  const finish = (): void => {
    if (settled) return;
    settled = true;
    unsubscribe?.();
  };

  unsubscribe = subscribeGen(generationId, {
    signal,
    onChunk: handlers.onChunk,
    onEnd: (event) => {
      finish();
      handlers.onEnd(event);
    },
    onTransportError: (err) => {
      finish();
      handlers.onTransportError(err);
    },
  });

  signal.addEventListener(
    'abort',
    () => {
      finish();
      handlers.onAbort?.();
      void cancelGen(generationId).catch(() => {
      });
    },
    { once: true },
  );

  return { generationId };
}
