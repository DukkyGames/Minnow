/**
 * Shipped Skills Library index files (MIN-474).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { SKILLS_LIBRARY_PACKS } from '../src/skills/library/registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX_DIR = path.join(__dirname, '../src/skills/library/index');
const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;

describe('Skills Library shipped indexes', () => {
  for (const pack of SKILLS_LIBRARY_PACKS) {
    it(`${pack.id}.json matches registry commit and skill rows`, () => {
      const indexPath = path.join(INDEX_DIR, `${pack.id}.json`);
      assert.equal(fs.existsSync(indexPath), true, `missing ${pack.id}.json — run npm run skills-library:index`);

      const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
      assert.equal(index.packId, pack.id);
      assert.equal(index.commit, pack.source.commit);
      assert.match(index.commit, COMMIT_SHA_RE);
      assert.ok(Array.isArray(index.skills) && index.skills.length > 0);

      for (const skill of index.skills) {
        assert.ok(skill.skillId?.trim(), `${pack.id}: skillId required`);
        assert.ok(skill.label?.trim(), `${pack.id}: label required`);
        assert.ok(skill.description?.trim(), `${pack.id}: description required`);
        assert.ok(skill.subpath?.trim(), `${pack.id}: subpath required`);
        assert.ok(skill.subpath.endsWith(skill.skillId) || skill.subpath.includes('/'), `${pack.id}: subpath looks valid`);
      }
    });
  }
});
