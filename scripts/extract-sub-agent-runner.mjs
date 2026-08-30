#!/usr/bin/env node
/**
 * Convert `src/agents/sub-agent-runner.ts` into `server/runner/sub-agent-runner.js`.
 * One-shot extract helper used by P2-A — not a production build step.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'src', 'agents', 'sub-agent-runner.ts');
const OUT = path.join(ROOT, 'server', 'runner', 'sub-agent-runner.js');

const NEW_IMPORTS = `/**
 * Isolated sub-agent completion + tool loop (no parent chat history).
 *
 * I/O is injected via {@link createSubAgentRunner} so this module never imports
 * \`src/\`, the session store, or a board.
 */

import {
  extractAssistantCompletionText,
  extractStreamDelta,
  finalizeToolCalls,
  mergeStreamMeta,
  mergeToolCallDelta,
} from './stream-parse.js';
import {
  createSseEventBuffer,
  feedSseEventBuffer,
  flushSseEventBuffer,
  parseCompletionResponseBody,
} from './sse-parse.js';
import { applyClassifiedStreamEnd, classifyStreamEnd } from './stream-end.js';
import { repairUnpairedToolCalls } from './provider-message-normalize.js';
import {
  extractInlineThinkingFromContent,
  HarmonyChannelRouter,
  InlineContentThinkingRouter,
  modelLikelyUsesInlineThinking,
} from './inline-thinking.js';
import {
  extractReasoningDelta,
  extractReasoningMessage,
  modelRequiresReasoningContentReplay,
  outboundReasoningReplayFields,
} from './reasoning.js';
import {
  applyConstrainedToolCallsToBody,
  isResponseFormatRejectionError,
  stripResponseFormatFromBody,
} from './constrained-tool-calls.js';
import { mergeContentJsonToolCalls } from './constrained-tool-content.js';
import {
  ContentToolCallRouter,
  hasXmlToolCallMarkup,
  stripXmlToolCallBlocks,
} from './xml-tool-calls.js';
import { sanitizeCompletionBodyForProvider } from '../providers/sanitize-completion-body.js';
import { toolImageFollowUpFromAttachments } from './tool-image-follow-up.js';
import { resolveModelApi } from '../generations/resolve-model-api.js';
import {
  DEFAULT_CONTEXT_ENFORCEMENT_POLICY,
  estimateApiMessagesTokens,
  resolveContextBudget,
} from './context-budget.js';
import { estimateToolsTokens } from './token-estimate-core.js';
import { SUB_AGENT_CONTEXT_BUDGET_ERROR } from './sub-agent-outcome.js';
import { buildSubAgentOutcomeResponseFormat } from './sub-agent-outcome-response-format.js';
import {
  buildSubAgentFinalizationPrompt,
  legacyOutcomeFromSummary,
  parseStructuredOutcomeJson,
  SUB_AGENT_STRUCTURED_OUTCOME_REPAIR_PROMPT,
  tryParseStructuredOutcomeFromAssistantProse,
  validateStructuredOutcome,
} from './sub-agent-structured-outcome.js';
import { averageStatsSegments, sumUsageSegments } from './stats-math.js';
import { looksLikeProseStructuredQuestion } from './prose-question-detect.js';
import {
  EMPTY_POST_TOOL_CONTINUE_INSTRUCTION,
  hasPostToolTail,
  MAX_EMPTY_POST_TOOL_RETRIES,
  MAX_PROSE_QUESTION_RETRIES,
  PROSE_QUESTION_RETRY_INSTRUCTION,
  SUB_AGENT_TOOL_USE_NUDGE_INSTRUCTION,
} from './turn-continuation.js';
import { mergeThinkingIntoCompletionBody } from './merge-thinking-body.js';
import {
  ThinkingBudgetTracker,
  buildBudgetContinuationMessages,
  buildThinkingPrefillAssistantMessage,
  stripCarriedTextEcho,
  stripPrefillEchoFromDelta,
} from './thinking-budget.js';
import { retryOnceOnTransientFetch } from './transient-fetch-retry.js';
import { LLAMA_CPP_LOCAL_PROVIDER_ID } from './provider-ids.js';
import { applySamplerToBody } from './sampler-types.js';
import {
  modelUsesComposerReasoningDropdown,
  resolveEffectiveReasoningEffort,
} from './reasoning-effort.js';
`;

const DEPS_ALIASES = `
export function createSubAgentRunner(deps) {
  const postChatCompletions = (provider, body, signal, options) =>
    deps.postChatCompletions(provider, body, signal, options);
  const runHeadlessToolBatch = (options) => deps.runHeadlessToolBatch(options);
  const resolveProvider = (id) => deps.resolveProvider(id);
  const getSubAgentTypeConfig = (type) => deps.getSubAgentTypeConfig(type);
  const resolveSamplerPreset = (input) => deps.resolveSamplerPreset(input);
  const resolveThinkingMode = (input) => deps.resolveThinkingMode(input);
  const resolveThinkingBudgetTokens = (input) => deps.resolveThinkingBudgetTokens(input);
  const loadToolCallsMeta = () => deps.loadToolCallsMeta();
  const getToolCallsMetaSync = () => deps.getToolCallsMetaSync();
  const isConstrainedDecodingEnabledForProvider = (provider, meta) =>
    deps.isConstrainedDecodingEnabledForProvider(provider, meta);
  const readProviderCapabilities = (id) => deps.readProviderCapabilities(id);
  const isStructuredOutcomeResponseFormatAvailable = (modelId, caps) =>
    deps.isStructuredOutcomeResponseFormatAvailable(modelId, caps);
  const resolveSendCapabilities = (providerId, modelId, apiKind) =>
    deps.resolveSendCapabilities(providerId, modelId, apiKind);
  const applyContextPolicy = (input) => deps.applyContextPolicy(input);
  const isVisionModel = (modelId) => deps.isVisionModel?.(modelId) === true;
  const getModelRowForSelectOrCanonicalId = (id) => deps.getModelRow?.(id) ?? null;
  const recordSubAgentTurnUsage = (parentChatId, payload) =>
    deps.recordTurnUsage?.({ parentChatId, ...payload }, payload) ?? Promise.resolve();
  const reportBackgroundError = (kind, detail) => deps.reportBackgroundError?.(kind, detail);
  function findChatById(chatId) {
    return deps.transcriptStore.load(chatId)?.meta;
  }
  async function tryNonStreamingFallback(body, signal, providerId) {
    const provider = await resolveProvider(providerId);
    const res = await postChatCompletions(
      provider,
      { ...body, stream: false },
      signal,
      { stream: false, fallbackRole: 'sub-agent' },
    );
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`);
    return parseCompletionResponseBody(await res.text());
  }
`;

async function main() {
  let source = fs.readFileSync(SRC, 'utf8');
  if (source.includes('Renderer adapter for the shared sub-agent runner')) {
    throw new Error(
      'src/agents/sub-agent-runner.ts is already the P2-A adapter; refusing to overwrite server/runner/sub-agent-runner.js',
    );
  }
  const importEnd = source.indexOf('/** Prefer main `content`');
  if (importEnd < 0) throw new Error('could not find body start marker');
  source = NEW_IMPORTS + '\n' + source.slice(importEnd);

  source = source.replace(
    /\/\*\* Dev-only logging when `localStorage\.minnowDebugSubAgent === '1'`\. \*\/\r?\nfunction logSubAgentDebug\(event: string, detail\?: Record<string, unknown>\): void \{[\s\S]*?\n\}/,
    `function logSubAgentDebug(event, detail) {\n  void event;\n  void detail;\n}`,
  );

  source = source.replace(
    /function resolveSubAgentModelContextLimit\(modelId: string\): number \| null \{[\s\S]*?\n\}/,
    `function resolveSubAgentModelContextLimit(modelId) {
  const id = modelId.trim();
  if (!id) return null;
  if (deps.resolveModelContextLimit) return deps.resolveModelContextLimit(id);
  return null;
}`,
  );

  source = source.replace('export function cloneSubAgentMessages', 'function cloneSubAgentMessages');
  source = source.replace('export const defaultSubAgentRunner: SubAgentRunner = {', 'const defaultSubAgentRunner = {');

  const factoryAt = source.indexOf('\nlet runnerFactory');
  if (factoryAt < 0) throw new Error('could not find runnerFactory');
  source = source.slice(0, factoryAt) + '\n  return defaultSubAgentRunner;\n}\n';

  const bodyStart = source.indexOf('/** Prefer main `content`');
  source = source.slice(0, bodyStart) + DEPS_ALIASES + '\n' + source.slice(bodyStart);

  source += `
export function cloneSubAgentMessages(messages) {
  return structuredClone(messages);
}
`;

  const transpiled = await esbuild.transform(source, {
    loader: 'ts',
    format: 'esm',
    target: 'es2022',
    sourcefile: SRC,
  });
  fs.writeFileSync(OUT, transpiled.code);
  console.log('wrote', path.relative(ROOT, OUT));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
