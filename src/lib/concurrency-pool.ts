/**
 * Bounded worker pool for parallel async work (tool batches, benchmark matrices).
 */

export interface PoolWorkItem<T> {
  id: string;
  payload: T;
}

export interface PoolWorkerContext<T, R> {
  item: PoolWorkItem<T>;
  signal: AbortSignal;
}

export interface RunWithConcurrencyOptions<T, R> {
  items: PoolWorkItem<T>[];
  concurrency: number;
  signal?: AbortSignal;
  onItemStart?: (item: PoolWorkItem<T>) => void;
  onItemDone?: (item: PoolWorkItem<T>, result: R) => void;
  worker: (ctx: PoolWorkerContext<T, R>) => Promise<R>;
}

export interface PoolRunResult<R> {
  /**
   * Results for the items that ran, in input order. Always dense — never
   * positionally aligned with `items`, because an abort leaves gaps.
   */
  results: R[];
  /** True when the signal aborted before every item ran, so `results` is short. */
  aborted: boolean;
}

/**
 * Run work items with a bounded worker pool. Results preserve input order but
 * only cover items that actually ran: workers bail on abort, so aligning the
 * output positionally with `items` would hand callers a sparse array.
 */
export async function runWithConcurrency<T, R>(
  options: RunWithConcurrencyOptions<T, R>,
): Promise<PoolRunResult<R>> {
  const signal = options.signal ?? new AbortController().signal;
  const concurrency = Math.max(1, options.concurrency);
  const byIndex = new Map<number, R>();
  let index = 0;

  async function workerLoop(): Promise<void> {
    while (index < options.items.length) {
      if (signal.aborted) {
        return;
      }
      const i = index++;
      const item = options.items[i]!;
      options.onItemStart?.(item);
      const result = await options.worker({ item, signal });
      byIndex.set(i, result);
      options.onItemDone?.(item, result);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));

  const results: R[] = [];
  for (let i = 0; i < options.items.length; i += 1) {
    if (byIndex.has(i)) {
      results.push(byIndex.get(i)!);
    }
  }
  return { results, aborted: results.length < options.items.length };
}
