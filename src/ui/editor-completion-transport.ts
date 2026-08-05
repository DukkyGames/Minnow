/**
 * Completion cache transport label — no CodeMirror (boot-graph split).
 */

import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';

/** Cache transport label (legacy native-FIM flag — retained for cache key stability only). */
export function completionCacheTransportMode(config: EditorAiCompletionConfig): string {
  // `useNativeFim` is deprecated and ignored; always chat/FIM messages (see editor-ai-completion config).
  return config.useNativeFim ? 'native-fim' : 'chat';
}
