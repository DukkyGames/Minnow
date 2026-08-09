/**
 * Classify why an SSE completion round ended (pure, no DOM).
 */

export type StreamEndKind =
  | 'complete'
  | 'truncated'
  | 'aborted'
  | 'provider_error'
  | 'incomplete';

export function classifyStreamEnd(input: {
  finishReason: string | undefined;
  toolCallsCount: number;
  textLength: number;
  streamError?: string | null;
  endStatus?: 'complete' | 'error' | 'cancelled';
}): { kind: StreamEndKind; message?: string } {
  const streamError = input.streamError?.trim();
  if (streamError) {
    return { kind: 'provider_error', message: streamError };
  }
  if (input.endStatus === 'error') {
    return { kind: 'provider_error', message: 'Generation failed' };
  }
  if (input.endStatus === 'cancelled') {
    return { kind: 'aborted' };
  }
  if (input.finishReason === 'length') {
    return { kind: 'truncated' };
  }
  if (input.finishReason || input.toolCallsCount > 0) {
    return { kind: 'complete' };
  }
  return { kind: 'incomplete' };
}

/** Throw or return truncation flag based on {@link classifyStreamEnd}. */
export function applyClassifiedStreamEnd(
  classified: ReturnType<typeof classifyStreamEnd>,
  context: { hasPostToolTail: boolean; textLength: number },
): { truncated: boolean } {
  switch (classified.kind) {
    case 'provider_error':
      throw new Error(classified.message ?? 'Generation failed');
    case 'aborted':
      throw new DOMException('Aborted', 'AbortError');
    case 'truncated':
      return { truncated: true };
    case 'incomplete': {
      if (context.textLength === 0 && context.hasPostToolTail) {
        return { truncated: false };
      }
      throw new Error('The model returned no output (the stream ended early).');
    }
    case 'complete':
      return { truncated: false };
    default:
      return { truncated: false };
  }
}
