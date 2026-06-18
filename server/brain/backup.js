/**
 * Brain wiki backup and restore under ~/.minnow/backups/.
 */

import { createBackup } from '../engine/backup.js';
import { getEnginePaths } from './engine-paths.js';
import { ensureBrainLayout, listPages } from './store.js';

const backup = createBackup(getEnginePaths, {
  ensureLayout: ensureBrainLayout,
  countRestoredEntries: async () => {
    const pages = await listPages();
    return pages.length;
  },
});

export const { backupBrain, restoreBrain } = {
  backupBrain: backup.backupMemory,
  restoreBrain: backup.restoreMemory,
};
