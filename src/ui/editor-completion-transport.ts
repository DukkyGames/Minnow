import type { EditorAiCompletionConfig } from '../config/editor-ai-completion';

/** Cache transport label (legacy native-FIM flag — retained for cache key stability only). */
export function completionCacheTransportMode(config: EditorAiCompletionConfig): string {
  return config.useNativeFim ? 'native-fim' : 'chat';
}
