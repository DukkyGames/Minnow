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

/** Run work items with a bounded worker pool; results preserve input order. */
export async function runWithConcurrency<T, R>(
  options: RunWithConcurrencyOptions<T, R>,
): Promise<R[]> {
  const signal = options.signal ?? new AbortController().signal;
  const concurrency = Math.max(1, options.concurrency);
  const results: R[] = new Array(options.items.length);
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
      results[i] = result;
      options.onItemDone?.(item, result);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => workerLoop()));
  return results;
}
