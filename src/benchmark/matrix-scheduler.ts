/**
 * Generic concurrency pool for target×work matrices.
 */

import { runWithConcurrency } from '../lib/concurrency-pool.ts';

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
  const concurrency = Math.max(1, Math.min(8, options.concurrency));
  return runWithConcurrency({
    items: options.items,
    concurrency,
    signal: options.signal,
    onItemStart: options.onItemStart,
    onItemDone: options.onItemDone,
    worker: options.worker,
  });
}
