/**
 * Settings page section ids, categories, and sidebar groups.
 */

import {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_AREAS,
  SETTINGS_CATEGORY_DESCRIPTIONS,
  SETTINGS_CATEGORY_LABELS,
  SETTINGS_FIELD_CATALOG,
  categoryForArea,
  fieldByKey,
  fieldsForArea,
  type SettingsCategoryId,
} from './settings-catalog';

export type { SettingsCategoryId } from './settings-catalog';
export {
  SETTINGS_CATEGORIES,
  SETTINGS_CATEGORY_AREAS,
  SETTINGS_CATEGORY_DESCRIPTIONS,
  SETTINGS_CATEGORY_LABELS,
  SETTINGS_FIELD_CATALOG,
  categoryForArea,
  fieldByKey,
  fieldsForArea,
};

export type SettingsSectionId =
  | 'general'
  | 'appearance'
  | 'audio'
  | 'providers'
  | 'usage'
  | 'model-routing'
  | 'sampler'
  | 'thinking'
  | 'prompting'
  | 'rules'
  | 'memory'
  | 'modes'
  | 'experts'
  | 'work-agents'
  | 'agent-packs'
  | 'sub-agents'
  | 'search'
  | 'deep-research'
  | 'servers'
  | 'tools'
  | 'mcp'
  | 'lsp'
  | 'editor'
  | 'skills'
  | 'webhooks'
  | 'oauth'
  | 'features'
  | 'evals';

/** Sidebar label (hash id stays stable for bookmarks). */
export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  general: 'General',
  appearance: 'Appearance',
  audio: 'Audio',
  providers: 'Providers',
  usage: 'Usage & cost',
  'model-routing': 'Models',
  sampler: 'Sampler',
  thinking: 'Thinking',
  prompting: 'Prompts',
  rules: 'Rules',
  memory: 'Memory',
  modes: 'Modes',
  experts: 'Experts',
  'work-agents': 'Work agents',
  'agent-packs': 'Agent packs',
  'sub-agents': 'Sub-agents',
  search: 'Search',
  'deep-research': 'Deep Research',
  servers: 'Servers',
  tools: 'Tools',
  mcp: 'MCP servers',
  lsp: 'Language servers',
  editor: 'Editor',
  skills: 'Skills',
  webhooks: 'Webhooks',
  oauth: 'OAuth',
  features: 'Orchestration',
  evals: 'Evals',
};

export type SettingsNavGroupId =
  | 'app'
  | 'prompting'
  | 'agents'
  | 'integrations'
  | 'advanced';

export type SettingsNavGroup = {
  id: SettingsNavGroupId;
  label: string;
  sections: SettingsSectionId[];
};

/** Sidebar groups and nav order (must match index.html section order). */
export const SETTINGS_NAV_GROUPS: SettingsNavGroup[] = [
  { id: 'app', label: 'App', sections: ['general', 'appearance', 'audio'] },
  {
    id: 'prompting',
    label: 'Prompting & memory',
    sections: ['prompting', 'rules', 'memory'],
  },
  {
    id: 'agents',
    label: 'Agents',
    sections: [
      'modes',
      'experts',
      'work-agents',
      'agent-packs',
      'sub-agents',
    ],
  },
  {
    id: 'integrations',
    label: 'Tools & integrations',
    sections: ['search', 'deep-research', 'servers', 'tools', 'mcp', 'lsp', 'editor', 'skills', 'webhooks', 'oauth'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    sections: ['features', 'evals'],
  },
];

/** Flat nav order for hash routing and panel wiring. */
export const SETTINGS_SECTIONS: SettingsSectionId[] =
  SETTINGS_NAV_GROUPS.flatMap((group) => group.sections);
