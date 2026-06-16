/**
 * Per-agent input token budgets and pre-send enforcement (MIN-39).
 * Pure helpers — safe for Node tests (no DOM).
 */

import { apiMessageContentToText, contentPartsToText } from '../api/message-content.ts';
import { estimateTokensFromText } from './prompts/token-estimate-core';
import type { ApiMessage, ContentPart } from '../types';

import type { ArchiveConfig } from './archive/types';

/** How to fit outbound messages under a token ceiling. */
export type ContextEnforcementPolicy = 'summarize' | 'slide' | 'truncate' | 'archive';

/** Shipped default when a row omits policy. */
export const DEFAULT_CONTEXT_ENFORCEMENT_POLICY: ContextEnforcementPolicy = 'slide';

const SAFETY_MARGIN = 0.9;
const TRUNCATION_MARKER = '[… truncated for context budget]';
const SUMMARY_HEADER = '## Prior context (compressed)\n';

/** Agent-level budget declaration (work agents + sub-agent types). */
export interface AgentContextBudgetConfig {
  maxInputTokens: number | null;
  enforcementPolicy: ContextEnforcementPolicy;
  minRecentTurns?: number;
  summaryReserveTokens?: number;
  /** Tuning when enforcementPolicy is `archive` (MIN-139). */
  archive?: ArchiveConfig;
}

export interface ResolvedContextBudget {
  effectiveLimit: number | null;
  agentCap: number | null;
  modelLimit: number | null;
  policy: ContextEnforcementPolicy;
}

export interface ApplyContextBudgetResult {
  messages: ApiMessage[];
  applied: boolean;
  policy: ContextEnforcementPolicy;
  tokensBefore: number;
  tokensAfter: number;
  droppedMessageCount: number;
  summaryInjected: boolean;
  statusMessage: string | null;
}

interface TurnSlice {
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
      let extra = 0;
      for (const part of msg.content) {
        if (part.type === 'image_url') extra += 256;
      }
      return text + ' '.repeat(extra);
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

export function estimateApiMessagesTokens(messages: ApiMessage[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateTokensFromText(serializeApiMessageForEstimate(msg));
  }
  return total;
}

export function agentContextBudgetFromWorkAgent(agent: {
  maxInputTokens?: number | null;
  contextEnforcementPolicy?: ContextEnforcementPolicy | null;
  minRecentTurns?: number;
  summaryReserveTokens?: number;
  archive?: ArchiveConfig;
}): AgentContextBudgetConfig {
  return {
    maxInputTokens: normalizePositiveInt(agent.maxInputTokens ?? null),
    enforcementPolicy:
      agent.contextEnforcementPolicy ?? DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
    minRecentTurns: agent.minRecentTurns,
    summaryReserveTokens: agent.summaryReserveTokens,
    archive: agent.archive,
  };
}

export function agentContextBudgetFromSubAgentType(
  type: Parameters<typeof agentContextBudgetFromWorkAgent>[0],
): AgentContextBudgetConfig {
  return agentContextBudgetFromWorkAgent(type);
}

export function resolveContextBudget(params: {
  agentConfig: AgentContextBudgetConfig;
  modelLimit: number | null;
}): ResolvedContextBudget {
  const policy = params.agentConfig.enforcementPolicy ?? DEFAULT_CONTEXT_ENFORCEMENT_POLICY;
  const agentCap = normalizePositiveInt(params.agentConfig.maxInputTokens);
  const modelLimit = normalizePositiveInt(params.modelLimit);

  let effectiveLimit: number | null = null;
  if (agentCap != null) {
    const raw = modelLimit != null ? Math.min(agentCap, modelLimit) : agentCap;
    effectiveLimit = Math.max(1, Math.floor(raw * SAFETY_MARGIN));
  }

  return { effectiveLimit, agentCap, modelLimit, policy };
}

function isPriorContextSummary(msg: ApiMessage): boolean {
  return (
    msg.role === 'user' &&
    typeof msg.content === 'string' &&
    msg.content.startsWith(SUMMARY_HEADER)
  );
}

function countPinnedSystemMessages(messages: ApiMessage[]): number {
  let n = 0;
  for (const msg of messages) {
    if (msg.role === 'system') n += 1;
    else break;
  }
  return n;
}

function partitionTurns(messages: ApiMessage[], systemEnd: number): TurnSlice[] {
  const turns: TurnSlice[] = [];
  let i = systemEnd;
  while (i < messages.length) {
    if (messages[i].role !== 'user') {
      turns.push({ start: i, end: i + 1 });
      i += 1;
      continue;
    }
    const start = i;
    i += 1;
    while (i < messages.length && messages[i].role !== 'user') {
      i += 1;
    }
    turns.push({ start, end: i });
  }
  return turns;
}

function rebuildFromTurns(
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

function collectTurnText(messages: ApiMessage[], turn: TurnSlice): string {
  const parts: string[] = [];
  for (let i = turn.start; i < turn.end; i += 1) {
    const text = serializeApiMessageForEstimate(messages[i]).trim();
    if (text) parts.push(text);
  }
  return parts.join('\n\n');
}

function buildExtractiveSummary(text: string, maxTokens: number): string {
  const budgetChars = Math.max(32, maxTokens * 4);
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

  while (
    estimateApiMessagesTokens(working) > limit &&
    working.length > systemEnd + 1
  ) {
    let removeAt = -1;
    for (let i = systemEnd; i < working.length; i += 1) {
      if (!isPriorContextSummary(working[i])) {
        removeAt = i;
        break;
      }
    }
    if (removeAt < 0) break;
    working = [...working.slice(0, removeAt), ...working.slice(removeAt + 1)];
    dropped += 1;
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

function applySummarizePolicy(
  messages: ApiMessage[],
  limit: number,
  systemEnd: number,
  minRecentTurns: number,
  summaryReserveTokens: number,
): { messages: ApiMessage[]; dropped: number; summaryInjected: boolean } {
  let turns = partitionTurns(messages, systemEnd);
  const droppedChunks: string[] = [];
  let dropped = 0;

  while (
    estimateApiMessagesTokens(rebuildFromTurns(messages, systemEnd, turns)) > limit &&
    turns.length > minRecentTurns
  ) {
    droppedChunks.push(collectTurnText(messages, turns[0]));
    turns = turns.slice(1);
    dropped += 1;
  }

  let working = rebuildFromTurns(messages, systemEnd, turns);
  let summaryInjected = false;

  if (droppedChunks.length > 0) {
    const summaryBody = buildExtractiveSummary(
      droppedChunks.join('\n\n'),
      summaryReserveTokens,
    );
    if (summaryBody.trim()) {
      const summaryMsg: ApiMessage = {
        role: 'user',
        content: SUMMARY_HEADER + summaryBody,
      };
      working = [
        ...working.slice(0, systemEnd),
        summaryMsg,
        ...working.slice(systemEnd),
      ];
      summaryInjected = true;
    }
  }

  if (estimateApiMessagesTokens(working) > limit) {
    const trunc = applyTruncatePolicy(working, limit, systemEnd);
    working = trunc.messages;
    dropped += trunc.dropped;
  }

  return { messages: working, dropped, summaryInjected };
}

export function formatContextTrimStatus(
  policy: ContextEnforcementPolicy,
  droppedMessageCount: number,
  summaryInjected: boolean,
): string {
  const parts: string[] = [`Context trimmed (${policy})`];
  if (droppedMessageCount > 0) {
    parts.push(
      `dropped ${droppedMessageCount} older message${droppedMessageCount === 1 ? '' : 's'}`,
    );
  }
  if (summaryInjected) parts.push('prior turns summarized');
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
    summaryInjected: false,
    statusMessage: null,
    ...extra,
  });

  if (limit == null || resolved.agentCap == null) {
    return base(messages, false);
  }
  if (tokensBefore <= limit) {
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
  let summaryInjected = false;

  if (policy === 'truncate') {
    const out = applyTruncatePolicy(messages, limit, systemEnd);
    nextMessages = out.messages;
    dropped = out.dropped;
  } else if (policy === 'slide' || policy === 'archive') {
    const out = applySlidePolicy(messages, limit, systemEnd, minRecentTurns);
    nextMessages = out.messages;
    dropped = out.dropped;
  } else {
    const out = applySummarizePolicy(
      messages,
      limit,
      systemEnd,
      minRecentTurns,
      summaryReserveTokens,
    );
    nextMessages = out.messages;
    dropped = out.dropped;
    summaryInjected = out.summaryInjected;
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

  return {
    messages: nextMessages,
    applied: true,
    policy,
    tokensBefore,
    tokensAfter,
    droppedMessageCount: dropped,
    summaryInjected,
    statusMessage: formatContextTrimStatus(policy, dropped, summaryInjected),
  };
}
