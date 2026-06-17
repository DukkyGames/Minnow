/**
 * Live chat context window budget (MIN-13): estimate used tokens vs model limit.
 */

import { contextLengthFromModelRow } from '../lib/context-length';
import { formatModelLabel } from '../lib/format-model-label';
import { decodeModelSelectKey, encodeModelSelectKey, findFirstSelectKeyForCanonicalModelId } from '../lib/model-select-key';
import { modelCache } from '../app-state';
import type { Attachment } from '../attachments/types';
import type { Chat, LmModelRecord } from '../types';
import {
  estimateInFlightOverlayTokens,
  type ContextInFlightOverlay,
} from './context-in-flight';
import {
  ESTIMATE_IMAGE_URL_TOKENS,
  estimateTokensFromText,
  type OutboundPromptEstimate,
} from './prompts/token-estimate-core';

export type ContextUsageSectionKey =
  | 'system'
  | 'rules'
  | 'tools'
  | 'history'
  | 'inFlight'
  | 'composer'
  | 'attachments';

export interface ContextUsageSection {
  key: ContextUsageSectionKey;
  label: string;
  tokens: number;
}

export interface ContextBudget {
  modelId: string;
  modelDisplayName: string;
  /** Model max context length when known. */
  limit: number | null;
  /** Estimated tokens for the next send (includes pending composer + attachments). */
  used: number;
  /** limit - used when limit is known. */
  remaining: number | null;
  /** 0–100 for the ring; capped at 100; null when limit unknown. */
  percent: number | null;
  /** False when the last turn reported provider prompt_tokens. */
  isEstimate: boolean;
  /** Provider prompt_tokens from the last completed turn, if any. */
  lastTurnPromptTokens: number | null;
  breakdown: ContextUsageSection[];
}

export interface GetContextBudgetOptions {
  chat?: Chat;
  modelId?: string;
  /** Pending composer textarea (chars ÷ 4 estimate). */
  pendingComposerText?: string;
  /** Precomputed attachment token estimate. */
  pendingAttachmentTokens?: number;
  /** Streaming / not-yet-persisted turn content (BUG-019). */
  inFlight?: Omit<ContextInFlightOverlay, 'chatId'>;
}

/** Rough token count for queued attachment payloads. */
export function estimateAttachmentTokens(attachments: Attachment[]): number {
  let total = 0;
  for (const attachment of attachments) {
    if (attachment.kind === 'error') continue;
    if (attachment.text) {
      total += estimateTokensFromText(attachment.text);
      continue;
    }
    if (attachment.dataUrl) {
      // API sends image_url parts, not base64 in text — cap per image like context-budget.
      total +=
        attachment.kind === 'image'
          ? ESTIMATE_IMAGE_URL_TOKENS
          : estimateTokensFromText(attachment.dataUrl);
      continue;
    }
    if (attachment.workspacePath) {
      total += estimateTokensFromText(attachment.workspacePath) + 256;
      continue;
    }
    total += estimateTokensFromText(attachment.name);
  }
  return total;
}

/** Section rows for the breakdown panel from estimate buckets + pending input. */
export function buildContextUsageBreakdown(
  estimate: OutboundPromptEstimate,
  composerTokens: number,
  attachmentTokens: number,
  inFlightTokens = 0,
): ContextUsageSection[] {
  const rows: ContextUsageSection[] = [
    {
      key: 'system',
      label: estimate.legacyFallback ? 'System (legacy drawer)' : 'System',
      tokens: estimate.composedSystem,
    },
    { key: 'rules', label: 'Rules', tokens: estimate.userRules },
    { key: 'tools', label: 'Tools', tokens: estimate.tools },
    { key: 'history', label: 'History', tokens: estimate.history },
  ];
  if (inFlightTokens > 0) {
    rows.push({
      key: 'inFlight',
      label: 'In progress (estimate)',
      tokens: inFlightTokens,
    });
  }
  if (composerTokens > 0) {
    rows.push({ key: 'composer', label: 'Composer (pending)', tokens: composerTokens });
  }
  if (attachmentTokens > 0) {
    rows.push({ key: 'attachments', label: 'Attachments (pending)', tokens: attachmentTokens });
  }
  return rows;
}

function sumBreakdownTokens(sections: ContextUsageSection[]): number {
  let total = 0;
  for (const section of sections) {
    total += section.tokens;
  }
  return total;
}

function lookupCachedModelRow(modelId: string): LmModelRecord | undefined {
  const trimmed = modelId.trim();
  if (!trimmed) return undefined;
  const direct = modelCache.get(trimmed);
  if (direct) return direct;
  const decoded = decodeModelSelectKey(trimmed);
  if (decoded) {
    return modelCache.get(encodeModelSelectKey(decoded.providerId, decoded.modelId));
  }
  for (const key of modelCache.keys()) {
    const entry = decodeModelSelectKey(key);
    if (entry?.modelId === trimmed) {
      return modelCache.get(key);
    }
  }
  const fallbackKey = findFirstSelectKeyForCanonicalModelId(modelCache.keys(), trimmed);
  return fallbackKey ? modelCache.get(fallbackKey) : undefined;
}

function resolveModelDisplayName(modelId: string): string {
  const cached = lookupCachedModelRow(modelId);
  if (cached) {
    return formatModelLabel({
      id: cached.id,
      quantization: cached.quantization,
      state: cached.state,
    }).primary;
  }
  return formatModelLabel({ id: modelId }).primary;
}

/**
 * Effective context limit for usage UI: configured window when known, not catalog max.
 * Priority: last-turn model_info → loaded_context_length (loaded) → max_context_length.
 */
export function resolveContextLimit(modelId: string, chat: Chat): number | null {
  const fromChat = chat.modelInfo?.context_length;
  if (typeof fromChat === 'number' && Number.isFinite(fromChat) && fromChat > 0) {
    return fromChat;
  }

  const cached = lookupCachedModelRow(modelId);
  if (cached) {
    const fromRow = contextLengthFromModelRow(cached);
    if (fromRow != null) return fromRow;
  }

  return null;
}

/** Ring fill percent (0–100); null when limit unknown. */
export function computeContextUsagePercent(used: number, limit: number | null): number | null {
  if (limit == null || limit <= 0) return null;
  const raw = (used / limit) * 100;
  if (!Number.isFinite(raw)) return null;
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/** Pure merge of estimate buckets + pending input into a budget snapshot. */
export function assembleContextBudget(params: {
  modelId: string;
  modelDisplayName: string;
  limit: number | null;
  estimate: OutboundPromptEstimate;
  composerTokens: number;
  attachmentTokens: number;
  inFlightTokens?: number;
  lastTurnPromptTokens: number | null;
}): ContextBudget {
  const breakdown = buildContextUsageBreakdown(
    params.estimate,
    params.composerTokens,
    params.attachmentTokens,
    params.inFlightTokens ?? 0,
  );
  const used = sumBreakdownTokens(breakdown);
  const limit = params.limit;
  const remaining = limit != null ? Math.max(0, limit - used) : null;
  const percent = computeContextUsagePercent(used, limit);

  return {
    modelId: params.modelId,
    modelDisplayName: params.modelDisplayName,
    limit,
    used,
    remaining,
    percent,
    isEstimate: params.lastTurnPromptTokens == null,
    lastTurnPromptTokens: params.lastTurnPromptTokens,
    breakdown,
  };
}

/**
 * Approximate context fill for the active (or given) chat and model.
 * Merges outbound prompt estimate with pending composer and attachments.
 */
export async function getContextBudget(
  options?: GetContextBudgetOptions,
): Promise<ContextBudget> {
  const { getActiveChat } = await import('../state/sessions');
  const chat = options?.chat ?? getActiveChat();
  const modelId =
    options?.modelId?.trim() ||
    chat.modelId ||
    (typeof document !== 'undefined'
      ? (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value
      : '') ||
    '';

  const { resolveOutboundPromptEstimate } = await import('./prompts/token-estimate');
  const estimate = await resolveOutboundPromptEstimate({ chat, modelId });
  const composerTokens = estimateTokensFromText(options?.pendingComposerText?.trim() ?? '');
  const attachmentTokens = options?.pendingAttachmentTokens ?? 0;
  const inFlightTokens = estimateInFlightOverlayTokens(options?.inFlight);

  const lastTurnPromptTokens =
    chat.lastStats?.prompt_tokens != null && Number.isFinite(chat.lastStats.prompt_tokens)
      ? chat.lastStats.prompt_tokens
      : null;

  return assembleContextBudget({
    modelId,
    modelDisplayName: modelId ? resolveModelDisplayName(modelId) : 'No model',
    limit: modelId ? resolveContextLimit(modelId, chat) : null,
    estimate,
    composerTokens,
    attachmentTokens,
    inFlightTokens,
    lastTurnPromptTokens,
  });
}
