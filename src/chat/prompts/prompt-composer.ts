/**
 * Assemble the system prompt from enabled parts and profile rules.
 */

import { getMode } from '../modes/registry';
import { isModeId, type ModeId } from '../modes/types';
import { BROWSER_PREVIEW_TOOL_IDS } from './browser-allowlist-gate';
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

/** Operating modes that receive the shared mode-handoff tool-usage fragment. */
const MODE_HANDOFF_MODE_IDS = new Set<ModeId>([
  'general',
  'plan',
  'build',
  'orchestrate',
  'reef',
]);

/** Modes that receive the fact-verification tool-usage fragment. */
const FACT_VERIFICATION_MODE_IDS = new Set<ModeId>(['general', 'plan', 'build']);

function contextHasBrowserPreviewTools(ctx: ComposeContext): boolean {
  const ids = ctx.enabledToolIds ?? [];
  return ids.some((id) => BROWSER_PREVIEW_TOOL_IDS.has(id));
}

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

/** Default lite part gating (memory uses shorter retrieve cap when enabled). */
const LITE_DISABLED_PARTS = new Set<PromptPartId>(['info']);

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
    const id = ctx.workAgentId?.trim();
    return Boolean(id && id !== 'default');
  }
  if (partId === 'tool-usage') {
    return ctx.enabledToolIds.length > 0;
  }
  if (partId === 'info') {
    if (!ctx.infoPresetId) return false;
    // General-assistant context applies only in General mode (other modes have their own prompts).
    return ctx.modeId === 'general';
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
    const loadProfile = profile === 'lite' ? 'lite' : 'full';
    const loaded = loadPromptById('info', 'memory', loadProfile);
    if (loaded?.body?.trim()) {
      return loaded.body.trim();
    }
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

function contextHasContext7Tools(ctx: ComposeContext): boolean {
  return (ctx.enabledToolIds ?? []).some((id) => id.startsWith('mcp__context7__'));
}

/** Fact-verification ladder for plan/build/general before drafting or implementing. */
function resolveFactVerificationBody(ctx: ComposeContext, profile: PromptProfile): string {
  const modeId = ctx.modeId ?? '';
  if (!modeId || !isModeId(modeId) || !FACT_VERIFICATION_MODE_IDS.has(modeId)) {
    return '';
  }
  const loadProfile = profile === 'lite' ? 'lite' : 'full';
  const loaded = loadPromptById('tool-usage', 'fact-verification', loadProfile);
  return loaded?.body?.trim() ?? '';
}

/** Context7 MCP workflow when Context7 tools are enabled for this chat. */
function resolveContext7DocsBody(ctx: ComposeContext, profile: PromptProfile): string {
  if (!contextHasContext7Tools(ctx)) {
    return '';
  }
  const loadProfile = profile === 'lite' ? 'lite' : 'full';
  const loaded = loadPromptById('tool-usage', 'context7-docs', loadProfile);
  return loaded?.body?.trim() ?? '';
}

/** Shared mode-switch / Reef handoff rules appended after default tool-usage. */
function resolveModeHandoffBody(ctx: ComposeContext, profile: PromptProfile): string {
  const modeId = ctx.modeId ?? '';
  if (!modeId || !isModeId(modeId) || !MODE_HANDOFF_MODE_IDS.has(modeId)) {
    return '';
  }
  const loadProfile = profile === 'lite' ? 'lite' : 'full';
  const loaded = loadPromptById('tool-usage', 'mode-handoff', loadProfile);
  return loaded?.body?.trim() ?? '';
}

/** Browser navigation allowlist + ask_question flow when preview browser tools are enabled. */
function resolveBrowserAllowlistBody(ctx: ComposeContext, profile: PromptProfile): string {
  if (!contextHasBrowserPreviewTools(ctx)) {
    return '';
  }
  const useFullAllowlist = ctx.browserActivated === true;
  const loadProfile =
    profile === 'lite' || !useFullAllowlist ? 'lite' : 'full';
  const loaded = loadPromptById('tool-usage', 'browser-allowlist', loadProfile);
  return loaded?.body?.trim() ?? '';
}

function contextHasAskQuestionTool(ctx: ComposeContext): boolean {
  return (ctx.enabledToolIds ?? []).includes('ask_question');
}

/** Mandatory ask_question usage when the tool is enabled for this chat. */
function resolveAskQuestionEnforcementBody(ctx: ComposeContext, profile: PromptProfile): string {
  if (!contextHasAskQuestionTool(ctx)) {
    return '';
  }
  const loadProfile = profile === 'lite' ? 'lite' : 'full';
  const loaded = loadPromptById('tool-usage', 'ask-question-enforcement', loadProfile);
  return loaded?.body?.trim() ?? '';
}

function contextHasLaunchMinnowAppTool(ctx: ComposeContext): boolean {
  return (ctx.enabledToolIds ?? []).includes('launch_minnow_app');
}

/** General-mode MinnowOS app routing when launch_minnow_app is enabled. */
function resolveLaunchMinnowAppBody(ctx: ComposeContext, profile: PromptProfile): string {
  const modeId = ctx.modeId ?? '';
  if (modeId !== 'general' || !contextHasLaunchMinnowAppTool(ctx)) {
    return '';
  }
  const loadProfile = profile === 'lite' ? 'lite' : 'full';
  const loaded = loadPromptById('tool-usage', 'launch-minnow-app', loadProfile);
  return loaded?.body?.trim() ?? '';
}

function buildInterpolationVars(ctx: ComposeContext, profile: PromptProfile): InterpolationVars {
  const includeSummary =
    profile !== 'lite' || ctx.includeChatHistorySummary === true;

  const modeId = ctx.modeId ?? '';
  const modeLabel =
    modeId && isModeId(modeId) ? getMode(modeId).label : modeId;

  const profileLabel =
    ctx.profile === 'custom' ? 'custom' : ctx.profile === 'lite' ? 'lite' : 'full';

  return {
    mode: modeId,
    mode_label: modeLabel,
    profile: profileLabel,
    expert: ctx.expertLabel?.trim() || ctx.expertId || '',
    cwd: ctx.cwd,
    memory: ctx.memoryBlock ?? '',
    user_message: ctx.userMessagePreview ?? '',
    chat_history_summary: includeSummary ? '' : '',
    work_agent: ctx.workAgentId ?? '',
    work_agent_label: ctx.workAgentLabel?.trim() || ctx.workAgentId || '',
    skill: ctx.skillBody ?? '',
    date: new Date().toISOString().slice(0, 10),
    os: typeof navigator !== 'undefined' ? navigator.platform : 'node',
    plan_granularity: ctx.planGranularity ?? 'medium',
    orchestrate_plan: ctx.orchestratePlanPath ?? '',
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

    if (partId === 'tool-usage') {
      const profileKey = effectiveProfile === 'lite' ? 'lite' : 'full';
      const factVerificationRaw = resolveFactVerificationBody(ctx, profileKey);
      if (factVerificationRaw.trim()) {
        const factInterpolated = interpolatePromptBody(factVerificationRaw, vars);
        if (factInterpolated.trim()) {
          sections.push(factInterpolated.trim());
        }
      }
      const context7DocsRaw = resolveContext7DocsBody(ctx, profileKey);
      if (context7DocsRaw.trim()) {
        const context7Interpolated = interpolatePromptBody(context7DocsRaw, vars);
        if (context7Interpolated.trim()) {
          sections.push(context7Interpolated.trim());
        }
      }
      const handoffRaw = resolveModeHandoffBody(ctx, profileKey);
      if (handoffRaw.trim()) {
        const handoffInterpolated = interpolatePromptBody(handoffRaw, vars);
        if (handoffInterpolated.trim()) {
          sections.push(handoffInterpolated.trim());
        }
      }
      const browserAllowlistRaw = resolveBrowserAllowlistBody(ctx, profileKey);
      if (browserAllowlistRaw.trim()) {
        const browserInterpolated = interpolatePromptBody(browserAllowlistRaw, vars);
        if (browserInterpolated.trim()) {
          sections.push(browserInterpolated.trim());
        }
      }
      const askQuestionRaw = resolveAskQuestionEnforcementBody(ctx, profileKey);
      if (askQuestionRaw.trim()) {
        const askInterpolated = interpolatePromptBody(askQuestionRaw, vars);
        if (askInterpolated.trim()) {
          sections.push(askInterpolated.trim());
        }
      }
      const launchAppRaw = resolveLaunchMinnowAppBody(ctx, profileKey);
      if (launchAppRaw.trim()) {
        const launchInterpolated = interpolatePromptBody(launchAppRaw, vars);
        if (launchInterpolated.trim()) {
          sections.push(launchInterpolated.trim());
        }
      }
    }
  }

  return sections.join(PART_SEPARATOR);
}
