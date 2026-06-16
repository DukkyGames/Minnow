/**
 * Memory adapter: binds ~/.minnow/memory paths into the shared backup engine.
 */

import { createBackup } from '../engine/backup.js';
import { getEnginePaths } from './engine-paths.js';
import { ensureMemoryStore, loadAllEntriesWithBodies } from './store.js';

const backup = createBackup(getEnginePaths, {
  ensureLayout: ensureMemoryStore,
  countRestoredEntries: async () => {
    const entries = await loadAllEntriesWithBodies();
    return entries.length;
  },
});

export const { backupMemory, restoreMemory } = backup;
