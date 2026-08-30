/**
 * Detect browser fetch transport failures that often succeed on a quick retry.
 * Used by main chat, sub-agents, and goal evaluation.
 */
/** True when a fetch rejection is likely a transient network blip. */
export declare function isTransientFetchError(err: unknown): boolean;
/** Run `fn` once more after a short delay when the first attempt hits a transient fetch error. */
export declare function retryOnceOnTransientFetch<T>(fn: () => Promise<T>, delayMs?: number): Promise<T>;
