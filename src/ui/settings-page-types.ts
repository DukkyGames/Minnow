/**
 * Settings page section ids and sidebar groups (shared without loading settings-page bundle).
 */

export type SettingsSectionId =
  | 'general'
  | 'appearance'
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
  | 'features'
  | 'evals';

/** Sidebar label (hash id stays stable for bookmarks). */
export const SETTINGS_SECTION_LABELS: Record<SettingsSectionId, string> = {
  general: 'General',
  appearance: 'Appearance',
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
  { id: 'app', label: 'App', sections: ['general', 'appearance'] },
  {
    id: 'models',
    label: 'Models & APIs',
    sections: ['model-routing', 'providers', 'usage', 'sampler', 'thinking'],
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
    sections: ['search', 'deep-research', 'servers', 'tools', 'mcp', 'lsp', 'editor', 'skills'],
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
