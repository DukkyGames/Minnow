/**
 * Classify why an SSE completion round ended (pure, no DOM).
 */
export type StreamEndKind = 'complete' | 'truncated' | 'aborted' | 'provider_error' | 'incomplete';
export declare function classifyStreamEnd(input: {
    finishReason: string | undefined;
    toolCallsCount: number;
    textLength: number;
    streamError?: string | null;
    endStatus?: 'complete' | 'error' | 'cancelled';
}): {
    kind: StreamEndKind;
    message?: string;
};
/** Throw or return truncation flag based on {@link classifyStreamEnd}. */
export declare function applyClassifiedStreamEnd(classified: ReturnType<typeof classifyStreamEnd>, context: {
    hasPostToolTail: boolean;
    textLength: number;
}): {
    truncated: boolean;
};
