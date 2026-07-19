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
  | 'notifications'
  | 'appearance'
  | 'audio'
  | 'providers'
  | 'usage'
  | 'model-routing'
  | 'sampler'
  | 'thinking'
  | 'agent-center'
  | 'prompting'
  | 'rules'
  | 'modes'
  | 'work-agents'
  | 'agent-packs'
  | 'sub-agents'
  | 'autopilot'
  | 'search'
  | 'deep-research'
  | 'servers'
  | 'tools'
  | 'mcp'
  | 'lsp'
  | 'editor'
  | 'skills'
  | 'webhooks'
  | 'features'
  | 'evals'
  | 'diagnostics'
  | 'about';

/** Sidebar label (hash id stays stable for bookmarks). */
export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  general: 'General',
  notifications: 'Notifications',
  appearance: 'Appearance',
  audio: 'Audio',
  providers: 'Providers',
  usage: 'Usage & cost',
  'model-routing': 'Routing',
  sampler: 'Sampler',
  thinking: 'Thinking',
  'agent-center': 'Agents',
  prompting: 'Prompts',
  rules: 'Rules',
  modes: 'Modes',
  'work-agents': 'Work agents',
  'agent-packs': 'Agent packs',
  'sub-agents': 'Sub-agents',
  autopilot: 'Autopilot',
  search: 'Search',
  'deep-research': 'Deep Research',
  servers: 'Servers',
  tools: 'Tools',
  mcp: 'MCP servers',
  lsp: 'Language servers',
  editor: 'Editor',
  skills: 'Skills',
  webhooks: 'Webhooks',
  features: 'Orchestration',
  evals: 'Evals',
  diagnostics: 'Health & diagnostics',
  about: 'About',
};

export type SettingsNavGroupId =
  | 'app'
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
  { id: 'app', label: 'App', sections: ['general', 'notifications', 'appearance', 'audio', 'about'] },
  {
    id: 'agents',
    label: 'Agents',
    sections: [
      'agent-center',
      'rules',
      'agent-packs',
      'autopilot',
    ],
  },
  {
    id: 'integrations',
    label: 'Tools & integrations',
    sections: ['search', 'deep-research', 'servers', 'tools', 'mcp', 'lsp', 'editor', 'skills', 'webhooks'],
  },
  {
    id: 'advanced',
    label: 'Advanced',
    sections: ['features', 'diagnostics', 'evals'],
  },
];

/** Flat nav order for hash routing and panel wiring. */
export const SETTINGS_SECTIONS: SettingsSectionId[] =
  SETTINGS_NAV_GROUPS.flatMap((group) => group.sections);

/** Integrations hub groupings (6 subnav tabs instead of 10 area tabs). */
export const SETTINGS_INTEGRATIONS_HUBS = [
  {
    id: 'web-research',
    label: 'Search',
    areas: ['search'],
  },
  {
    id: 'deep-research',
    label: 'Deep Research',
    areas: ['deep-research'],
  },
  {
    id: 'servers',
    label: 'Servers',
    areas: ['servers'],
  },
  {
    id: 'tools-skills',
    label: 'Tools & skills',
    areas: ['tools', 'skills'],
  },
  {
    id: 'dev-stack',
    label: 'Dev stack',
    areas: ['mcp', 'lsp', 'editor'],
  },
  {
    id: 'external',
    label: 'External',
    areas: ['webhooks'],
  },
] as const;

export type SettingsIntegrationsHubId =
  (typeof SETTINGS_INTEGRATIONS_HUBS)[number]['id'];

/** Map a legacy integration area slug to its hub id. */
export function hubForArea(area: SettingsSectionId): SettingsIntegrationsHubId | undefined {
  for (const hub of SETTINGS_INTEGRATIONS_HUBS) {
    if ((hub.areas as readonly SettingsSectionId[]).includes(area)) {
      return hub.id;
    }
  }
  return undefined;
}
