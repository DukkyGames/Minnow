/**
 * Merged slash picker rows: SKILL.md skills + built-in slash commands.
 */

import { filterSlashCommands, type SlashCommandListItem } from './registry';
import { getSkillCatalog } from '../../skills/client';
import type { SkillListItem } from '../../skills/types';

export type SlashPickerKind = 'skill' | 'command';

export interface SlashPickerSkillRow {
  kind: 'skill';
  skill: SkillListItem;
}

export interface SlashPickerCommandRow {
  kind: 'command';
  command: SlashCommandListItem;
}

export type SlashPickerRow = SlashPickerSkillRow | SlashPickerCommandRow;

function comparePickerRows(a: SlashPickerRow, b: SlashPickerRow): number {
  const labelA = a.kind === 'skill' ? a.skill.label : a.command.label;
  const labelB = b.kind === 'skill' ? b.skill.label : b.command.label;
  return labelA.localeCompare(labelB, undefined, { sensitivity: 'base' });
}

/** Skills + slash commands filtered by the token typed after `/`. */
export function listSlashPickerRows(query: string): SlashPickerRow[] {
  const skillIds = new Set(getSkillCatalog().map((skill) => skill.id));
  const commands = filterSlashCommands(query).filter((command) => {
    const token = command.insertion.replace(/^\//, '').split(/\s+/)[0]?.toLowerCase();
    return !token || !skillIds.has(token);
  });

  const q = query.toLowerCase();
  const skills = getSkillCatalog().filter(
    (skill) =>
      !q ||
      skill.id.toLowerCase().includes(q) ||
      skill.label.toLowerCase().includes(q) ||
      skill.description.toLowerCase().includes(q),
  );

  const rows: SlashPickerRow[] = [
    ...commands.map((command) => ({ kind: 'command' as const, command })),
    ...skills.map((skill) => ({ kind: 'skill' as const, skill })),
  ];

  rows.sort(comparePickerRows);
  return rows;
}
