/**
 * Slash picker options and composer insertions.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it } from 'node:test';
import { listUiDesignerPickerOptions } from '../../src/agents/ui-designer/runner.ts';
import { getSlashCommandCatalog } from '../../src/chat/slash-commands/registry.ts';
import { listImpeccablePickerOptions } from '../../src/skills/impeccable-client.ts';
import {
  buildSkillPickerInsertion,
  hasSkillPickerOptions,
  listSkillPickerOptions,
} from '../../src/skills/picker-insertion.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(join(__dirname, '../../src/skills/builtin-manifest.json'), 'utf8'),
) as { skills: Array<{ id: string }> };

const SKILLS_WITH_OPTIONS = new Set(['impeccable', 'ui-designer', 'caveman']);

describe('skill picker insertion', () => {
  for (const { id } of manifest.skills) {
    it(`${id} inserts only the slash token without option text`, () => {
      const insertion = buildSkillPickerInsertion(id);
      assert.equal(insertion, `/${id} `);
    });
  }

  it('buildSkillPickerInsertion injects a single chosen option', () => {
    assert.equal(buildSkillPickerInsertion('impeccable', 'polish'), '/impeccable polish ');
    assert.equal(buildSkillPickerInsertion('ui-designer', 'plan'), '/ui-designer plan ');
    assert.equal(buildSkillPickerInsertion('caveman', 'full'), '/caveman full ');
  });

  it('only impeccable, ui-designer, and caveman expose picker options', () => {
    const withOptions = manifest.skills
      .map((skill) => skill.id)
      .filter((id) => hasSkillPickerOptions(id))
      .sort();
    assert.deepEqual(withOptions, [...SKILLS_WITH_OPTIONS].sort());
  });

  it('impeccable options include grouped harness commands', () => {
    const options = listImpeccablePickerOptions();
    assert.ok(options.length >= 20);
    assert.ok(options.some((option) => option.id === 'polish' && option.group === 'Review & refine'));
  });

  it('ui-designer options include plan and implement', () => {
    const options = listUiDesignerPickerOptions();
    assert.deepEqual(
      options.map((option) => option.id),
      ['plan', 'implement'],
    );
  });

  it('caveman options list intensity levels', () => {
    const options = listSkillPickerOptions('caveman');
    assert.ok(options?.some((option) => option.id === 'full'));
    assert.ok(options?.some((option) => option.id === 'ultra'));
  });

  it('slash commands use short fixed insertions', () => {
    for (const command of getSlashCommandCatalog()) {
      assert.ok(command.insertion.startsWith('/'), command.id);
      assert.ok(command.insertion.length <= 32, `${command.id} insertion too long`);
      assert.ok(!command.insertion.includes('—'), `${command.id} should not explain in insertion`);
    }
  });
});
