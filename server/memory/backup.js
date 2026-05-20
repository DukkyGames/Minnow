/**
 * Memory backup and restore under ~/.minnow/backups/.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getBackupsDir, getMemoryDir } from './paths.js';
import { ensureMemoryStore } from './store.js';

const BACKUP_ID_RE = /^memory-\d{8}T\d{6}Z$/;

function backupIdNow() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `memory-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

async function copyDir(src, dest) {
  await fs.mkdir(dest, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const ent of entries) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      await copyDir(from, to);
    } else {
      await fs.copyFile(from, to);
    }
  }
}

/** Copy memory/ tree to backups/memory-<iso>/ */
export async function backupMemory() {
  await ensureMemoryStore();
  const backupId = backupIdNow();
  const dest = path.join(getBackupsDir(), backupId);
  await fs.mkdir(getBackupsDir(), { recursive: true });
  await copyDir(getMemoryDir(), dest);
  return { backupId, path: dest };
}

/** Restore memory from a named backup folder. */
export async function restoreMemory(backupId) {
  if (!BACKUP_ID_RE.test(backupId)) {
    throw new Error('Invalid backup id');
  }
  const src = path.join(getBackupsDir(), backupId);
  try {
    await fs.access(src);
  } catch {
    throw new Error('Backup not found');
  }

  const memoryDir = getMemoryDir();
  const preRestore = `${memoryDir}.pre-restore-${backupIdNow()}`;
  try {
    await fs.access(memoryDir);
    await fs.rename(memoryDir, preRestore);
  } catch {
    /* no existing memory */
  }

  await copyDir(src, memoryDir);
  const { loadAllEntriesWithBodies } = await import('./store.js');
  const entries = await loadAllEntriesWithBodies();
  return { restored: entries.length };
}
