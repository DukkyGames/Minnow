/**
 * Offline pack index loader for Skills Library browse routes (MIN-475).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getSkillsLibraryPack } from '../../../src/skills/library/registry.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const INDEX_DIR = path.join(PROJECT_ROOT, 'src/skills/library/index');

/**
 * @param {string} packId
 * @returns {Promise<import('../../../src/skills/library/registry.ts').SkillsLibraryPackIndex>}
 */
export async function loadShippedPackIndex(packId) {
  if (!getSkillsLibraryPack(packId)) {
    throw new Error(`Unknown pack id: ${packId}`);
  }

  const indexPath = path.join(INDEX_DIR, `${packId}.json`);
  const raw = await fs.readFile(indexPath, 'utf8');
  const parsed = JSON.parse(raw);

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.skills)) {
    throw new Error(`Invalid index file for pack ${packId}`);
  }

  return parsed;
}

/**
 * @returns {Promise<import('../../../src/skills/library/registry.ts').SkillsLibraryPackIndex[]>}
 */
export async function loadAllShippedPackIndexes() {
  const { SKILLS_LIBRARY_PACKS } = await import('../../../src/skills/library/registry.mjs');
  const indexes = [];
  for (const pack of SKILLS_LIBRARY_PACKS) {
    indexes.push(await loadShippedPackIndex(pack.id));
  }
  return indexes;
}

/**
 * @param {string} query
 * @returns {Promise<Array<{ packId: string, skill: import('../../../src/skills/library/registry.ts').SkillsLibraryIndexSkill }>>}
 */
export async function searchShippedIndexes(query) {
  const q = query.trim().toLowerCase();
  if (!q) {
    return [];
  }

  const indexes = await loadAllShippedPackIndexes();
  /** @type {Array<{ packId: string, skill: import('../../../src/skills/library/registry.ts').SkillsLibraryIndexSkill }>} */
  const results = [];

  for (const index of indexes) {
    for (const skill of index.skills) {
      const haystack = `${skill.skillId} ${skill.label} ${skill.description}`.toLowerCase();
      if (haystack.includes(q)) {
        results.push({ packId: index.packId, skill });
      }
    }
  }

  return results;
}
