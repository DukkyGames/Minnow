/**
 * Operating mode registry — four primary modes and prompt path helpers.
 */

import { loadPromptById } from '../prompts/prompt-loader';
import type { PromptProfile } from '../prompts/types';
import {
  DEFAULT_MODE_ID,
  MODE_IDS,
  type ModeDefinition,
  type ModeId,
  type ModeToolPolicy,
} from './types';

export { DEFAULT_MODE_ID, MODE_IDS, isModeId, normalizeModeId } from './types';

/** Tools denied in Plan mode (OpenCode Plan–style safety). */
const PLAN_DENIED_TOOLS: string[] = [
  'execute_command',
  'run_javascript',
  'run_python',
  'save_file',
  'append_file',
  'insert_at_line',
  'replace_text_in_file',
  'delete_path',
  'move_file',
  'git_commit',
  'git_add',
  'git_checkout',
];

/** Additional write/mutate tools denied in Research (read-only emphasis). */
const RESEARCH_EXTRA_DENIED_TOOLS: string[] = [
  'make_directory',
  'copy_file',
  'write_clipboard',
];

function denyListToolPolicy(denied: string[]): ModeToolPolicy {
  const tools: Record<string, 'deny'> = {};
  for (const id of denied) {
    tools[id] = 'deny';
  }
  return { default: 'allow', tools };
}

const MODE_DEFINITIONS: ModeDefinition[] = [
  {
    id: 'build',
    label: 'Build',
    description: 'Default development mode with broad tool access.',
    promptId: 'build',
    toolPolicy: { default: 'allow' },
  },
  {
    id: 'plan',
    label: 'Plan',
    description: 'Analyze and plan without destructive edits or shell execution.',
    promptId: 'plan',
    toolPolicy: denyListToolPolicy(PLAN_DENIED_TOOLS),
  },
  {
    id: 'orchestrate',
    label: 'Orchestrate',
    description: 'Coordinate multi-step work; delegate and structure tasks.',
    promptId: 'orchestrate',
    toolPolicy: { default: 'allow' },
  },
  {
    id: 'research',
    label: 'Research',
    description: 'Read, search, and gather information with minimal writes.',
    promptId: 'research',
    toolPolicy: denyListToolPolicy([
      ...PLAN_DENIED_TOOLS,
      ...RESEARCH_EXTRA_DENIED_TOOLS,
    ]),
  },
];

/** Fixed four modes in display order. */
export function listModes(): ModeDefinition[] {
  return [...MODE_DEFINITIONS];
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

