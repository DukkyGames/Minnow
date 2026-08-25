/**
 * Per-agent input token budgets and pre-send enforcement (MIN-39).
 * Pure helpers — safe for Node tests (no DOM).
 */

import { apiMessageContentToText, contentPartsToText } from '../api/message-content.ts';
import {
  charsPerTokenFor,
  imagePaddingForEstimate,
  estimateTokensFromText,
  ESTIMATE_IMAGE_URL_TOKENS,
} from './prompts/token-estimate-core';
import type { ApiMessage, ContentPart } from '../types';
import { isToolImageFollowUpMessage } from './tool-image-follow-up';

import type { ArchiveConfig } from './archive/types';

/** How to fit outbound messages under a token ceiling. */
export type ContextEnforcementPolicy =
  | 'summarize'
  | 'dropMiddle'
  | 'slide'
  | 'truncate'
  | 'archive';

/** Shipped default when a row omits policy (LLM summarize). */
export const DEFAULT_CONTEXT_ENFORCEMENT_POLICY: ContextEnforcementPolicy = 'summarize';

/**
 * Headroom left under the model window for the reply itself and for estimator
 * drift. It only works when the estimate is honest: while `estimateTokensFromText`
 * ran at `chars ÷ 4` it undercounted tool-heavy transcripts by 24–33%, so this
 * margin was spent before enforcement ever looked at it and the trigger point
 * sat *above* the hard limit. See the divisor table in token-estimate-core.
 */
export const SAFETY_MARGIN = 0.9;
const TRUNCATION_MARKER = '[… truncated for context budget]';
/** Prefix injected before compressed prior-turn summaries (LLM or extractive). */
export const SUMMARY_HEADER = '## Prior context (compressed)\n';

/** Agent-level budget declaration (work agents + sub-agent types). */
export interface AgentContextBudgetConfig {
  enforcementPolicy: ContextEnforcementPolicy;
  minRecentTurns?: number;
  summaryReserveTokens?: number;
  /** Tuning when enforcementPolicy is `archive` (MIN-139). */
  archive?: ArchiveConfig;
}

export interface ResolvedContextBudget {
  /** Ceiling for the *message* estimate — already net of {@link reservedTokens}. */
  effectiveLimit: number | null;
  modelLimit: number | null;
  policy: ContextEnforcementPolicy;
  /** Non-message payload sharing the window (tool schemas). */
  reservedTokens: number;
}

export interface ApplyContextBudgetResult {
  messages: ApiMessage[];
  applied: boolean;
  policy: ContextEnforcementPolicy;
  tokensBefore: number;
  tokensAfter: number;
  droppedMessageCount: number;
  /** Number of logical turns dropped (slide / summarize / dropMiddle). */
  droppedTurns: number;
  summaryInjected: boolean;
  /** Text sent to the model inside the summary user message, if any. */
  summaryText?: string;
  statusMessage: string | null;
}

export interface TurnSlice {
  start: number;
  end: number;
}

function normalizePositiveInt(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const n = Math.floor(value);
  return n > 0 ? n : null;
}

export function serializeApiMessageForEstimate(msg: ApiMessage): string {
  if (msg.role === 'system') return msg.content;
  if (msg.role === 'user') {
    const text = apiMessageContentToText(msg.content);
    if (Array.isArray(msg.content)) {
      const images = msg.content.filter((part) => part.type === 'image_url').length;
      return text + imagePaddingForEstimate(images);
    }
    return text;
  }
  if (msg.role === 'tool') return msg.content;
  if (msg.role === 'assistant') {
    const base = apiMessageContentToText(msg.content);
    if (msg.tool_calls?.length) {
      return base + JSON.stringify(msg.tool_calls);
    }
    return base;
  }
  return '';
}

/**
 * Token estimate for one outbound message, priced per content class. Tool
 * results and serialized `tool_calls` are the bulk of an agent transcript and
 * tokenize far worse than prose, so they must not share prose's divisor.
 */
export function estimateApiMessageTokens(msg: ApiMessage): number {
  if (msg.role === 'system') return estimateTokensFromText(msg.content, 'prose');
  if (msg.role === 'tool') return estimateTokensFromText(msg.content, 'payload');
  if (msg.role === 'user') {
    const text = apiMessageContentToText(msg.content);
    const images = Array.isArray(msg.content)
      ? msg.content.filter((part) => part.type === 'image_url').length
      : 0;
    return (
      estimateTokensFromText(text, 'prose') + images * ESTIMATE_IMAGE_URL_TOKENS
    );
  }
  if (msg.role === 'assistant') {
    let total = estimateTokensFromText(apiMessageContentToText(msg.content), 'prose');
    if (msg.tool_calls?.length) {
      total += estimateTokensFromText(JSON.stringify(msg.tool_calls), 'payload');
    }
    return total;
  }
  return 0;
}

export function estimateApiMessagesTokens(messages: ApiMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateApiMessageTokens(msg);
  }
  return total;
}

export function agentContextBudgetFromWorkAgent(
  agent: {
    contextEnforcementPolicy?: ContextEnforcementPolicy | null;
    minRecentTurns?: number;
    summaryReserveTokens?: number;
    archive?: ArchiveConfig;
  },
  resolvedPolicy?: ContextEnforcementPolicy,
): AgentContextBudgetConfig {
  return {
    enforcementPolicy:
      resolvedPolicy ??
      agent.contextEnforcementPolicy ??
      DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
    minRecentTurns: agent.minRecentTurns,
    summaryReserveTokens: agent.summaryReserveTokens,
    archive: agent.archive,
  };
}

export function agentContextBudgetFromSubAgentType(
  type: Parameters<typeof agentContextBudgetFromWorkAgent>[0],
  resolvedPolicy?: ContextEnforcementPolicy,
): AgentContextBudgetConfig {
  return agentContextBudgetFromWorkAgent(type, resolvedPolicy);
}

export function resolveContextBudget(params: {
  agentConfig: AgentContextBudgetConfig;
  modelLimit: number | null;
  /**
   * Tokens the request spends outside `messages` — tool schemas ride in
   * `body.tools`, share the same window, and are invisible to the message
   * estimate. Left uncounted, the whole enabled catalog (≈12k real tokens)
   * silently ate more than {@link SAFETY_MARGIN}.
   */
  reservedTokens?: number;
  /**
   * Force the message-estimate ceiling, bypassing margin and reserve. Set from
   * a provider's own overflow numbers so a compact-and-retry targets what the
   * server actually measured rather than what we guessed.
   */
  effectiveLimitOverride?: number | null;
}): ResolvedContextBudget {
  const policy = params.agentConfig.enforcementPolicy ?? DEFAULT_CONTEXT_ENFORCEMENT_POLICY;
  const modelLimit = normalizePositiveInt(params.modelLimit);
  const reservedTokens = Math.max(0, Math.floor(params.reservedTokens ?? 0));

  const override = normalizePositiveInt(params.effectiveLimitOverride);
  if (override != null) {
    return { effectiveLimit: override, modelLimit, policy, reservedTokens };
  }

  const effectiveLimit =
    modelLimit != null
      ? Math.max(1, Math.floor(modelLimit * SAFETY_MARGIN) - reservedTokens)
      : null;

  return { effectiveLimit, modelLimit, policy, reservedTokens };
}

function isPriorContextSummary(msg: ApiMessage): boolean {
  return (
    msg.role === 'user' &&
    typeof msg.content === 'string' &&
    msg.content.startsWith(SUMMARY_HEADER)
  );
}

export function countPinnedSystemMessages(messages: ApiMessage[]): number {
  let n = 0;
  for (const msg of messages) {
    if (msg.role === 'system') n += 1;
    else break;
  }
  return n;
}

export function partitionTurns(messages: ApiMessage[], systemEnd: number): TurnSlice[] {
  const turns: TurnSlice[] = [];
  let i = systemEnd;
  while (i < messages.length) {
    // Screenshot follow-ups are user-shaped but belong to the preceding tool unit.
    if (messages[i].role !== 'user' || isToolImageFollowUpMessage(messages[i])) {
      const end = unitEndAt(messages, i);
      turns.push({ start: i, end });
      i = end;
      continue;
    }
    // Keep each user line separate so a single seed does not swallow an entire
    // tool loop (orchestrate board tasks, sub-agents, headless runs).
    turns.push({ start: i, end: i + 1 });
    i += 1;
    while (
      i < messages.length &&
      (messages[i].role !== 'user' || isToolImageFollowUpMessage(messages[i]))
    ) {
      const end = unitEndAt(messages, i);
      turns.push({ start: i, end });
      i = end;
    }
  }
  return turns;
}

export function rebuildFromTurns(
  messages: ApiMessage[],
  systemEnd: number,
  turns: TurnSlice[],
): ApiMessage[] {
  const pinned = messages.slice(0, systemEnd);
  const tail: ApiMessage[] = [];
  for (const turn of turns) {
    tail.push(...messages.slice(turn.start, turn.end));
  }
  return [...pinned, ...tail];
}

/**
 * End index (exclusive) of the atomic message unit starting at `start`.
 * An `assistant` message with `tool_calls` binds its following contiguous `tool`
 * results into one unit so trimming never splits a tool-call/tool-result pair.
 */
function unitEndAt(messages: ApiMessage[], start: number): number {
  const msg = messages[start];
  if (msg.role === 'assistant' && msg.tool_calls?.length) {
    let end = start + 1;
    while (end < messages.length && messages[end].role === 'tool') end += 1;
    // Keep screenshot pixels bound to the tool-call/tool-result pair.
    while (end < messages.length && isToolImageFollowUpMessage(messages[end])) end += 1;
    return end;
  }
  return start + 1;
}

/**
 * Drop tool-call/tool-result pairs left dangling by trimming so the outbound
 * sequence stays API-valid: every `tool` message must follow an `assistant`
 * that requested it, and every assistant `tool_calls` entry must be answered.
 */
function sanitizeToolPairing(messages: ApiMessage[]): ApiMessage[] {
  const answeredIds = new Set<string>();
  for (const msg of messages) {
    if (msg.role === 'tool' && msg.tool_call_id) answeredIds.add(msg.tool_call_id);
  }

  const requestedIds = new Set<string>();
  const out: ApiMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'assistant' && msg.tool_calls?.length) {
      const kept = msg.tool_calls.filter((tc) => answeredIds.has(tc.id));
      if (kept.length === 0) {
        // Assistant announced only unanswered tool calls: keep prose, else drop.
        if (apiMessageContentToText(msg.content).trim()) {
          const { tool_calls: _dropped, ...rest } = msg;
          out.push(rest as ApiMessage);
        }
        continue;
      }
      for (const tc of kept) requestedIds.add(tc.id);
      out.push(kept.length === msg.tool_calls.length ? msg : { ...msg, tool_calls: kept });
      continue;
    }
    if (msg.role === 'tool') {
      if (!requestedIds.has(msg.tool_call_id)) continue;
      out.push(msg);
      continue;
    }
    if (isToolImageFollowUpMessage(msg)) {
      const prev = out[out.length - 1];
      if (prev?.role !== 'tool') continue;
      out.push(msg);
      continue;
    }
    out.push(msg);
  }
  return out;
}

export function collectTurnText(messages: ApiMessage[], turn: TurnSlice): string {
  const parts: string[] = [];
  for (let i = turn.start; i < turn.end; i += 1) {
    const text = serializeApiMessageForEstimate(messages[i]).trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

export function buildExtractiveSummary(text: string, maxTokens: number): string {
  // Dropped turns are mostly tool payload, so price the char budget at the
  // payload rate — `maxTokens * 4` handed back a third more than it promised.
  const budgetChars = Math.max(32, Math.floor(maxTokens * charsPerTokenFor('payload')));
  const body = text.trim();
  if (!body) return '';
  if (body.length <= budgetChars) return body;
  const headLen = Math.floor(budgetChars * 0.4);
  const tailLen = Math.floor(budgetChars * 0.4);
  return `${body.slice(0, headLen)}\n…\n${body.slice(-tailLen)}`;
}

function truncateMessageContent(msg: ApiMessage, maxChars: number): ApiMessage {
  const marker = TRUNCATION_MARKER;
  if (msg.role === 'system' || msg.role === 'tool') {
    const content = msg.content;
    if (content.length <= maxChars) return msg;
    return { ...msg, content: content.slice(0, maxChars) + marker };
  }
  if (msg.role === 'user') {
    if (typeof msg.content === 'string') {
      if (msg.content.length <= maxChars) return msg;
      return { ...msg, content: msg.content.slice(0, maxChars) + marker };
    }
    if (Array.isArray(msg.content)) {
      const textParts = msg.content.filter((p) => p.type === 'text');
      if (textParts.length === 0) return msg;
      const combined = textParts.map((p) => p.text).join('\n');
      if (combined.length <= maxChars) return msg;
      const trimmed = combined.slice(0, maxChars) + marker;
      const next: ContentPart[] = [{ type: 'text', text: trimmed }];
      for (const part of msg.content) {
        if (part.type === 'image_url') next.push(part);
      }
      return { ...msg, content: next };
    }
    return msg;
  }
  if (msg.role === 'assistant') {
    if (typeof msg.content === 'string' && msg.content.length > maxChars) {
      return { ...msg, content: msg.content.slice(0, maxChars) + marker };
    }
  }
  return msg;
}

function hardTruncateLongestMessage(
  messages: ApiMessage[],
  systemEnd: number,
  limit: number,
): { messages: ApiMessage[]; changed: boolean } {
  let bestIdx = -1;
  let bestLen = 0;
  for (let i = systemEnd; i < messages.length; i += 1) {
    const len = serializeApiMessageForEstimate(messages[i]).length;
    if (len > bestLen) {
      bestLen = len;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return { messages, changed: false };

  const over = estimateApiMessagesTokens(messages) - limit;
  if (over <= 0) return { messages, changed: false };

  // 4 is above every message divisor, so cutting `over * 4` chars always sheds
  // at least `over` tokens whatever the row holds.
  const maxChars = Math.max(32, serializeApiMessageForEstimate(messages[bestIdx]).length - over * 4);
  const next = [...messages];
  next[bestIdx] = truncateMessageContent(messages[bestIdx], maxChars);
  return { messages: next, changed: true };
}

function applyTruncatePolicy(
  messages: ApiMessage[],
  limit: number,
  systemEnd: number,
): { messages: ApiMessage[]; dropped: number } {
  let working = [...messages];
  let dropped = 0;

  while (estimateApiMessagesTokens(working) > limit) {
    let removeAt = -1;
    for (let i = systemEnd; i < working.length; i += 1) {
      if (!isPriorContextSummary(working[i])) {
        removeAt = i;
        break;
      }
    }
    if (removeAt < 0) break;
    const removeEnd = unitEndAt(working, removeAt);
    // Keep the most recent unit intact; hard-truncate its content instead of
    // shredding it into an orphaned tool message.
    if (removeEnd >= working.length) break;
    working = [...working.slice(0, removeAt), ...working.slice(removeEnd)];
    dropped += removeEnd - removeAt;
  }

  if (estimateApiMessagesTokens(working) > limit) {
    const hard = hardTruncateLongestMessage(working, systemEnd, limit);
    if (hard.changed) working = hard.messages;
  }

  return { messages: working, dropped };
}

function applySlidePolicy(
  messages: ApiMessage[],
  limit: number,
  systemEnd: number,
  minRecentTurns: number,
): { messages: ApiMessage[]; dropped: number } {
  let turns = partitionTurns(messages, systemEnd);
  let dropped = 0;

  while (
    estimateApiMessagesTokens(rebuildFromTurns(messages, systemEnd, turns)) > limit &&
    turns.length > minRecentTurns
  ) {
    turns = turns.slice(1);
    dropped += 1;
  }

  let working = rebuildFromTurns(messages, systemEnd, turns);
  if (estimateApiMessagesTokens(working) > limit) {
    const trunc = applyTruncatePolicy(working, limit, systemEnd);
    working = trunc.messages;
    dropped += trunc.dropped;
  }

  return { messages: working, dropped };
}

/** Drop oldest turns until under limit; returns dropped turn text chunks. */
export function dropOldestTurnsUntilUnderLimit(
  messages: ApiMessage[],
  limit: number,
  systemEnd: number,
  minRecentTurns: number,
): { turns: TurnSlice[]; droppedChunks: string[]; droppedTurns: number } {
  let turns = partitionTurns(messages, systemEnd);
  const droppedChunks: string[] = [];
  let droppedTurns = 0;

  while (
    estimateApiMessagesTokens(rebuildFromTurns(messages, systemEnd, turns)) > limit &&
    turns.length > minRecentTurns
  ) {
    droppedChunks.push(collectTurnText(messages, turns[0]));
    turns = turns.slice(1);
    droppedTurns += 1;
  }

  return { turns, droppedChunks, droppedTurns };
}

export function injectSummaryMessage(
  messages: ApiMessage[],
  systemEnd: number,
  summaryBody: string,
): ApiMessage[] {
  const trimmed = summaryBody.trim();
  if (!trimmed) return messages;
  const summaryMsg: ApiMessage = {
    role: 'user',
    content: SUMMARY_HEADER + trimmed,
  };
  return [
    ...messages.slice(0, systemEnd),
    summaryMsg,
    ...messages.slice(systemEnd),
  ];
}

function applyDropMiddlePolicy(
  messages: ApiMessage[],
  limit: number,
  systemEnd: number,
  minRecentTurns: number,
  summaryReserveTokens: number,
): {
  messages: ApiMessage[];
  dropped: number;
  droppedTurns: number;
  summaryInjected: boolean;
  summaryText?: string;
} {
  const { turns, droppedChunks, droppedTurns } = dropOldestTurnsUntilUnderLimit(
    messages,
    limit,
    systemEnd,
    minRecentTurns,
  );

  let working = rebuildFromTurns(messages, systemEnd, turns);
  let summaryInjected = false;
  let summaryText: string | undefined;

  if (droppedChunks.length > 0) {
    const summaryBody = buildExtractiveSummary(
      droppedChunks.join('\n\n'),
      summaryReserveTokens,
    );
    if (summaryBody.trim()) {
      summaryText = summaryBody;
      working = injectSummaryMessage(working, systemEnd, summaryBody);
      summaryInjected = true;
    }
  }

  let dropped = 0;
  if (estimateApiMessagesTokens(working) > limit) {
    const trunc = applyTruncatePolicy(working, limit, systemEnd);
    working = trunc.messages;
    dropped = trunc.dropped;
  }

  return { messages: working, dropped, droppedTurns, summaryInjected, summaryText };
}

export function formatContextTrimStatus(
  policy: ContextEnforcementPolicy,
  droppedTurns: number,
  summaryInjected: boolean,
): string {
  const policyLabel =
    policy === 'summarize'
      ? 'summarized'
      : policy === 'dropMiddle'
        ? 'drop middle'
        : policy;
  const parts: string[] = [`Context trimmed (${policyLabel})`];
  if (droppedTurns > 0) {
    parts.push(
      `omitted ${droppedTurns} older turn${droppedTurns === 1 ? '' : 's'}`,
    );
  }
  if (summaryInjected) parts.push('prior turns compressed');
  return parts.join(': ');
}

export function applyContextBudget(
  messages: ApiMessage[],
  resolved: ResolvedContextBudget,
  agentConfig?: AgentContextBudgetConfig,
): ApplyContextBudgetResult {
  const policy = resolved.policy;
  const tokensBefore = estimateApiMessagesTokens(messages);
  const limit = resolved.effectiveLimit;

  const base = (
    next: ApiMessage[],
    applied: boolean,
    extra: Partial<ApplyContextBudgetResult> = {},
  ): ApplyContextBudgetResult => ({
    messages: next,
    applied,
    policy,
    tokensBefore,
    tokensAfter: estimateApiMessagesTokens(next),
    droppedMessageCount: 0,
    droppedTurns: 0,
    summaryInjected: false,
    statusMessage: null,
    ...extra,
  });

  if (limit == null) {
    return base(messages, false);
  }
  if (tokensBefore <= limit) {
    return base(messages, false);
  }

  // LLM summarize is applied asynchronously via applyContextPolicy.
  if (policy === 'summarize') {
    return base(messages, false);
  }

  const systemEnd = countPinnedSystemMessages(messages);
  const minRecentTurns = Math.max(1, Math.floor(agentConfig?.minRecentTurns ?? 1));
  const summaryReserveTokens = Math.max(
    64,
    Math.floor(agentConfig?.summaryReserveTokens ?? 512),
  );

  let nextMessages = messages;
  let dropped = 0;
  let droppedTurns = 0;
  let summaryInjected = false;
  let summaryText: string | undefined;

  if (policy === 'truncate') {
    const out = applyTruncatePolicy(messages, limit, systemEnd);
    nextMessages = out.messages;
    dropped = out.dropped;
  } else if (policy === 'slide' || policy === 'archive') {
    const out = applySlidePolicy(messages, limit, systemEnd, minRecentTurns);
    nextMessages = out.messages;
    dropped = out.dropped;
    droppedTurns = out.dropped;
  } else if (policy === 'dropMiddle') {
    const out = applyDropMiddlePolicy(
      messages,
      limit,
      systemEnd,
      minRecentTurns,
      summaryReserveTokens,
    );
    nextMessages = out.messages;
    dropped = out.dropped;
    droppedTurns = out.droppedTurns;
    summaryInjected = out.summaryInjected;
    summaryText = out.summaryText;
  }

  let tokensAfter = estimateApiMessagesTokens(nextMessages);
  let tightenPasses = 0;
  while (tokensAfter > limit && tightenPasses < 16) {
    const trunc = applyTruncatePolicy(nextMessages, limit, systemEnd);
    nextMessages = trunc.messages;
    dropped += trunc.dropped;
    tokensAfter = estimateApiMessagesTokens(nextMessages);
    if (tokensAfter > limit) {
      const hard = hardTruncateLongestMessage(nextMessages, systemEnd, limit);
      if (hard.changed) {
        nextMessages = hard.messages;
        tokensAfter = estimateApiMessagesTokens(nextMessages);
      }
    }
    tightenPasses += 1;
    if (tokensAfter <= limit) break;
  }

  const sanitized = sanitizeToolPairing(nextMessages);
  if (sanitized.length !== nextMessages.length) {
    nextMessages = sanitized;
    tokensAfter = estimateApiMessagesTokens(nextMessages);
  }

  return {
    messages: nextMessages,
    applied: true,
    policy,
    tokensBefore,
    tokensAfter,
    droppedMessageCount: dropped,
    droppedTurns,
    summaryInjected,
    summaryText,
    statusMessage: formatContextTrimStatus(policy, droppedTurns, summaryInjected),
  };
}
