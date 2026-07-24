/**
 * Post-install patch hooks for Skills Library installs (MIN-475 stub, MIN-476 full).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMinnowPatchesToSkillDir } from '../../../scripts/matt-pocock-preserves/apply-minnow-patches.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../../..');
const MATT_POCOCK_CATALOG_FILE = path.join(
  PROJECT_ROOT,
  'scripts/matt-pocock-preserves/skill-catalog.json',
);

/** @type {Promise<Array<{ id: string, category: string, upstreamId: string }>> | null} */
let mattPocockCatalogPromise = null;

/**
 * @returns {Promise<Array<{ id: string, category: string, upstreamId: string }>>}
 */
async function loadMattPocockCatalog() {
  if (!mattPocockCatalogPromise) {
    mattPocockCatalogPromise = fs
      .readFile(MATT_POCOCK_CATALOG_FILE, 'utf8')
      .then((raw) => {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.skills) ? parsed.skills : [];
      });
  }
  return mattPocockCatalogPromise;
}

/**
 * @param {string} patchId
 * @param {string} skillDir
 * @param {{ skillId: string, subpath: string }} context
 */
export async function runPostInstallPatch(patchId, skillDir, context) {
  if (patchId !== 'matt-pocock') {
    return;
  }

  const catalog = await loadMattPocockCatalog();
  const entry =
    catalog.find((row) => row.id === context.skillId) ??
    catalog.find((row) => `skills/${row.category}/${row.upstreamId}` === context.subpath);

  if (!entry) {
    return;
  }

  applyMinnowPatchesToSkillDir(skillDir, entry);
}
