/**
 * Step 14 — Impeccable built-in skill (deterministic, static assertions).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { getSkillById, listMergedSkills } from '../server/skills/scan.js';
import { readImpeccableReference } from '../server/impeccable/reference-handler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const SKILL_MD = path.join(PROJECT_ROOT, 'src/skills/impeccable/SKILL.md');
const FORBIDDEN_OKLCH = 'oklch(88.769% 0.2563 138.508';

describe('Impeccable built-in (Step 14)', () => {
  it('skill directory and SKILL.md exist', () => {
    assert.equal(fs.existsSync(SKILL_MD), true);
    assert.equal(fs.statSync(SKILL_MD).isFile(), true);
  });

  it('front matter name is impeccable', () => {
    const raw = fs.readFileSync(SKILL_MD, 'utf8');
    assert.match(raw, /^name:\s*impeccable\s*$/m);
  });

  it('context files exist at repo root', () => {
    assert.equal(fs.existsSync(path.join(PROJECT_ROOT, 'PRODUCT.md')), true);
    assert.equal(fs.existsSync(path.join(PROJECT_ROOT, 'DESIGN.md')), true);
    assert.equal(
      fs.existsSync(path.join(PROJECT_ROOT, '.impeccable', 'design.json')),
      true,
    );
  });

  it('design.json schemaVersion is 2', () => {
    const design = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, '.impeccable', 'design.json'), 'utf8'),
    );
    assert.equal(design.schemaVersion, 2);
  });

  it('SKILL.md references context files without duplicating OKLCH tokens', () => {
    const body = fs.readFileSync(SKILL_MD, 'utf8');
    assert.match(body, /PRODUCT\.md/);
    assert.match(body, /DESIGN\.md/);
    assert.match(body, /\.impeccable\/design\.json/);
    assert.equal(body.includes(FORBIDDEN_OKLCH), false);
  });

  it('synced reference and scripts directories exist', () => {
    assert.equal(
      fs.existsSync(path.join(PROJECT_ROOT, 'src/skills/impeccable/reference/init.md')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(PROJECT_ROOT, 'src/skills/impeccable/reference/audit.md')),
      true,
    );
    assert.equal(
      fs.existsSync(path.join(PROJECT_ROOT, 'src/skills/impeccable/scripts/load-context.mjs')),
      true,
    );
  });

  it('loader lists impeccable in merged skills', async () => {
    const skills = await listMergedSkills(PROJECT_ROOT);
    const impeccable = skills.find((s) => s.id === 'impeccable');
    assert.ok(impeccable);
    assert.equal(impeccable.source, 'builtin');
    assert.match(impeccable.description, /DESIGN\.md|design/i);
  });

  it('loadSkill body includes context pointers', async () => {
    const skill = await getSkillById(PROJECT_ROOT, 'impeccable');
    assert.ok(skill);
    assert.equal(skill.id, 'impeccable');
    assert.ok(skill.body.length > 500);
    assert.match(skill.body, /PRODUCT\.md|load-context|minnow-context/);
  });

  it('minnow-context.mjs exits 0 with designJson', () => {
    const result = spawnSync(
      process.execPath,
      ['src/skills/impeccable/scripts/minnow-context.mjs'],
      { cwd: PROJECT_ROOT, encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(typeof payload.contextDir, 'string');
    assert.equal(payload.hasProduct, true);
    assert.equal(typeof payload.product, 'string');
    assert.equal(payload.hasDesign, true);
    assert.equal(typeof payload.design, 'string');
    assert.equal(payload.hasDesignJson, true);
    assert.equal(payload.designJson.schemaVersion, 2);
    assert.equal(payload.workspaceRoot, PROJECT_ROOT);
  });

  it('minnow-context.mjs soft success without .impeccable/design.json', () => {
    const partialFixture = path.join(
      PROJECT_ROOT,
      'test/fixtures/impeccable-workspace-partial',
    );
    const result = spawnSync(
      process.execPath,
      ['src/skills/impeccable/scripts/minnow-context.mjs'],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: { ...process.env, IMPECCABLE_CONTEXT_DIR: partialFixture },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.hasProduct, true);
    assert.equal(payload.hasDesign, true);
    assert.equal(payload.hasDesignJson, false);
    assert.equal(payload.designJson, null);
    assert.match(payload.designJsonSetupHint, /\/impeccable document/);
  });

  it('minnow-context.mjs honors IMPECCABLE_CONTEXT_DIR', () => {
    const result = spawnSync(
      process.execPath,
      ['src/skills/impeccable/scripts/minnow-context.mjs'],
      {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
        env: { ...process.env, IMPECCABLE_CONTEXT_DIR: PROJECT_ROOT },
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const payload = JSON.parse(result.stdout);
    assert.equal(path.resolve(payload.workspaceRoot), PROJECT_ROOT);
  });

  it('reference API resolves teach alias to init.md', () => {
    const payload = readImpeccableReference(PROJECT_ROOT, 'teach');
    assert.ok(payload);
    assert.equal(payload.command, 'init');
    assert.match(payload.content, /PRODUCT\.md/);
    assert.match(payload.content, /# Init Flow/i);
  });

  it('harness reference files have no unpatched {{template}} tokens', () => {
    const refDir = path.join(PROJECT_ROOT, 'src/skills/impeccable/reference');
    const harnessNames = [
      'init', 'craft', 'shape', 'document', 'extract', 'critique', 'audit',
      'polish', 'bolder', 'quieter', 'distill', 'harden', 'onboard', 'live',
      'animate', 'colorize', 'typeset', 'layout', 'delight', 'overdrive',
      'clarify', 'adapt', 'optimize',
    ];
    const tokenRe = /\{\{[^}]+\}\}/;
    for (const name of harnessNames) {
      const filePath = path.join(refDir, `${name}.md`);
      assert.equal(fs.existsSync(filePath), true, `${name}.md missing`);
      const withoutJsxStyle = fs
        .readFileSync(filePath, 'utf8')
        .replace(/style=\{\{[^}]*\}\}/g, '');
      assert.equal(
        tokenRe.test(withoutJsxStyle),
        false,
        `${name}.md still has {{template}} tokens`,
      );
    }
  });

  it('reference API rejects unknown command', () => {
    assert.equal(readImpeccableReference(PROJECT_ROOT, 'not-a-real-command'), null);
  });

  it('sync script is idempotent', () => {
    const run = () =>
      spawnSync(process.execPath, ['scripts/sync-impeccable-skill.mjs'], {
        cwd: PROJECT_ROOT,
        encoding: 'utf8',
      });
    const first = run();
    const second = run();
    assert.equal(first.status, 0, first.stderr || first.stdout);
    assert.equal(second.status, 0, second.stderr || second.stdout);
  });
});
