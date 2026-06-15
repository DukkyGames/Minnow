/**
 * Registry-driven settings search index (no live DOM scan).
 */

import DEFAULT_SUB_AGENTS from '../agents/defaults/sub-agents.json';
import { listWorkAgents } from '../agents/work-agent-registry';
import { listExperts } from '../chat/experts/registry';
import { listModes } from '../chat/modes/registry';
import {
  BUILT_IN_TOOLS,
  type ToolCategory,
} from '../tools/definitions';
import {
  SETTINGS_NAV_GROUPS,
  SETTINGS_SECTION_LABELS,
  SETTINGS_SECTIONS,
  type SettingsSectionId,
} from './settings-page-types';
import type { SettingsSearchEntry } from './settings-search-types';

const TOOL_CATEGORY_LABELS: Record<ToolCategory, string> = {
  web: 'Web',
  utility: 'Utility',
  browser: 'Built-in browser',
  agents: 'Sub-agents',
  files: 'Files',
  git: 'Git',
  code: 'Code',
  lsp: 'LSP',
};

/** Extra keywords and section overrides for common aliases. */
const SECTION_SEARCH_ALIASES: Partial<
  Record<SettingsSectionId, string[]>
> = {
  general: ['notifications', 'bell', 'sound', 'alert', 'background chat'],
  features: ['orchestration', 'orchestrate', 'orchestrator', 'hub', 'board'],
  prompting: ['prompts', 'prompt', 'profile', 'system prompt'],
  rules: ['user rules', 'cursor rules', 'rule'],
  memory: ['memories', 'recall'],
  'model-routing': ['models', 'routing', 'bindings'],
  providers: ['api', 'lm studio', 'openai'],
  search: ['web search', 'brave', 'tavily', 'searxng', 'duckduckgo', 'ddg'],
  'deep-research': ['research', 'iterresearch', 'deep research', 'engine'],
  servers: ['searxng', 'managed server', 'local search', 'metasearch', 'install searxng'],
  tools: ['permissions', 'tool cache'],
  'sub-agents': ['subagent', 'sub agent', 'spawn'],
  'work-agents': ['work agent', 'worker'],
  mcp: ['model context protocol'],
  webhooks: ['outgoing webhook', 'hmac', 'automation', 'signed events'],
  lsp: ['language server', 'typescript server'],
  audio: ['microphone', 'speaker', 'devices', 'dictation', 'echo', 'gain'],
};

/** Voice I/O keywords route to Models → Voice (not a settings section). */
const MODELS_VOICE_SEARCH: SettingsSearchEntry = {
  id: 'models:voice',
  label: 'Voice',
  sectionId: 'audio',
  kind: 'models-section',
  modelsSection: 'voice',
  keywords: [
    'voice',
    'speech',
    'stt',
    'tts',
    'read aloud',
    'dictation',
    'whisper',
    'qwen',
    'text to speech',
    'speech to text',
    'models voice',
  ],
  hint: 'Models app',
};

function sectionEntry(sectionId: SettingsSectionId): SettingsSearchEntry {
  const label = SETTINGS_SECTION_LABELS[sectionId];
  return {
    id: `section:${sectionId}`,
    label,
    sectionId,
    kind: 'section',
    keywords: [
      sectionId,
      label.toLowerCase(),
      ...(SECTION_SEARCH_ALIASES[sectionId] ?? []),
    ],
    hint: 'Section',
  };
}

function navGroupEntries(): SettingsSearchEntry[] {
  return SETTINGS_NAV_GROUPS.map((group) => ({
    id: `nav-group:${group.id}`,
    label: group.label,
    sectionId: group.sections[0]!,
    kind: 'nav-group' as const,
    keywords: [
      group.id,
      group.label.toLowerCase(),
      ...group.sections,
      ...group.sections.map((s) => SETTINGS_SECTION_LABELS[s].toLowerCase()),
    ],
    hint: 'Group',
  }));
}

function toolCategoryEntries(): SettingsSearchEntry[] {
  const seen = new Set<ToolCategory>();
  for (const tool of BUILT_IN_TOOLS) {
    seen.add(tool.category);
  }
  return [...seen].map((category) => ({
    id: `tool-category:${category}`,
    label: TOOL_CATEGORY_LABELS[category],
    sectionId: category === 'web' ? ('search' as const) : ('tools' as const),
    kind: 'tool-category' as const,
    searchKey: `tools.category.${category}`,
    keywords: [category, 'tools', TOOL_CATEGORY_LABELS[category].toLowerCase()],
    hint: 'Tools',
  }));
}

function toolEntries(): SettingsSearchEntry[] {
  return BUILT_IN_TOOLS.map((tool) => ({
    id: `tool:${tool.id}`,
    label: tool.label,
    sectionId: tool.category === 'web' ? ('search' as const) : ('tools' as const),
    kind: 'tool' as const,
    searchKey: `tools.item.${tool.id}`,
    keywords: [
      tool.id,
      tool.description.toLowerCase(),
      tool.category,
      TOOL_CATEGORY_LABELS[tool.category].toLowerCase(),
    ],
    hint: 'Tool',
  }));
}

function modeEntries(): SettingsSearchEntry[] {
  return listModes().map((mode) => ({
    id: `mode:${mode.id}`,
    label: mode.label,
    sectionId: 'modes' as const,
    kind: 'mode' as const,
    searchKey: `modes.${mode.id}`,
    keywords: [mode.id, mode.description.toLowerCase(), 'composer mode'],
    hint: 'Mode',
  }));
}

function expertEntries(): SettingsSearchEntry[] {
  return listExperts().map((expert) => ({
    id: `expert:${expert.meta.id}`,
    label: expert.meta.label,
    sectionId: 'experts' as const,
    kind: 'expert' as const,
    searchKey: `experts.${expert.meta.id}`,
    keywords: [expert.meta.id, 'expert', 'persona'],
    hint: 'Expert',
  }));
}

function workAgentEntries(): SettingsSearchEntry[] {
  return listWorkAgents(true).map((agent) => ({
    id: `work-agent:${agent.id}`,
    label: agent.label,
    sectionId: 'work-agents' as const,
    kind: 'work-agent' as const,
    searchKey: `work-agents.${agent.id}`,
    keywords: [agent.id, 'work agent', 'agent'],
    hint: 'Work agent',
  }));
}

function subAgentEntries(): SettingsSearchEntry[] {
  const types = DEFAULT_SUB_AGENTS.types as Record<
    string,
    { label?: string }
  >;
  return Object.entries(types).map(([typeId, cfg]) => ({
    id: `sub-agent:${typeId}`,
    label: cfg.label?.trim() || typeId,
    sectionId: 'sub-agents' as const,
    kind: 'sub-agent' as const,
    searchKey: `sub-agents.${typeId}`,
    keywords: [typeId, 'sub-agent', 'sub agent', 'spawn'],
    hint: 'Sub-agent type',
  }));
}

/** Build the full searchable catalog from registries and section metadata. */
export function buildSettingsSearchIndex(): SettingsSearchEntry[] {
  const sections = SETTINGS_SECTIONS.map(sectionEntry);
  return [
    ...sections,
    MODELS_VOICE_SEARCH,
    ...navGroupEntries(),
    ...toolCategoryEntries(),
    ...toolEntries(),
    ...modeEntries(),
    ...expertEntries(),
    ...workAgentEntries(),
    ...subAgentEntries(),
  ];
}
