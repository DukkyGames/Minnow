/**
 * Memory back-compat adapter: brain backup (MIN-B3).
 * TRACKING: remove with memory adapter layer.
 */

import { backupBrain, restoreBrain } from '../brain/backup.js';
import { ensureMemoryStore, loadAllEntriesWithBodies } from './store.js';

export async function backupMemory() {
  await ensureMemoryStore();
  return backupBrain();
}

export async function restoreMemory(backupId) {
  const result = await restoreBrain(backupId);
  const entries = await loadAllEntriesWithBodies();
  return { restored: entries.length, ...result };
}
