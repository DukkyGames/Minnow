/**
 * Operating mode registry — seven primary modes and prompt path helpers.
 */

import { loadPromptById } from '../prompts/prompt-loader';
import type { PromptProfile } from '../prompts/types';
import {
  DEFAULT_MODE_ID,
  MODE_IDS,
  type ModeDefinition,
  type ModeId,
} from './types';
import { MODE_ALLOWED_GROUPS, allowGroupsToolPolicy } from './tool-groups';

export { DEFAULT_MODE_ID, MODE_IDS, isModeId, normalizeModeId } from './types';

const MODE_DEFINITIONS: ModeDefinition[] = [
  {
    id: 'general',
    label: 'General',
    description:
      'Everyday Q&A and brainstorming; broad tool access with approval before each run.',
    promptId: 'general',
    toolPolicy: allowGroupsToolPolicy('general', MODE_ALLOWED_GROUPS.general),
  },
  {
    id: 'build',
    label: 'Build',
    description: 'Default development mode with broad tool access.',
    promptId: 'build',
    toolPolicy: allowGroupsToolPolicy('build', MODE_ALLOWED_GROUPS.build),
  },
  {
    id: 'plan',
    label: 'Plan',
    description:
      'Analyze and plan; limited file writes (plan doc only) with shell and read tools.',
    promptId: 'plan',
    toolPolicy: allowGroupsToolPolicy('plan', MODE_ALLOWED_GROUPS.plan),
  },
  {
    id: 'orchestrate',
    label: 'Orchestrate',
    description: 'Coordinate multi-step work; delegate and structure tasks.',
    promptId: 'orchestrate',
    toolPolicy: allowGroupsToolPolicy('orchestrate', MODE_ALLOWED_GROUPS.orchestrate),
  },
  {
    id: 'reef',
    label: 'Reef',
    description: 'Build interactive widgets inline in chat.',
    promptId: 'reef',
    toolPolicy: allowGroupsToolPolicy('reef', MODE_ALLOWED_GROUPS.reef),
  },
  {
    id: 'debug',
    label: 'Debug',
    description:
      'Investigate bugs and root causes; file and triage via All bugs and bug_* tools.',
    promptId: 'debug',
    toolPolicy: allowGroupsToolPolicy('debug', MODE_ALLOWED_GROUPS.debug),
  },
];

/** Fixed six modes in display order (General first). */
export function listModes(): ModeDefinition[] {
  return [...MODE_DEFINITIONS];
}

/** Composer mode strip (excludes Orchestrate and Reef; not shown in Code chat). */
export function listComposerModes(): ModeDefinition[] {
  return MODE_DEFINITIONS.filter((m) => m.id !== 'orchestrate' && m.id !== 'reef');
}

export function getMode(id: ModeId): ModeDefinition {
  const mode = MODE_DEFINITIONS.find((m) => m.id === id);
  if (!mode) {
    throw new Error(`Unknown mode id: ${id}`);
  }
  return mode;
}

/**
 * Logical relative path for built-in mode prompt files (used in tests).
 */
export function resolveModePromptPath(id: ModeId, profile: 'full' | 'lite'): string {
  return `modes/${id}.${profile}.md`;
}

/**
 * Load mode prompt body for compose / tests.
 */
export function loadModePromptBody(id: ModeId, profile: 'full' | 'lite'): string {
  const loadProfile: PromptProfile = profile;
  const loaded = loadPromptById('mode', id, loadProfile);
  return loaded?.body?.trim() ?? '';
}
