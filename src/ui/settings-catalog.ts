/**
 * Central catalog of searchable settings fields (MIN-130).
 * Feeds search index, live in-page filter, and chat deep-links.
 */

import type { SettingsSectionId } from './settings-page-types';

/** Top-level sidebar categories (7 merged groups). */
export type SettingsCategoryId =
  | 'general'
  | 'appearance'
  | 'models'
  | 'agents'
  | 'knowledge'
  | 'integrations'
  | 'advanced';

export interface SettingsFieldEntry {
  /** Canonical DOM anchor via data-settings-search-key. */
  key: string;
  label: string;
  category: SettingsCategoryId;
  /** Existing render unit / legacy hash slug. */
  area: SettingsSectionId;
  keywords?: string[];
  description?: string;
}

/** Sidebar labels for the seven categories. */
export const SETTINGS_CATEGORY_LABELS: Record<SettingsCategoryId, string> = {
  general: 'General',
  appearance: 'Appearance',
  models: 'Models',
  agents: 'Agents',
  knowledge: 'Knowledge',
  integrations: 'Integrations',
  advanced: 'Advanced',
};

/** Category descriptions (search keywords / future catalog hints; not shown in UI). */
export const SETTINGS_CATEGORY_DESCRIPTIONS: Record<SettingsCategoryId, string> = {
  general: 'Notifications, terminal behavior, LAN access, audio devices, and where settings are saved.',
  appearance: 'Theme, wallpaper, fonts, and custom accent colors.',
  models: 'LLM backends, per-role model picks, sampling, reasoning, and usage.',
  agents: 'Composer modes, personas, workers, and tool policies.',
  knowledge: 'System prompts, standing rules, and persistent memory.',
  integrations: 'Web search, dev tools, permissions, skills, and external hooks.',
  advanced: 'Orchestrate supervisor tuning and local eval runs.',
};

/** Category → ordered areas (render units). */
export const SETTINGS_CATEGORY_AREAS: Record<
  SettingsCategoryId,
  SettingsSectionId[]
> = {
  general: ['general', 'audio'],
  appearance: ['appearance'],
  models: ['providers', 'model-routing', 'sampler', 'thinking', 'usage'],
  agents: ['modes', 'experts', 'work-agents', 'agent-packs', 'sub-agents', 'autopilot'],
  knowledge: ['prompting', 'rules'],
  integrations: [
    'search',
    'deep-research',
    'servers',
    'tools',
    'mcp',
    'lsp',
    'editor',
    'skills',
    'webhooks',
  ],
  advanced: ['features', 'evals'],
};

/** Flat category list in sidebar order. */
export const SETTINGS_CATEGORIES: SettingsCategoryId[] = [
  'general',
  'appearance',
  'models',
  'agents',
  'knowledge',
  'integrations',
  'advanced',
];

/** Map legacy area slug → parent category. */
export function categoryForArea(area: SettingsSectionId): SettingsCategoryId {
  for (const category of SETTINGS_CATEGORIES) {
    if (SETTINGS_CATEGORY_AREAS[category].includes(area)) {
      return category;
    }
  }
  return 'general';
}

/** Catalog entries belonging to one area. */
export function fieldsForArea(area: SettingsSectionId): SettingsFieldEntry[] {
  return SETTINGS_FIELD_CATALOG.filter((entry) => entry.area === area);
}

/** Lookup a catalog entry by canonical key. */
export function fieldByKey(key: string): SettingsFieldEntry | undefined {
  return SETTINGS_FIELD_CATALOG.find((entry) => entry.key === key);
}

/** Categories that show a sticky in-panel area sub-nav. */
export const SETTINGS_CATEGORY_SUBNAV: ReadonlySet<SettingsCategoryId> = new Set([
  'general',
  'models',
  'agents',
  'knowledge',
  'integrations',
  'advanced',
]);

function field(
  key: string,
  label: string,
  category: SettingsCategoryId,
  area: SettingsSectionId,
  extras?: Pick<SettingsFieldEntry, 'keywords' | 'description'>,
): SettingsFieldEntry {
  return { key, label, category, area, ...extras };
}

/** Static field catalog — union with dynamic registry entries in search index. */
export const SETTINGS_FIELD_CATALOG: SettingsFieldEntry[] = [
  // —— General ——
  field('general.notifications', 'Notifications', 'general', 'general', {
    keywords: ['bell', 'alert', 'sound', 'menubar'],
    description: 'Menubar bell when background chats, tasks, or jobs need attention.',
  }),
  field('general.notifications.enabled', 'Enable notifications', 'general', 'general', {
    keywords: ['master toggle', 'bell'],
  }),
  field('general.notifications.chat', 'Chat notifications', 'general', 'general'),
  field('general.notifications.tasks', 'Task notifications', 'general', 'general', {
    keywords: ['orchestrate', 'sub-agent'],
  }),
  field('general.notifications.background', 'Background job notifications', 'general', 'general', {
    keywords: ['scheduler', 'research', 'synthesis'],
  }),
  field('general.notifications.sound', 'Notification sounds', 'general', 'general'),
  field('general.network', 'Network access', 'general', 'general', {
    keywords: ['lan', 'wifi', 'local network', 'remote', 'phone', 'tablet', '0.0.0.0'],
    description: 'Let other devices on your Wi-Fi open Minnow in a browser while this PC runs npm start.',
  }),
  field('general.chat.terminal', 'Terminal behavior', 'general', 'general', {
    keywords: ['shell', 'background command'],
  }),
  field('general.toolCalls.constrained', 'Constrained tool calls', 'general', 'general', {
    keywords: ['json schema', 'structured output'],
    description: 'Validate tool arguments with JSON Schema when the provider supports structured output.',
  }),
  field('general.generation.timeout', 'Generation timeout', 'general', 'general'),
  field('general.generation.maxTurns', 'Max tool turns', 'general', 'general'),
  field('audio.devices', 'Audio devices', 'general', 'audio', {
    keywords: ['microphone', 'speaker', 'input', 'output'],
  }),
  field('audio.inputDevice', 'Input device', 'general', 'audio', {
    keywords: ['microphone', 'mic'],
  }),
  field('audio.outputDevice', 'Output device', 'general', 'audio', {
    keywords: ['speaker', 'sink'],
  }),
  field('audio.echoCancellation', 'Echo cancellation', 'general', 'audio'),
  field('audio.noiseSuppression', 'Noise suppression', 'general', 'audio'),
  field('audio.autoGainControl', 'Auto gain control', 'general', 'audio'),

  // —— Appearance ——
  field('appearance.theme', 'Theme presets', 'appearance', 'appearance', {
    keywords: ['color', 'dark', 'light', 'sage', 'palette'],
  }),
  field('appearance.theme.family', 'Theme family', 'appearance', 'appearance'),
  field('appearance.theme.mode', 'Theme mode', 'appearance', 'appearance', {
    keywords: ['dark mode', 'light mode', 'follow system'],
  }),
  field('appearance.wallpaper', 'Desktop wallpaper', 'appearance', 'appearance', {
    keywords: ['background', 'desktop'],
  }),
  field('appearance.fonts', 'Fonts', 'appearance', 'appearance', {
    keywords: ['typography', 'mono', 'ui font'],
  }),
  field('appearance.customColors', 'Custom colors', 'appearance', 'appearance', {
    keywords: ['tokens', 'override'],
  }),

  // —— Models ——
  field('models.providers', 'Providers', 'models', 'providers', {
    keywords: ['api', 'lm studio', 'openai', 'backend'],
  }),
  field('models.providers.add', 'Add provider', 'models', 'providers'),
  field('models.routing', 'Model routing', 'models', 'model-routing', {
    keywords: ['bindings', 'roles', 'default model', 'goal evaluator', 'goal-eval'],
  }),
  field('models.routing.goalEval', 'Goal evaluator', 'models', 'model-routing', {
    keywords: ['goal', '/goal', 'evaluator', 'completion judge'],
    description: 'Model for /goal loop evaluation after each turn.',
  }),
  field('models.sampler', 'Sampler defaults', 'models', 'sampler', {
    keywords: ['temperature', 'top p', 'penalties'],
  }),
  field('models.sampler.temperature', 'Temperature', 'models', 'sampler'),
  field('models.sampler.topP', 'Top P', 'models', 'sampler'),
  field('models.sampler.topK', 'Top K', 'models', 'sampler'),
  field('models.sampler.minP', 'Min P', 'models', 'sampler'),
  field('models.sampler.repetitionPenalty', 'Repeat penalty', 'models', 'sampler'),
  field('models.sampler.presencePenalty', 'Presence penalty', 'models', 'sampler'),
  field('models.sampler.maxTokens', 'Max tokens', 'models', 'sampler'),
  field('models.thinking', 'Thinking defaults', 'models', 'thinking', {
    keywords: ['reasoning', 'chain of thought'],
  }),
  field('models.usage', 'Usage & cost', 'models', 'usage', {
    keywords: ['tokens', 'billing', 'inference'],
  }),

  // —— Agents ——
  field('agents.modes', 'Composer modes', 'agents', 'modes'),
  field('agents.experts', 'Experts', 'agents', 'experts', {
    keywords: ['persona', 'specialist'],
  }),
  field('agents.workAgents', 'Work agents', 'agents', 'work-agents'),
  field('agents.agentPacks', 'Agent packs', 'agents', 'agent-packs'),
  field('agents.subAgents', 'Sub-agents', 'agents', 'sub-agents', {
    keywords: ['spawn', 'subagent'],
  }),
  field('agents.subAgents.maxTurns', 'Sub-agent max tool turns', 'agents', 'sub-agents'),
  field('agents.autopilot', 'Orchestrator autopilot', 'agents', 'autopilot', {
    keywords: ['orchestrate', 'board', 'autopilot', 'concurrency', 'isolation'],
    description: 'Global defaults for orchestrate board execution, testing, and heartbeat.',
  }),
  field('agents.autopilot.executionMode', 'Default execution mode', 'agents', 'autopilot'),
  field('agents.autopilot.isolation', 'Default isolation mode', 'agents', 'autopilot'),
  field('agents.autopilot.concurrency', 'Max concurrent tasks', 'agents', 'autopilot'),
  field('agents.autopilot.plannerModel', 'Default planner model', 'agents', 'autopilot'),
  field('agents.autopilot.selfHeal', 'Self-heal & provisioning', 'agents', 'autopilot', {
    keywords: ['self-heal', 'provision', 'quarantine', 'infra', 'worktree', 'stall'],
    description: 'Configure AFK self-heal rounds, infra provisioning, and worktree cd-guard.',
  }),
  field('agents.autopilot.selfHealMaxRounds', 'Max self-heal rounds', 'agents', 'autopilot', {
    keywords: ['self-heal', 'rounds', 'quarantine'],
  }),
  field('agents.autopilot.infraProvisionTimeout', 'Infra provision timeout', 'agents', 'autopilot', {
    keywords: ['infra', 'provision', 'timeout'],
  }),
  field('agents.autopilot.autoProvisionInfra', 'Auto-provision infra', 'agents', 'autopilot', {
    keywords: ['provision', 'infra', 'docker'],
  }),
  field('agents.autopilot.afkAutoRestartStalls', 'Auto-restart stalled tasks', 'agents', 'autopilot', {
    keywords: ['stall', 'restart', 'quarantine', 'afk'],
  }),
  field('agents.autopilot.guardCdOutsideWorktree', 'Guard cd outside worktree', 'agents', 'autopilot', {
    keywords: ['worktree', 'cd', 'guard', 'isolation'],
  }),

  // —— Knowledge ——
  field('knowledge.prompting', 'Prompt profiles', 'knowledge', 'prompting', {
    keywords: ['prompt', 'system prompt', 'full', 'lite', 'custom'],
  }),
  field('knowledge.prompting.profiles', 'Setup profiles', 'knowledge', 'prompting', {
    keywords: ['bundle', 'export', 'import'],
  }),
  field('knowledge.prompting.hub', 'Prompt hub', 'knowledge', 'prompting'),
  field('knowledge.rules', 'User rules', 'knowledge', 'rules', {
    keywords: ['cursor rules', 'instructions'],
  }),
  field('knowledge.rules.enabled', 'Enable user rules', 'knowledge', 'rules'),
  field('knowledge.rules.text', 'Rules text', 'knowledge', 'rules'),

  // —— Integrations ——
  field('integrations.search', 'Web search provider', 'integrations', 'search', {
    keywords: ['brave', 'tavily', 'duckduckgo', 'searxng', 'web research'],
  }),
  field('integrations.search.provider', 'Search provider', 'integrations', 'search'),
  field('integrations.search.apiKeys', 'Search API keys', 'integrations', 'search'),
  field('integrations.deepResearch', 'Deep Research', 'integrations', 'deep-research', {
    keywords: ['research engine', 'iterresearch'],
  }),
  field('integrations.servers', 'Managed servers', 'integrations', 'servers', {
    keywords: ['searxng', 'local search'],
  }),
  field('integrations.tools', 'Tool permissions', 'integrations', 'tools', {
    keywords: ['allow', 'deny', 'security'],
  }),
  field('integrations.tools.cache', 'Tool result cache', 'integrations', 'tools'),
  field('integrations.mcp', 'MCP servers', 'integrations', 'mcp', {
    keywords: ['model context protocol', 'dev stack'],
  }),
  field('integrations.lsp', 'Language servers', 'integrations', 'lsp', {
    keywords: ['diagnostics', 'typescript', 'dev stack'],
  }),
  field('integrations.editor', 'Editor copilot', 'integrations', 'editor', {
    keywords: ['ghost text', 'inline completion', 'dev stack'],
  }),
  field('integrations.skills', 'Skills', 'integrations', 'skills', {
    keywords: ['slash command', 'skill pack'],
  }),
  field('integrations.webhooks', 'Webhooks', 'integrations', 'webhooks', {
    keywords: ['hmac', 'outgoing events'],
  }),
  field('integrations.browser', 'Browser allowlist', 'integrations', 'tools', {
    keywords: ['cdp', 'automation'],
  }),

  // —— Advanced ——
  field('advanced.orchestration', 'Orchestration supervisor', 'advanced', 'features', {
    keywords: ['orchestrate', 'heartbeat', 'board'],
  }),
  field('advanced.evals', 'Eval harness', 'advanced', 'evals', {
    keywords: ['benchmark', 'rubric', 'task pack'],
  }),
];
