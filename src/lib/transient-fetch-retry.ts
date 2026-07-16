/**
 * Detect browser fetch transport failures that often succeed on a quick retry.
 * Used by main chat, sub-agents, and goal evaluation.
 */

/** True when a fetch rejection is likely a transient network blip. */
export function isTransientFetchError(err: unknown): boolean {
  if (!(err instanceof TypeError)) return false;
  const message = err.message;
  return message.includes('Failed to fetch') || message.includes('NetworkError');
}

/** Run `fn` once more after a short delay when the first attempt hits a transient fetch error. */
export async function retryOnceOnTransientFetch<T>(
  fn: () => Promise<T>,
  delayMs = 400,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!isTransientFetchError(err)) {
      throw err;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fn();
  }
}
