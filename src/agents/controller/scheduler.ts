/**
 * Sub-agent concurrency scheduler: global queue and per-type slot limits.
 */

import { loadSubAgentConfig } from '../sub-agent-config';
import { getRunInternals } from './registry';
import type { QueuedItem, RunInternals } from './types';

const globalQueue: QueuedItem[] = [];

let activeGlobal = 0;
const activeByType = new Map<string, number>();

/** Callback invoked when a queued run acquires a slot and should start. */
export type QueueDispatchFn = (internals: RunInternals, modeId: string) => void;

/** Callback when a queued run references an unknown sub-agent type. */
export type QueueFailFn = (internals: RunInternals, message: string) => void;

let queueDispatch: QueueDispatchFn | null = null;
let queueFail: QueueFailFn | null = null;

/** Wire the launch handler used when drainQueue dequeues a run. */
export function setQueueDispatch(fn: QueueDispatchFn): void {
  queueDispatch = fn;
}

/** Wire the failure handler for dequeue-time type validation. */
export function setQueueFail(fn: QueueFailFn): void {
  queueFail = fn;
}

/** Reserve a concurrency slot before starting upstream work. */
export function acquireConcurrencySlot(internals: RunInternals, type: string): void {
  if (internals.holdsConcurrencySlot) return;
  activeGlobal += 1;
  activeByType.set(type, (activeByType.get(type) ?? 0) + 1);
  internals.holdsConcurrencySlot = true;
}

/** Release a slot when a run reaches a terminal state. */
export function releaseConcurrencySlot(internals: RunInternals): void {
  if (!internals.holdsConcurrencySlot) return;
  internals.holdsConcurrencySlot = false;
  activeGlobal = Math.max(0, activeGlobal - 1);
  const type = internals.run.type;
  const n = (activeByType.get(type) ?? 1) - 1;
  if (n <= 0) activeByType.delete(type);
  else activeByType.set(type, n);
}

/** Whether a new run of this type may start given current occupancy. */
export function canStart(type: string, globalMax: number, typeMax: number): boolean {
  if (activeGlobal >= globalMax) return false;
  if ((activeByType.get(type) ?? 0) >= typeMax) return false;
  return true;
}

/** Enqueue a run that could not acquire a slot immediately. */
export function enqueueRun(runId: string, modeId: string): void {
  globalQueue.push({ runId, modeId });
}

/** Remove a run from the wait queue (cancel while queued). */
export function removeFromQueue(runId: string): number {
  const idx = globalQueue.findIndex((q) => q.runId === runId);
  if (idx >= 0) {
    globalQueue.splice(idx, 1);
  }
  return idx;
}

/**
 * Start queued runs while slots are available.
 * Requires setQueueDispatch to have been called from the controller module.
 */
export function drainQueue(): void {
  if (!queueDispatch) return;

  void loadSubAgentConfig().then((config) => {
    const dispatch = queueDispatch;
    if (!dispatch) return;

    while (globalQueue.length > 0) {
      const item = globalQueue[0];
      const internals = getRunInternals(item.runId);
      if (!internals || internals.run.status !== 'queued') {
        globalQueue.shift();
        continue;
      }

      const typeCfg = config.types[internals.run.type];
      if (!typeCfg) {
        globalQueue.shift();
        queueFail?.(internals, `Unknown type ${internals.run.type}`);
        continue;
      }

      const typeMax = typeCfg.maxConcurrent ?? 1;
      if (!canStart(internals.run.type, config.globalMaxConcurrent, typeMax)) {
        break;
      }

      globalQueue.shift();
      internals.queued = false;
      acquireConcurrencySlot(internals, internals.run.type);
      dispatch(internals, item.modeId);
    }
  });
}

/** Wipe queue and slot counters (test reset). */
export function clearScheduler(): void {
  globalQueue.length = 0;
  activeGlobal = 0;
  activeByType.clear();
}
