/**
 * Shared abort helpers for benchmark runner, suites, and LLM driver.
 */

/** Throws when the signal is already aborted (cooperative cancellation). */
export function assertNotAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  throw abortErrorFromSignal(signal);
}

/** True for DOMException / Error abort types and aborted signals. */
export function isAbortError(err: unknown): boolean {
  if (err instanceof DOMException && err.name === 'AbortError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

/** Rethrow when the failure is due to benchmark cancellation. */
export function rethrowIfAborted(err: unknown, signal: AbortSignal): void {
  if (isAbortError(err) || signal.aborted) {
    throw err instanceof Error ? err : abortErrorFromSignal(signal);
  }
}

/** Build an AbortError for throwing after cooperative cancel. */
export function benchmarkAbortError(signal: AbortSignal): DOMException {
  const reason = signal.reason;
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason;
  if (reason instanceof Error) {
    return new DOMException(reason.message, 'AbortError');
  }
  return new DOMException('Benchmark cancelled', 'AbortError');
}

function abortErrorFromSignal(signal: AbortSignal): DOMException {
  return benchmarkAbortError(signal);
}

/**
 * Rejects as soon as `signal` aborts so callers can escape hung work (e.g. blocking tools).
 * The underlying promise may still run; pair with fetch/stream abort where possible.
 */
/**
 * Run `fn` with a wall-clock timeout that aborts the combined signal (upstream fetch included).
 * Throws a plain Error on timeout; propagates user cancel via AbortError.
 */
export async function withBenchmarkTimeout<T>(
  signal: AbortSignal,
  ms: number,
  fn: (combinedSignal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (signal.aborted) {
    throw benchmarkAbortError(signal);
  }
  const timeoutController = new AbortController();
  const combined = AbortSignal.any([signal, timeoutController.signal]);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = (): void => {
      reject(benchmarkAbortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });

  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      timeoutController.abort();
      reject(new Error(`timed out after ${Math.round(ms / 1000)}s`));
    }, ms);
  });

  try {
    return await Promise.race([fn(combined), timeoutPromise, abortPromise]);
  } catch (err) {
    if (signal.aborted) {
      throw err instanceof Error ? err : benchmarkAbortError(signal);
    }
    if (timeoutController.signal.aborted) {
      throw new Error(`timed out after ${Math.round(ms / 1000)}s`);
    }
    throw err;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function raceWithAbort<T>(signal: AbortSignal, promise: Promise<T>): Promise<T> {
  if (signal.aborted) {
    return Promise.reject(benchmarkAbortError(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      reject(benchmarkAbortError(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      },
    );
  });
}
