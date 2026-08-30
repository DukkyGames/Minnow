/**
 * Renderer adapter for the shared sub-agent runner (MIN-698).
 *
 * The turn loop lives in `server/runner/`. This file injects the existing
 * renderer I/O (session store, `/api/generations`, headless tool batch) so
 * normal chat's sub-agents keep working unchanged.
 *
 * Import from `server/runner/index.js` (isomorphic). Do not import
 * `server/runner/node.js` — Vite follows that barrel into the tool server.
 */

import { createSubAgentRunner, cloneSubAgentMessages } from '../../server/runner/index.js';
import type { SubAgentRunner } from './types';
import { findChatById } from '../state/sessions';
import { postChatCompletions } from '../providers/fetch-chat';
import { runHeadlessToolBatch } from '../tools/headless-tool-batch';
import { resolveProvider } from '../providers/store';
import { getSubAgentTypeConfig } from './sub-agent-config';
import { resolveSamplerPreset } from './resolve-sampler';
import { resolveThinkingMode, resolveThinkingBudgetTokens } from './resolve-thinking';
import {
  getToolCallsMetaSync,
  isConstrainedDecodingEnabledForProvider,
  loadToolCallsMeta,
} from '../config/tool-calls-meta';
import {
  isStructuredOutcomeResponseFormatAvailable,
  readProviderCapabilities,
} from '../providers/capability-probe';
import { resolveSendCapabilities } from '../providers/model-capabilities';
import { getModelRowForSelectOrCanonicalId } from '../api/models';
import { contextLengthFromModelRow } from '../lib/context-length';
import { applyContextPolicy } from '../chat/context/apply-policy';
import { isVisionModel } from '../providers/vision-model';
import { recordSubAgentTurnUsage } from '../usage/record-chat-usage';
import { reportBackgroundError } from '../boot/report-background-error';
import type { TranscriptStore } from '../../server/runner/transcript-store';
import type {
  PostChatCompletionsOptions,
  RunnerDeps,
  RunnerProvider,
} from '../../server/runner/adapters';

export { cloneSubAgentMessages };

/** Session-store wrapper — the only sessions.ts coupling the runner used to have. */
function createSessionTranscriptStore(): TranscriptStore {
  return {
    load(chatId) {
      const chat = findChatById(chatId);
      if (!chat) return null;
      return {
        messages: chat.history ?? [],
        meta: {
          thinkingMode: chat.thinkingMode,
          reasoningEffort: chat.reasoningEffort,
        },
      };
    },
    append(chatId, message) {
      const chat = findChatById(chatId);
      if (!chat) return;
      chat.history.push(message as (typeof chat.history)[number]);
    },
    setMeta(chatId, meta) {
      const chat = findChatById(chatId);
      if (!chat) return;
      if (meta.thinkingMode !== undefined) {
        chat.thinkingMode = meta.thinkingMode as typeof chat.thinkingMode;
      }
      if (meta.reasoningEffort !== undefined) {
        chat.reasoningEffort = meta.reasoningEffort as typeof chat.reasoningEffort;
      }
    },
  };
}

function resolveModelContextLimit(modelId: string): number | null {
  const id = modelId.trim();
  if (!id) return null;
  const cached = getModelRowForSelectOrCanonicalId(id);
  if (!cached) return null;
  return contextLengthFromModelRow(cached) ?? null;
}

/** Default runner: LM Studio stream + nested tools, wired to renderer stores. */
export const defaultSubAgentRunner: SubAgentRunner = createSubAgentRunner({
  transcriptStore: createSessionTranscriptStore(),
  postChatCompletions: (
    provider: RunnerProvider,
    body: Record<string, unknown>,
    signal: AbortSignal,
    options?: PostChatCompletionsOptions,
  ) =>
    postChatCompletions(
      provider as unknown as Parameters<typeof postChatCompletions>[0],
      body as unknown as Parameters<typeof postChatCompletions>[1],
      signal,
      options,
    ),
  runHeadlessToolBatch: (options: Parameters<RunnerDeps['runHeadlessToolBatch']>[0]) =>
    runHeadlessToolBatch(options as unknown as Parameters<typeof runHeadlessToolBatch>[0]),
  resolveProvider,
  getSubAgentTypeConfig,
  resolveSamplerPreset,
  resolveThinkingMode,
  resolveThinkingBudgetTokens,
  loadToolCallsMeta,
  getToolCallsMetaSync,
  isConstrainedDecodingEnabledForProvider,
  readProviderCapabilities,
  isStructuredOutcomeResponseFormatAvailable,
  resolveSendCapabilities,
  resolveModelContextLimit,
  getModelRow: getModelRowForSelectOrCanonicalId,
  applyContextPolicy,
  isVisionModel,
  recordTurnUsage: async (input: unknown, turn: unknown) => {
    const parentChatId =
      input && typeof input === 'object' && 'parentChatId' in input
        ? (input as { parentChatId?: string | null }).parentChatId
        : undefined;
    await recordSubAgentTurnUsage(
      parentChatId,
      turn as Parameters<typeof recordSubAgentTurnUsage>[1],
    );
  },
  reportBackgroundError,
} as unknown as RunnerDeps);

let runnerFactory: () => SubAgentRunner = () => defaultSubAgentRunner;

/** Inject mock runner for deterministic tests. */
export function setSubAgentRunnerFactory(factory: () => SubAgentRunner): void {
  runnerFactory = factory;
}

export function resetSubAgentRunnerFactory(): void {
  runnerFactory = () => defaultSubAgentRunner;
}

/** Resolve active runner implementation. */
export function getSubAgentRunner(): SubAgentRunner {
  return runnerFactory();
}
