/**
 * Assemble the system prompt from enabled parts and profile rules.
 */

import { interpolatePromptBody } from './interpolate';
import { loadPromptById } from './prompt-loader';
import type {
  ComposeContext,
  InterpolationVars,
  PromptConfig,
  PromptConfigPartSettings,
  PromptKind,
  PromptPartId,
  PromptProfile,
} from './types';

/** Mandatory concatenation order for system message parts. */
export const PART_ORDER: PromptPartId[] = [
  'base',
  'mode',
  'expert',
  'work-agent',
  'tool-usage',
  'info',
  'skill',
  'memory',
];

const PART_SEPARATOR = '\n\n---\n\n';

/** Lite truncation caps when no lite template exists. */
const LITE_TRUNCATE_CAPS: Record<PromptPartId, number> = {
  base: 800,
  mode: 600,
  expert: 500,
  'work-agent': 600,
  'tool-usage': 400,
  info: 0,
  skill: 2000,
  memory: 0,
};

/** Default lite part gating. */
const LITE_DISABLED_PARTS = new Set<PromptPartId>(['info', 'memory']);

function truncateForLite(text: string, maxChars: number): string {
  if (maxChars <= 0 || !text.trim()) return '';
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trimEnd()}…`;
}

function partSettings(
  config: PromptConfig | null | undefined,
  partId: PromptPartId,
): PromptConfigPartSettings | null {
  if (!config?.parts) return null;
  return config.parts[partId] ?? null;
}

function isPartEnabled(
  ctx: ComposeContext,
  partId: PromptPartId,
  profile: PromptProfile,
): boolean {
  const custom = partSettings(ctx.customConfig, partId);
  if (profile === 'custom' && custom) {
    return custom.enabled;
  }
  if (profile === 'lite' && LITE_DISABLED_PARTS.has(partId)) {
    return false;
  }
  if (partId === 'skill') {
    return Boolean(ctx.skillBody?.trim());
  }
  if (partId === 'memory') {
    return Boolean(ctx.memoryBlock?.trim());
  }
  if (partId === 'mode') {
    return Boolean(ctx.modeId);
  }
  if (partId === 'expert') {
    return Boolean(ctx.expertId);
  }
  if (partId === 'work-agent') {
    return Boolean(ctx.workAgentId);
  }
  if (partId === 'tool-usage') {
    return ctx.enabledToolIds.length > 0;
  }
  if (partId === 'info') {
    return Boolean(ctx.infoPresetId);
  }
  return true;
}

function kindForPart(partId: PromptPartId): PromptKind {
  if (partId === 'tool-usage') return 'tool-usage';
  if (partId === 'work-agent') return 'work-agent';
  if (partId === 'mode') return 'mode';
  if (partId === 'expert') return 'expert';
  if (partId === 'info') return 'info';
  return 'base';
}

function resolvePartId(
  partId: PromptPartId,
  ctx: ComposeContext,
): string {
  if (partId === 'base') return 'default';
  if (partId === 'mode') return ctx.modeId ?? '';
  if (partId === 'expert') return ctx.expertId ?? '';
  if (partId === 'work-agent') return ctx.workAgentId ?? '';
  if (partId === 'info') return ctx.infoPresetId ?? '';
  if (partId === 'tool-usage') return 'default';
  return '';
}

function resolvePartBody(
  partId: PromptPartId,
  ctx: ComposeContext,
  profile: PromptProfile,
): string {
  const custom = partSettings(ctx.customConfig, partId);
  if (custom?.contentOverride?.trim()) {
    return custom.contentOverride.trim();
  }

  if (partId === 'skill' && ctx.skillBody?.trim()) {
    return ctx.skillBody.trim();
  }
  if (partId === 'memory' && ctx.memoryBlock?.trim()) {
    return ctx.memoryBlock.trim();
  }

  const kind = kindForPart(partId);
  const id = resolvePartId(partId, ctx);
  if (!id && partId !== 'base' && partId !== 'tool-usage') {
    return '';
  }

  const loadProfile = profile === 'lite' ? 'lite' : 'full';
  const loaded = loadPromptById(kind, id || 'default', loadProfile);
  if (!loaded?.body) return '';

  let body = loaded.body;
  if (profile === 'lite') {
    if (loaded.liteBody?.trim()) {
      body = loaded.liteBody.trim();
    } else {
      body = truncateForLite(body, LITE_TRUNCATE_CAPS[partId]);
    }
  }
  return body;
}

function buildInterpolationVars(ctx: ComposeContext, profile: PromptProfile): InterpolationVars {
  const includeSummary =
    profile !== 'lite' || ctx.includeChatHistorySummary === true;

  return {
    mode: ctx.modeId ?? '',
    expert: ctx.expertId ?? '',
    enabled_tools: ctx.enabledToolSummaries ?? '',
    cwd: ctx.cwd,
    memory: ctx.memoryBlock ?? '',
    user_message: ctx.userMessagePreview ?? '',
    chat_history_summary: includeSummary ? '' : '',
    work_agent: ctx.workAgentId ?? '',
    skill: ctx.skillBody ?? '',
    date: new Date().toISOString().slice(0, 10),
    os: typeof navigator !== 'undefined' ? navigator.platform : 'node',
  };
}

/**
 * Compose the full system prompt string for LM Studio.
 */
export function composeSystemPrompt(ctx: ComposeContext): string {
  const profile: PromptProfile =
    ctx.profile === 'custom' ? 'custom' : ctx.profile === 'lite' ? 'lite' : 'full';

  const effectiveProfile: PromptProfile =
    profile === 'custom' ? 'custom' : profile;

  const vars = buildInterpolationVars(ctx, effectiveProfile === 'lite' ? 'lite' : 'full');

  const sections: string[] = [];

  for (const partId of PART_ORDER) {
    if (!isPartEnabled(ctx, partId, effectiveProfile)) continue;

    const rawBody = resolvePartBody(partId, ctx, effectiveProfile === 'lite' ? 'lite' : 'full');
    if (!rawBody.trim()) continue;

    const interpolated = interpolatePromptBody(rawBody, vars);
    if (interpolated.trim()) {
      sections.push(interpolated.trim());
    }
  }

  return sections.join(PART_SEPARATOR);
}
