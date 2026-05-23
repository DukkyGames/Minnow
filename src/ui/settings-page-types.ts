/**
 * Settings page section ids (shared without loading settings-page bundle).
 */

export type SettingsSectionId =
  | 'general'
  | 'prompting'
  | 'rules'
  | 'providers'
  | 'model-routing'
  | 'modes'
  | 'experts'
  | 'work-agents'
  | 'sub-agents'
  | 'memory'
  | 'features'
  | 'tools'
  | 'mcp'
  | 'lsp'
  | 'skills';

/** Nav order for hash routing and panel wiring (must match index.html). */
export const SETTINGS_SECTIONS: SettingsSectionId[] = [
  'general',
  'prompting',
  'rules',
  'providers',
  'model-routing',
  'modes',
  'experts',
  'work-agents',
  'sub-agents',
  'memory',
  'features',
  'tools',
  'mcp',
  'lsp',
  'skills',
];
