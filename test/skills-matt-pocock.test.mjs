/**
 * Matt Pocock Skills Library pack — catalog, patches, and install behavior (MIN-476).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { resetMinnowHomeCache } from '../server/config/home.js';
import { listMergedSkills } from '../server/skills/scan.js';
import {
  applyMinnowPatchesToSkillDir,
  applyMinnowTextPatches,
} from '../scripts/matt-pocock-preserves/apply-minnow-patches.mjs';
import { runPostInstallPatch } from '../server/skills/library/post-install.js';

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

describe('Matt Pocock Skills Library pack', () => {
  it('Matt Pocock skill dirs are not bundled under src/skills', () => {
    for (const id of MATT_POCOCK_IDS) {
      assert.equal(
        fs.existsSync(path.join(SKILLS_ROOT, id)),
        false,
        `expected ${id} to be unbundled`,
      );
    }
  });

  it('listMergedSkills does not include Matt Pocock ids as builtins', async () => {
    const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'minnow-matt-pocock-'));
    const savedHome = process.env.MINNOW_HOME;
    try {
      process.env.MINNOW_HOME = tempHome;
      resetMinnowHomeCache();

      const skills = await listMergedSkills(PROJECT_ROOT);
      for (const id of MATT_POCOCK_IDS) {
        const row = skills.find((s) => s.id === id);
        assert.equal(row, undefined, `${id} should not appear until library install`);
      }
    } finally {
      if (savedHome === undefined) {
        delete process.env.MINNOW_HOME;
      } else {
        process.env.MINNOW_HOME = savedHome;
      }
      resetMinnowHomeCache();
      fs.rmSync(tempHome, { recursive: true, force: true });
    }
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

  it('catalog lists 19 skills with Minnow install ids', () => {
    const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
    assert.equal(catalog.skills.length, 19);
    const ids = catalog.skills.map((s) => s.id).sort();
    assert.deepEqual(ids, [...MATT_POCOCK_IDS].sort());
    const askMatt = catalog.skills.find((s) => s.upstreamId === 'ask-matt');
    assert.equal(askMatt?.id, 'ask-minnow');
    const setup = catalog.skills.find((s) => s.upstreamId === 'setup-matt-pocock-skills');
    assert.equal(setup?.id, 'setup-minnow-skills');
  });

  it('text patches rename upstream ids and replace /compact guidance', () => {
    const sample =
      'Run /setup-matt-pocock-skills then /review and ask-matt.\n- **`/compact`** (built-in) — stay between phases.\n';
    const once = applyMinnowTextPatches(sample);
    const twice = applyMinnowTextPatches(once);
    assert.equal(twice, once);
    assert.match(twice, /setup-minnow-skills/);
    assert.match(twice, /\/code-review/);
    assert.match(twice, /ask-minnow/);
    assert.match(twice, /Minnow has no `\/compact` command/);
  });

  it('applyMinnowPatchesToSkillDir patches ask-minnow content', () => {
    const tmpDir = fs.mkdtempSync(path.join(PROJECT_ROOT, '.tmp-ask-minnow-'));
    try {
      const catalog = JSON.parse(fs.readFileSync(CATALOG_FILE, 'utf8'));
      const entry = catalog.skills.find((s) => s.id === 'ask-minnow');
      assert.ok(entry);

      const upstreamBody = `---
name: ask-matt
description: Router skill.
---

# Ask Matt

Use /setup-matt-pocock-skills and ask-matt. Call /review when done.
- **\`/compact\`** (built-in) — use between phases.
`;
      fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), upstreamBody, 'utf8');

      applyMinnowPatchesToSkillDir(tmpDir, entry);
      const patched = fs.readFileSync(path.join(tmpDir, 'SKILL.md'), 'utf8');
      assert.match(patched, /name: ask-minnow/);
      assert.match(patched, /label: Ask Minnow/);
      assert.match(patched, /\/setup-minnow-skills/);
      assert.match(patched, /\/code-review/);
      assert.match(patched, /Minnow has no `\/compact` command/);
      assert.match(patched, /Upstream: https:\/\/github.com\/mattpocock\/skills/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('runPostInstallPatch applies matt-pocock hook by skill id', async () => {
    const tmpDir = fs.mkdtempSync(path.join(PROJECT_ROOT, '.tmp-post-install-'));
    try {
      const upstreamBody = `---
name: implement
description: Ship tracer bullets.
---

Run /review after each slice.
`;
      fs.writeFileSync(path.join(tmpDir, 'SKILL.md'), upstreamBody, 'utf8');

      await runPostInstallPatch('matt-pocock', tmpDir, {
        skillId: 'implement',
        subpath: 'skills/engineering/implement',
      });

      const patched = fs.readFileSync(path.join(tmpDir, 'SKILL.md'), 'utf8');
      assert.match(patched, /\/code-review/);
      assert.equal(/\b\/review\b/.test(patched), false);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
