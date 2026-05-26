/**
 * Settings page section ids and sidebar groups (shared without loading settings-page bundle).
 */

export type SettingsSectionId =
  | 'general'
  | 'providers'
  | 'usage'
  | 'model-routing'
  | 'prompting'
  | 'rules'
  | 'memory'
  | 'modes'
  | 'experts'
  | 'work-agents'
  | 'agent-packs'
  | 'sub-agents'
  | 'tools'
  | 'mcp'
  | 'lsp'
  | 'skills'
  | 'features'
  | 'evals';

/** Sidebar label (hash id stays stable for bookmarks). */
export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  general: 'General',
  providers: 'Providers',
  usage: 'Usage & cost',
  'model-routing': 'Model routing',
  prompting: 'Prompting',
  rules: 'Rules',
  memory: 'Memory',
  modes: 'Modes',
  experts: 'Experts',
  'work-agents': 'Work agents',
  'agent-packs': 'Agent packs',
  'sub-agents': 'Sub-agents',
  tools: 'Tools',
  mcp: 'MCP servers',
  lsp: 'Language servers',
  skills: 'Skills',
  features: 'Orchestration',
  evals: 'Evals',
};

export type SettingsNavGroupId =
  | 'app'
  | 'models'
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
  { id: 'app', label: 'App', sections: ['general'] },
  {
    id: 'models',
    label: 'Models & APIs',
    sections: ['providers', 'usage', 'model-routing'],
  },
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
    sections: ['tools', 'mcp', 'lsp', 'skills'],
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
