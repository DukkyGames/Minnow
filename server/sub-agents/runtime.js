/**
 * P8-F — production delivery host (MIN-759).
 *
 * The renderer is a view: spawn/cancel are POSTs, the fold is the journal.
 * Completions still have to reach the parent chat, and that inject is a
 * completed side effect recorded as `result.delivered` *after* it lands —
 * the same ordering as `attempt.started`.
 *
 * At boot there is no renderer. `deliverToParent` throws when nobody is
 * listening so the fold stays pending; opening an SSE stream retries.
 * `tickAll` at process start is what re-offers work that survived a restart.
 */

import { createDelivery } from './delivery.js';
import {
  appendEvent,
  appendEvents,
  listEntries,
  loadState,
  readEvents,
} from './journal.js';
import { emitDeliver } from '../orchestrator/live-events.js';

/** @type {import('./delivery.js').DeliveryHandle | null} */
let production = null;

/**
 * Parent streaming is a renderer fact. Production defaults to "not streaming"
 * because the server cannot see the composer. P8-H re-asserts the coalesce
 * (complete while parent streams → reload still delivers) by swapping this
 * probe for the duration of a test — not by teaching the fold about UI state.
 *
 * @type {(parentChatId: string) => import('./delivery.js').ParentStatus}
 */
let parentStatusProbe = () => ({ streaming: false, skip: null });

/**
 * Test seam for the "parent is streaming" row of the P8-H gate table.
 * Production never calls this. A missing probe restores the default.
 *
 * @param {((parentChatId: string) => import('./delivery.js').ParentStatus) | null} [fn]
 * @returns {void}
 */
export function setProductionParentStatus(fn) {
  parentStatusProbe =
    typeof fn === 'function' ? fn : () => ({ streaming: false, skip: null });
}

/**
 * Disk journal as the delivery store. Pending vs delivered is `derive()`,
 * not a process-lifetime Set — that is the whole of MIN-639 surviving restart.
 *
 * @returns {import('./delivery.js').DeliveryJournal}
 */
function diskJournal() {
  return {
    loadState,
    appendEvent,
    appendEvents,
    listEntries,
    readEvents,
  };
}

/**
 * Notify the renderer over the parallel (non-journaled) bus. Zero listeners
 * means the UI is not connected — throw so the fold stays pending.
 *
 * @param {string} parentChatId
 * @param {string} message
 * @param {import('./delivery.js').DeliveryMeta} meta
 * @returns {Promise<void>}
 */
async function productionDeliver(parentChatId, message, meta) {
  const n = emitDeliver({
    key: parentChatId,
    parentChatId,
    kind: meta.kind,
    runIds: meta.runIds,
    message,
  });
  if (n === 0) {
    throw new Error('no delivery listener');
  }
}

/**
 * The process-wide delivery handle. Created once so boot `tickAll` and the
 * per-engine subscriber share one retry map.
 *
 * @returns {import('./delivery.js').DeliveryHandle}
 */
export function getProductionDelivery() {
  if (!production) {
    production = createDelivery({
      journal: diskJournal(),
      deliverToParent: productionDeliver,
      // Streaming coalesce is a renderer fact. The server retries when nobody
      // is listening; a connected view receives `event: deliver` and resumes.
      // The probe is called on every tick so a test can flip streaming without
      // rebuilding the handle (the journal stays the queue).
      parentStatus: (parentChatId) => parentStatusProbe(parentChatId),
      onDeliverError: (err) => {
        console.warn('[agents] delivery failed:', err instanceof Error ? err.message : err);
      },
    });
  }
  return production;
}

/**
 * Re-offer every pending completion. A restart must not drop MIN-639's queue.
 *
 * @returns {Promise<void>}
 */
export async function bootAgentsRuntime() {
  try {
    await getProductionDelivery().tickAll();
  } catch (err) {
    console.warn('[agents] boot tickAll failed:', err instanceof Error ? err.message : err);
  }
}

/** Tests: drop the process-wide handle so journals do not leak across cases. */
export function resetProductionDelivery() {
  production?.reset();
  production = null;
  parentStatusProbe = () => ({ streaming: false, skip: null });
}
