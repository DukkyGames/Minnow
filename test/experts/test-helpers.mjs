import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function fixtureExpertsDir() {
  return path.join(__dirname, '../fixtures/experts');
}

export async function loadExpertFixtureMap() {
  const root = fixtureExpertsDir();
  const map = {};
  const ids = await fs.readdir(root, { withFileTypes: true });
  for (const dirent of ids) {
    if (!dirent.isDirectory()) continue;
    const fullPath = path.join(root, dirent.name, 'expert.full.md');
    try {
      const raw = await fs.readFile(fullPath, 'utf8');
      map[`./experts/${dirent.name}/expert.full.md`] = raw;
      const litePath = path.join(root, dirent.name, 'expert.lite.md');
      try {
        map[`./experts/${dirent.name}/expert.lite.md`] = await fs.readFile(litePath, 'utf8');
      } catch {
        /* lite optional in fixtures */
      }
    } catch {
      /* skip dirs without full md */
    }
  }
  return map;
}
