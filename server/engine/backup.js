/**
 * Root backup and restore under injected backupsDir.
 */

import fs from 'node:fs/promises';
import path from 'node:path';

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

/**
 * @typedef {{ rootDir: string, vectorsPath: string, proposalsPath: string, backupsDir: string }} EnginePaths
 */

/**
 * Create path-parameterized backup/restore API.
 * @param {() => EnginePaths} getPaths
 * @param {{ ensureLayout: () => Promise<void>, countRestoredEntries: () => Promise<number> }} deps
 */
export function createBackup(getPaths, deps) {
  /** Copy rootDir tree to backups/memory-<iso>/ */
  async function backupMemory() {
    await deps.ensureLayout();
    const { rootDir, backupsDir } = getPaths();
    const backupId = backupIdNow();
    const dest = path.join(backupsDir, backupId);
    await fs.mkdir(backupsDir, { recursive: true });
    await copyDir(rootDir, dest);
    return { backupId, path: dest };
  }

  /** Restore rootDir from a named backup folder. */
  async function restoreMemory(backupId) {
    if (!BACKUP_ID_RE.test(backupId)) {
      throw new Error('Invalid backup id');
    }
    const { rootDir, backupsDir } = getPaths();
    const src = path.join(backupsDir, backupId);
    try {
      await fs.access(src);
    } catch {
      throw new Error('Backup not found');
    }

    const preRestore = `${rootDir}.pre-restore-${backupIdNow()}`;
    try {
      await fs.access(rootDir);
      await fs.rename(rootDir, preRestore);
    } catch {
      /* no existing root */
    }

    await copyDir(src, rootDir);
    const restored = await deps.countRestoredEntries();
    return { restored };
  }

  return { backupMemory, restoreMemory };
}
