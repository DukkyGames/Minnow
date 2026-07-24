/**
 * Skills Library pack registry structure (MIN-474).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  SKILLS_LIBRARY_PACKS,
  SKILLS_LIBRARY_PACK_IDS,
  getSkillsLibraryPack,
  listSkillsLibraryPacks,
} from '../src/skills/library/registry.ts';

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const EXCLUDED_REPOS = new Set([
  'anthropics/antigravity-skills',
  'aws/agent-toolkit',
]);

describe('Skills Library registry', () => {
  it('exports a curated non-empty pack list', () => {
    assert.ok(SKILLS_LIBRARY_PACKS.length >= 5);
    assert.equal(SKILLS_LIBRARY_PACK_IDS.length, SKILLS_LIBRARY_PACKS.length);
  });

  it('each pack has required fields and a pinned commit', () => {
    const ids = new Set<string>();

    for (const pack of SKILLS_LIBRARY_PACKS) {
      assert.ok(pack.id.trim(), 'pack id required');
      assert.equal(ids.has(pack.id), false, `duplicate pack id: ${pack.id}`);
      ids.add(pack.id);

      assert.ok(pack.label.trim(), `${pack.id}: label required`);
      assert.ok(pack.description.trim(), `${pack.id}: description required`);
      assert.ok(pack.publisher.trim(), `${pack.id}: publisher required`);
      assert.ok(
        pack.trust === 'official' || pack.trust === 'community',
        `${pack.id}: trust must be official or community`,
      );

      assert.ok(pack.source.repo.includes('/'), `${pack.id}: repo must be owner/name`);
      assert.match(pack.source.commit, COMMIT_SHA_RE, `${pack.id}: commit must be pinned SHA`);
      assert.ok(pack.source.skillsGlobs.length > 0, `${pack.id}: skillsGlobs required`);
      assert.ok(
        !EXCLUDED_REPOS.has(pack.source.repo),
        `${pack.id}: excluded large library repo`,
      );
    }
  });

  it('includes Matt Pocock pack with post-install patch hook', () => {
    const matt = getSkillsLibraryPack('matt-pocock');
    assert.ok(matt);
    assert.equal(matt?.source.repo, 'mattpocock/skills');
    assert.equal(matt?.postInstallPatch, 'matt-pocock');
    assert.deepEqual(matt?.source.skillsGlobs, [
      'skills/productivity/**',
      'skills/engineering/**',
    ]);
  });

  it('includes Superpowers from obra/superpowers', () => {
    const superpowers = getSkillsLibraryPack('superpowers');
    assert.ok(superpowers);
    assert.equal(superpowers?.source.repo, 'obra/superpowers');
    assert.deepEqual(superpowers?.source.skillsGlobs, ['skills/**']);
  });

  it('listSkillsLibraryPacks returns a defensive copy', () => {
    const packs = listSkillsLibraryPacks();
    assert.equal(packs.length, SKILLS_LIBRARY_PACKS.length);
    packs.pop();
    assert.equal(listSkillsLibraryPacks().length, SKILLS_LIBRARY_PACKS.length);
  });
});
