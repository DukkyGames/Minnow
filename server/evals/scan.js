/**
 * Scan built-in and user eval packs.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { validateEvalPack } from './validate.js';

export const PACK_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * @param {string} projectRoot
 */
export function getBuiltinEvalPacksRoot(projectRoot) {
  return path.join(projectRoot, 'src', 'evals', 'packs');
}

export function getUserEvalPacksRoot() {
  return path.join(getMinnowHome(), 'evals', 'packs');
}

/**
 * @param {string} rootDir
 * @param {'builtin' | 'user'} source
 */
export async function scanEvalPackDir(rootDir, source) {
  /** @type {Array<{ id: string, label: string, version: number, taskCount: number, source: string }>} */
  const items = [];
  /** @type {Array<ReturnType<typeof validateEvalPack> & { source: string }>} */
  const packs = [];

  let entries;
  try {
    entries = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return { items, packs };
    }
    return { items, packs };
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!PACK_ID_RE.test(entry.name)) continue;
    const packPath = path.join(rootDir, entry.name, 'pack.json');
    let raw;
    try {
      raw = JSON.parse(await fs.readFile(packPath, 'utf8'));
    } catch {
      continue;
    }
    try {
      const pack = validateEvalPack(raw);
      if (pack.id !== entry.name) continue;
      const withSource = { ...pack, source };
      packs.push(withSource);
      items.push({
        id: pack.id,
        label: pack.label,
        version: pack.version,
        taskCount: pack.tasks.length,
        source,
      });
    } catch {
      continue;
    }
  }

  return { items, packs };
}

/**
 * @param {string} projectRoot
 */
export async function listMergedEvalPacks(projectRoot) {
  const builtin = await scanEvalPackDir(getBuiltinEvalPacksRoot(projectRoot), 'builtin');
  const user = await scanEvalPackDir(getUserEvalPacksRoot(), 'user');
  const byId = new Map();
  for (const item of builtin.items) byId.set(item.id, item);
  for (const item of user.items) byId.set(item.id, item);
  const packs = [...byId.values()].sort((a, b) =>
    a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }),
  );
  return packs;
}

/**
 * @param {string} projectRoot
 * @param {string} id
 */
export async function getEvalPackById(projectRoot, id) {
  if (!PACK_ID_RE.test(id) || id.includes('..')) return null;
  const userPath = path.join(getUserEvalPacksRoot(), id, 'pack.json');
  try {
    const raw = JSON.parse(await fs.readFile(userPath, 'utf8'));
    const pack = validateEvalPack(raw);
    return { ...pack, source: 'user' };
  } catch {
    /* fall through */
  }
  const builtinPath = path.join(getBuiltinEvalPacksRoot(projectRoot), id, 'pack.json');
  try {
    const raw = JSON.parse(await fs.readFile(builtinPath, 'utf8'));
    const pack = validateEvalPack(raw);
    return { ...pack, source: 'builtin' };
  } catch {
    return null;
  }
}
