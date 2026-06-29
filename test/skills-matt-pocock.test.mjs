/**
 * Matt Pocock productivity + engineering built-in skills (vendored).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { getSkillById, listMergedSkills } from '../server/skills/scan.js';
import { parseSkillFrontmatter } from '../server/skills/parse-frontmatter.js';
import { applyMinnowTextPatches } from '../scripts/matt-pocock-preserves/apply-minnow-patches.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SKILLS_ROOT = path.join(PROJECT_ROOT, 'src/skills');
const LOCK_FILE = path.join(PROJECT_ROOT, 'skills-lock.json');
const CATALOG_FILE = path.join(
  PROJECT_ROOT,
  'scripts/matt-pocock-preserves/skill-catalog.json',
);

const MATT_POCOCK_IDS = [
  'grill-me',
  'grilling',
  'handoff',
  'teach',
  'writing-great-skills',
  'ask-minnow',
  'codebase-design',
  'diagnosing-bugs',
  'domain-modeling',
  'grill-with-docs',
  'implement',
  'improve-codebase-architecture',
  'prototype',
  'resolving-merge-conflicts',
  'setup-minnow-skills',
  'tdd',
  'to-issues',
  'to-prd',
  'triage',
];

/**
 * @param {string} dir
 * @param {(relPath: string, content: string) => void} onFile
 */
function walkVendoredTextFiles(dir, onFile) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) {
      walkVendoredTextFiles(full, onFile);
      continue;
    }
    if (name === 'SKILL.upstream.md') continue;
    const rel = path.relative(SKILLS_ROOT, full).replace(/\\/g, '/');
    const ext = path.extname(name).toLowerCase();
    if (!['.md', '.sh', '.mjs', '.js', '.ts', '.json', '.txt', '.yaml', '.yml'].includes(ext)) {
      continue;
    }
    onFile(rel, fs.readFileSync(full, 'utf8'));
  }
}

describe('Matt Pocock built-in skills', () => {
  it('all 19 skill directories exist with valid SKILL.md front matter', () => {
    for (const id of MATT_POCOCK_IDS) {
      const skillMd = path.join(SKILLS_ROOT, id, 'SKILL.md');
      assert.equal(fs.existsSync(skillMd), true, `missing ${id}/SKILL.md`);
      const { meta } = parseSkillFrontmatter(fs.readFileSync(skillMd, 'utf8'));
      assert.equal(meta.name.trim(), id, `name mismatch for ${id}`);
      assert.ok(meta.description?.trim(), `description required for ${id}`);
    }
  });

  it('renamed ids exist and upstream folder names do not', () => {
    assert.equal(fs.existsSync(path.join(SKILLS_ROOT, 'ask-minnow', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(SKILLS_ROOT, 'ask-matt')), false);
    assert.equal(fs.existsSync(path.join(SKILLS_ROOT, 'setup-minnow-skills', 'SKILL.md')), true);
    assert.equal(fs.existsSync(path.join(SKILLS_ROOT, 'setup-matt-pocock-skills')), false);
  });

  it('setup-minnow-skills ships seed templates', () => {
    const setupDir = path.join(SKILLS_ROOT, 'setup-minnow-skills');
    for (const file of [
      'domain.md',
      'issue-tracker-github.md',
      'triage-labels.md',
    ]) {
      assert.equal(fs.existsSync(path.join(setupDir, file)), true, `missing ${file}`);
    }
  });

  it('supplementary reference files are vendored', () => {
    assert.equal(
      fs.existsSync(path.join(SKILLS_ROOT, 'triage', 'AGENT-BRIEF.md')),
      true,
    );
    assert.equal(fs.existsSync(path.join(SKILLS_ROOT, 'tdd', 'tests.md')), true);
  });

  it('listMergedSkills returns Matt Pocock ids', async () => {
    const skills = await listMergedSkills(PROJECT_ROOT);
    for (const id of MATT_POCOCK_IDS) {
      const row = skills.find((s) => s.id === id);
      assert.ok(row, `missing ${id} in merged catalog`);
      assert.equal(row.source, 'builtin');
    }
  });

  it('implement references /code-review not /review', () => {
    const body = fs.readFileSync(path.join(SKILLS_ROOT, 'implement', 'SKILL.md'), 'utf8');
    assert.match(body, /\/code-review/);
    assert.equal(/\b\/review\b/.test(body), false);
  });

  it('ask-minnow replaces Cursor /compact guidance', () => {
    const body = fs.readFileSync(path.join(SKILLS_ROOT, 'ask-minnow', 'SKILL.md'), 'utf8');
    assert.match(body, /Minnow has no `\/compact` command/);
    assert.equal(body.includes('`/compact` (built-in)'), false);
  });

  it('vendored tree has no stale rename strings outside upstream snapshots', () => {
    /** @type {string[]} */
    const hits = [];
    for (const id of MATT_POCOCK_IDS) {
      const skillDir = path.join(SKILLS_ROOT, id);
      walkVendoredTextFiles(skillDir, (rel, content) => {
        if (content.includes('setup-matt-pocock-skills')) {
          if (!content.includes('skills/engineering/setup-matt-pocock-skills/')) {
            hits.push(`${rel}: setup-matt-pocock-skills`);
          }
        }
        if (/\bask-matt\b/.test(content) && !rel.endsWith('SKILL.upstream.md')) {
          if (!content.includes('skills/engineering/ask-matt/')) {
            hits.push(`${rel}: ask-matt`);
          }
        }
      });
    }
    assert.deepEqual(hits, []);
  });

  it('skills-lock.json records matt-pocock-skills commit SHA', () => {
    const lock = JSON.parse(fs.readFileSync(LOCK_FILE, 'utf8'));
    const entry = lock['matt-pocock-skills'];
    assert.ok(entry, 'missing matt-pocock-skills lock entry');
    assert.match(entry.commitSha, /^[0-9a-f]{40}$/);
    assert.equal(entry.source, 'mattpocock/skills');
    assert.equal(typeof entry.skills, 'object');
    assert.equal(Object.keys(entry.skills).length, MATT_POCOCK_IDS.length);
  });

  it('catalog lists 19 skills matching vendored ids', () => {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    assert.equal(catalog.skills.length, 19);
    const ids = catalog.skills.map((s) => s.id).sort();
    assert.deepEqual(ids, [...MATT_POCOCK_IDS].sort());
  });

  it('loadSkill returns ask-minnow body', async () => {
    const skill = await getSkillById(PROJECT_ROOT, 'ask-minnow');
    assert.ok(skill);
    assert.equal(skill.id, 'ask-minnow');
    assert.match(skill.body, /\/setup-minnow-skills/);
  });

  it('text patches are idempotent', () => {
    const sample =
      'Run /setup-matt-pocock-skills then /review and ask-matt. **`/compact`** (built-in) — stay.';
    const once = applyMinnowTextPatches(sample);
    const twice = applyMinnowTextPatches(once);
    assert.equal(twice, once);
    assert.match(twice, /setup-minnow-skills/);
    assert.match(twice, /\/code-review/);
  });
});
