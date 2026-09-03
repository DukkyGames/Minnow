/**
 * Capability matrix group bands (spreadsheet column groups).
 */

import type { CapabilityDefinition, CapabilityGroupId } from './types.ts';

/** Column order on Cloud / LM Studio / Minnow Hosting sheets. */
export const CAPABILITY_GROUP_ORDER: CapabilityGroupId[] = [
  'core-protocol',
  'files',
  'docs',
  'git',
  'code-shell',
  'lsp',
  'web',
  'browser',
  'agents-tasks',
  'knowledge',
  'apps',
  'mode-control',
  'features',
];

/** Spreadsheet band labels (row 1 headers). */
export const CAPABILITY_GROUP_LABELS: Record<CapabilityGroupId, string> = {
  'core-protocol': 'CORE PROTOCOL',
  files: 'FILES',
  docs: 'DOCS',
  git: 'GIT',
  'code-shell': 'CODE & SHELL',
  lsp: 'LSP',
  web: 'WEB',
  browser: 'BROWSER',
  'agents-tasks': 'AGENTS & TASKS',
  knowledge: 'KNOWLEDGE',
  apps: 'APPS',
  'mode-control': 'MODE CONTROL',
  features: 'FEATURES',
};

/** Expected capability count per band (52 total, including agents-issue-tools-v2). */
export const CAPABILITY_GROUP_COUNTS: Record<CapabilityGroupId, number> = {
  'core-protocol': 10,
  files: 6,
  docs: 1,
  git: 2,
  'code-shell': 5,
  lsp: 1,
  web: 3,
  browser: 3,
  'agents-tasks': 5,
  knowledge: 5,
  apps: 1,
  'mode-control': 3,
  features: 7,
};

export function countCapabilitiesInGroup(
  catalog: CapabilityDefinition[],
  groupId: CapabilityGroupId,
): number {
  return catalog.filter((c) => c.group === groupId).length;
}
