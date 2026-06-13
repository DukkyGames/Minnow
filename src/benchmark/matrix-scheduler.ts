/**
 * Generic concurrency pool for target×work matrices.
 */

export interface MatrixWorkItem<T> {
  id: string;
  payload: T;
}

export interface MatrixWorkerContext<T, R> {
  item: MatrixWorkItem<T>;
  signal: AbortSignal;
}

export interface RunMatrixOptions<T, R> {
  items: MatrixWorkItem<T>[];
  concurrency: number;
  signal?: AbortSignal;
  onItemStart?: (item: MatrixWorkItem<T>) => void;
  onItemDone?: (item: MatrixWorkItem<T>, result: R) => void;
  worker: (ctx: MatrixWorkerContext<T, R>) => Promise<R>;
}

/** Run work items with a bounded worker pool. */
export async function runMatrix<T, R>(options: RunMatrixOptions<T, R>): Promise<R[]> {
  const signal = options.signal ?? new AbortController().signal;
  const concurrency = Math.max(1, Math.min(8, options.concurrency));
  const results: R[] = new Array(options.items.length);
  let index = 0;

  async function workerLoop(): Promise<void> {
    while (index < options.items.length) {
      if (signal.aborted) return;
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
