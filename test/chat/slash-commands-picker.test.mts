import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  filterSlashCommands,
  getSlashCommandCatalog,
} from '../../src/chat/slash-commands/registry.ts';
import { listSlashPickerRows } from '../../src/chat/slash-commands/picker-catalog.ts';
import { refreshSkillCatalog } from '../../src/skills/client.ts';

describe('slash command registry', () => {
  test('includes goal commands', () => {
    const ids = getSlashCommandCatalog().map((command) => command.id);
    assert.ok(ids.includes('goal'));
    assert.ok(ids.includes('goal-clear'));
  });

  test('filterSlashCommands matches partial token', () => {
    const matches = filterSlashCommands('go');
    assert.ok(matches.some((command) => command.id === 'goal'));
  });
});

describe('slash picker catalog', () => {
  test('merges commands with skills without duplicate skill ids', async () => {
    await refreshSkillCatalog();
    const rows = listSlashPickerRows('');
    assert.ok(rows.some((row) => row.kind === 'command' && row.command.id === 'goal'));
    assert.ok(rows.some((row) => row.kind === 'skill'));
    const goalSkill = rows.find(
      (row) => row.kind === 'skill' && row.skill.id === 'goal',
    );
    assert.equal(goalSkill, undefined);
  });

  test('filters commands by query', () => {
    const rows = listSlashPickerRows('goal');
    assert.ok(rows.some((row) => row.kind === 'command' && row.command.id === 'goal'));
    assert.ok(rows.some((row) => row.kind === 'command' && row.command.id === 'goal-clear'));
  });
});
