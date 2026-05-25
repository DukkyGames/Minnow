/**
 * User eval pack CRUD under ~/.minnow/evals/packs/
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getUserEvalPacksRoot, PACK_ID_RE } from './scan.js';
import { validateEvalPack } from './validate.js';

/**
 * @param {ReturnType<typeof validateEvalPack>} pack
 */
export async function saveUserEvalPack(pack) {
  const validated = validateEvalPack(pack);
  if (!PACK_ID_RE.test(validated.id)) {
    throw new Error('Invalid pack id');
  }
  const dir = path.join(getUserEvalPacksRoot(), validated.id);
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, 'pack.json');
  await fs.writeFile(filePath, `${JSON.stringify(validated, null, 2)}\n`, 'utf8');
  return filePath;
}

/** @param {string} id */
export async function deleteUserEvalPack(id) {
  if (!PACK_ID_RE.test(id) || id.includes('..')) {
    throw new Error('Invalid pack id');
  }
  const dir = path.join(getUserEvalPacksRoot(), id);
  await fs.rm(dir, { recursive: true, force: true });
}
