/**
 * Slash picker options and composer insertions for skills with sub-commands.
 */

import { listUiDesignerPickerOptions } from '../agents/ui-designer/runner';
import { CAVEMAN_INTENSITIES } from './caveman-client';
import { listImpeccablePickerOptions } from './impeccable-client';

export interface SkillPickerOption {
  id: string;
  label: string;
  description?: string;
  group?: string;
}

const CAVEMAN_INTENSITY_DESCRIPTIONS: Readonly<Record<string, string>> = {
  lite: 'Light compression — still readable prose',
  full: 'Default caveman voice',
  ultra: 'Maximum token savings',
  'wenyan-lite': 'Classical Chinese lite',
  'wenyan-full': 'Classical Chinese full',
  'wenyan-ultra': 'Classical Chinese ultra',
};

function listCavemanPickerOptions(): SkillPickerOption[] {
  return CAVEMAN_INTENSITIES.map((id) => ({
    id,
    label: id,
    description: CAVEMAN_INTENSITY_DESCRIPTIONS[id],
    group: 'Intensity',
  }));
}

/** Skills that open a second picker step before inserting into the composer. */
export function listSkillPickerOptions(skillId: string): SkillPickerOption[] | null {
  switch (skillId) {
    case 'impeccable':
      return listImpeccablePickerOptions();
    case 'ui-designer':
      return listUiDesignerPickerOptions();
    case 'caveman':
      return listCavemanPickerOptions();
    default:
      return null;
  }
}

export function hasSkillPickerOptions(skillId: string): boolean {
  return (listSkillPickerOptions(skillId)?.length ?? 0) > 0;
}

/** Full composer insertion after a skill (and optional sub-choice) is confirmed. */
export function buildSkillPickerInsertion(skillId: string, optionId?: string): string {
  const option = optionId?.trim();
  return option ? `/${skillId} ${option} ` : `/${skillId} `;
}
