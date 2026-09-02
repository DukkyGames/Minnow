import { getModelRowForSelectOrCanonicalId } from '../api/models';
import { contextLengthFromModelRow } from '../lib/context-length';
import { formatModelLabel } from '../lib/format-model-label';
import { decodeModelSelectKey, encodeModelSelectKey, findFirstSelectKeyForCanonicalModelId } from '../lib/model-select-key';
import { modelCache } from '../app-state';
import type { Attachment } from '../attachments/types';
import { attachmentImageDataUrl } from '../attachments/attachment-image';
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

// ── Types ────────────────────────────────────────────────────────────────────

export type ContextUsageSectionKey =
  | 'system'
  | 'codeMap'
  | 'contextDocuments'
  | 'rules'
  | 'tools'
  | 'history'
  | 'compressed'
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

// ── Breakdown ────────────────────────────────────────────────────────────────

/** Rough token count for queued attachment payloads. */
export function estimateAttachmentTokens(attachments: Attachment[]): number {
  let total = 0;
  for (const attachment of attachments) {
    if (attachment.kind === 'error') continue;
    if (attachment.text) {
      total += estimateTokensFromText(attachment.text);
      continue;
    }
    if (attachmentImageDataUrl(attachment)) {
      total += ESTIMATE_IMAGE_URL_TOKENS;
      continue;
    }
    if (attachment.dataUrl) {
      total += estimateTokensFromText(attachment.dataUrl);
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
  const historyLabel = estimate.historyCompressed
    ? 'History (after compression)'
    : 'History';
  const rows: ContextUsageSection[] = [
    {
      key: 'system',
      label: estimate.legacyFallback ? 'System (legacy drawer)' : 'System',
      tokens: Math.max(
        0,
        estimate.composedSystem -
          (estimate.codeMapSystem ?? 0) -
          (estimate.contextDocumentsSystem ?? 0),
      ),
    },
  ];
  if (estimate.codeMapSystem != null && estimate.codeMapSystem > 0) {
    rows.push({
      key: 'codeMap',
      label: 'Code map',
      tokens: estimate.codeMapSystem,
    });
  } else if (estimate.codeMapInjectionEnabled) {
    rows.push({
      key: 'codeMap',
      label: 'Code map (loading)',
      tokens: 0,
    });
  }
  if (estimate.contextDocumentsSystem != null && estimate.contextDocumentsSystem > 0) {
    rows.push({
      key: 'contextDocuments',
      label: 'Context documents',
      tokens: estimate.contextDocumentsSystem,
    });
  } else if (estimate.contextDocumentsInjectionEnabled) {
    rows.push({
      key: 'contextDocuments',
      label: 'Context documents (loading)',
      tokens: 0,
    });
  }
  rows.push(
    { key: 'rules', label: 'Rules', tokens: estimate.userRules },
    { key: 'tools', label: 'Tools', tokens: estimate.tools },
    { key: 'history', label: historyLabel, tokens: estimate.history },
  );
  if (
    estimate.compressedContextEstimate != null &&
    estimate.compressedContextEstimate > 0
  ) {
    rows.push({
      key: 'compressed',
      label: 'Compressed context (estimate)',
      tokens: estimate.compressedContextEstimate,
    });
  }
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

export function resolveContextLimit(modelId: string, chat: Chat): number | null {
  const cached = getModelRowForSelectOrCanonicalId(modelId);
  if (cached) {
    const fromRow = contextLengthFromModelRow(cached);
    if (fromRow != null) return fromRow;
  }

  const fromChat = chat.modelInfo?.context_length;
  if (typeof fromChat === 'number' && Number.isFinite(fromChat) && fromChat > 0) {
    return fromChat;
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

// ── Budget ───────────────────────────────────────────────────────────────────

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

export async function getContextBudget(
  options?: GetContextBudgetOptions,
): Promise<ContextBudget> {
  const { getActiveChat, ensureChatHistoryLoaded } = await import('../state/sessions');
  const chat = options?.chat ?? getActiveChat();
  await ensureChatHistoryLoaded(chat.id);
  const modelId =
    options?.modelId?.trim() ||
    chat.modelId?.trim() ||
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
