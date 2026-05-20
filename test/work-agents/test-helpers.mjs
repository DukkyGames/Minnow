import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ROOT = path.join(__dirname, '../fixtures/work-agents');

/** Load fixture markdown into glob-style map for registerWorkAgentFilesFromRaw. */
export async function loadWorkAgentFixtureMap() {
  const map = {};
  const registryRaw = await fs.readFile(path.join(FIXTURE_ROOT, 'registry.json'), 'utf8');
  map['./registry.json'] = registryRaw;

  async function walk(dir, prefix = '') {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const rel = prefix ? `${prefix}/${ent.name}` : ent.name;
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(full, rel);
      } else if (ent.name.endsWith('.md')) {
        map[`./work-agents/${rel.replace(/\\/g, '/')}`] = await fs.readFile(full, 'utf8');
      }
    }
  }

  await walk(FIXTURE_ROOT);
  return map;
}

export function fixtureRegistryIndex() {
  return { ids: ['agent-alpha', 'agent-beta', 'agent-gamma'] };
}
