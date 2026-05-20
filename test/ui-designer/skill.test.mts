/**
 * UI Designer skill file (Step 15).
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, test } from 'node:test';
import { parseSkillFrontmatter } from '../../src/skills/parse-frontmatter.ts';
import { formatImpeccablePreflightLine } from '../../src/agents/ui-designer/preflight.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.join(
  __dirname,
  '../../src/skills/ui-designer/SKILL.md',
);

describe('ui-designer skill', () => {
  test('U6: skill loader finds ui-designer with impeccable reference', async () => {
    const raw = await fs.readFile(SKILL_PATH, 'utf8');
    const { meta, body } = parseSkillFrontmatter(raw);
    assert.equal(meta.name, 'ui-designer');
    assert.equal(meta.label, 'UI Designer');
    assert.match(body, /impeccable/i);
    assert.match(body, /IMPECCABLE_PREFLIGHT/);
  });

  test('I4: slash inject builds system message containing IMPECCABLE_PREFLIGHT instruction', async () => {
    const raw = await fs.readFile(SKILL_PATH, 'utf8');
    const { body } = parseSkillFrontmatter(raw);
    const preflightLine = formatImpeccablePreflightLine(
      { mutation: 'closed', imageGate: 'skipped:plan_mode' },
      'plan',
    );
    const merged = `${body.trim()}\n\n${preflightLine}`;
    assert.match(merged, /IMPECCABLE_PREFLIGHT/);
    assert.match(merged, /mutation=closed/);
  });
});
