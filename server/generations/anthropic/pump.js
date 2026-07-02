/**
 * Anthropic Messages bridge — OpenAI Chat Completions in, OpenAI SSE out.
 */

import { APICallError } from '@ai-sdk/provider';
import { generateText as defaultGenerateText, streamText as defaultStreamText } from 'ai';
import { classifyUpstreamError } from '../fallback.js';
import { isHostDead, markHostDead, originFromUrl } from '../host-cooldown.js';
import {
  appendChunk,
  markComplete,
  markError,
  markStreaming,
  noteGenerationCandidateChosen,
} from '../store.js';
import { generationTimeoutMessage } from '../timeouts.js';
import { formatUpstreamHttpErrorMessage } from '../upstream-error-detail.js';
import { openAiMessagesToCoreMessages } from './openai-to-core-messages.js';
import {
  createOpenAiSseEncoder,
  encodeNonStreamingCompletion,
  encodeOpenAiSseDone,
  encodeUsageSseChunk,
} from './openai-sse-encoder.js';
import { mapOpenAiToolChoice, mapOpenAiTools } from './openai-tools.js';
import {
  buildAnthropicProvider as defaultBuildAnthropicProvider,
  deriveAnthropicBaseUrl,
} from './provider-runtime.js';

export { deriveAnthropicBaseUrl };

/** @type {typeof defaultGenerateText} */
let generateText = defaultGenerateText;
/** @type {typeof defaultStreamText} */
let streamText = defaultStreamText;
/** @type {typeof defaultBuildAnthropicProvider} */
let buildAnthropicProvider = defaultBuildAnthropicProvider;

/**
 * Test hook: override AI SDK entry points without module mocking.
 * @param {{
 *   generateText?: typeof defaultGenerateText,
 *   streamText?: typeof defaultStreamText,
 *   buildAnthropicProvider?: typeof defaultBuildAnthropicProvider,
 * }} mocks
 */
export function __setAnthropicPumpMocksForTests(mocks = {}) {
  if (mocks.generateText) generateText = mocks.generateText;
  if (mocks.streamText) streamText = mocks.streamText;
  if (mocks.buildAnthropicProvider) buildAnthropicProvider = mocks.buildAnthropicProvider;
}

/** Restore production AI SDK bindings after tests. */
export function __resetAnthropicPumpMocksForTests() {
  generateText = defaultGenerateText;
  streamText = defaultStreamText;
  buildAnthropicProvider = defaultBuildAnthropicProvider;
}

/**
 * @param {Record<string, unknown>} body
 * @returns {import('@ai-sdk/provider-utils').ProviderOptions | undefined}
 */
function buildProviderOptions(body) {
  /** @type {Record<string, Record<string, unknown>>} */
  const options = {};

  if (body.providerOptions && typeof body.providerOptions === 'object') {
    for (const [provider, value] of Object.entries(
      /** @type {Record<string, unknown>} */ (body.providerOptions),
    )) {
      if (value && typeof value === 'object') {
        options[provider] = { .../** @type {Record<string, unknown>} */ (value) };
      }
    }
  }

  if (body.thinking && typeof body.thinking === 'object') {
    options.anthropic = {
      ...(options.anthropic || {}),
      thinking: body.thinking,
    };
  }

  return Object.keys(options).length > 0 ? options : undefined;
}

/**
 * @param {Record<string, unknown>} body
 * @param {import('@ai-sdk/anthropic').AnthropicProvider} provider
 * @param {AbortSignal} abortSignal
 * @returns {Record<string, unknown>}
 */
function buildGenerationCallOptions(body, provider, abortSignal) {
  const modelId = typeof body.model === 'string' ? body.model : '';
  const messages = openAiMessagesToCoreMessages(body.messages);
  const tools = mapOpenAiTools(body.tools);
  const toolChoice = mapOpenAiToolChoice(body.tool_choice);
  const providerOptions = buildProviderOptions(body);

  /** @type {Record<string, unknown>} */
  const options = {
    model: provider(modelId),
    messages,
    abortSignal,
    allowSystemInMessages: true,
  };

  if (tools) {
    options.tools = tools;
    if (toolChoice) options.toolChoice = toolChoice;
  }
  if (typeof body.max_tokens === 'number') {
    options.maxOutputTokens = body.max_tokens;
  }
  if (typeof body.temperature === 'number') {
    options.temperature = body.temperature;
  }
  if (typeof body.top_p === 'number') {
    options.topP = body.top_p;
  }
  if (providerOptions) {
    options.providerOptions = providerOptions;
  }

  return options;
}

/**
 * @param {unknown} err
 * @returns {{ kind: 'retryable' | 'fatal', message: string }}
 */
function classifySdkError(err) {
  if (err instanceof APICallError || (err && typeof err === 'object' && err.name === 'APICallError')) {
    const apiErr = /** @type {APICallError} */ (err);
    const status = apiErr.statusCode;
    const message = formatUpstreamHttpErrorMessage(
      status || 500,
      typeof apiErr.responseBody === 'string' ? apiErr.responseBody : apiErr.message,
    );
    return classifyUpstreamError(err, typeof status === 'number' ? { status } : undefined);
  }
  return classifyUpstreamError(err);
}

/**
 * @param {Buffer} requestBody
 * @returns {Record<string, unknown>}
 */
function parseOpenAiRequestBody(requestBody) {
  const parsed = JSON.parse(requestBody.toString('utf8'));
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Invalid chat completion request body');
  }
  // v1 bridge does not map structured output yet.
  if ('response_format' in parsed) {
    const { response_format: _ignored, ...rest } = /** @type {Record<string, unknown>} */ (parsed);
    return rest;
  }
  return /** @type {Record<string, unknown>} */ (parsed);
}

/**
 * Pump an Anthropic Messages upstream via the AI SDK and buffer OpenAI-shaped SSE.
 *
 * @param {{
 *   state: import('../store.js').GenerationState,
 *   runtime: { profile: object, paths: object, secrets: object },
 *   candidate: { providerId: string, modelId: string },
 *   index: number,
 *   idleMs: number,
 *   maxMs: number,
 *   cooldownSeconds: number,
 *   canFailover: boolean,
 * }} params
 * @returns {Promise<{ outcome: 'complete' | 'retry' | 'fatal', message?: string }>}
 */
export async function pumpAnthropicUpstream({
  state,
  runtime,
  candidate,
  index,
  idleMs,
  maxMs,
  cooldownSeconds,
  canFailover,
}) {
  const controller = new AbortController();
  state.upstreamController = controller;

  const origin = originFromUrl(runtime.profile.baseUrl);
  /** @type {'idle' | 'max' | null} */
  let timeoutKind = null;
  let idleTimer = null;
  let bytesEmitted = false;

  const armIdleTimeout = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timeoutKind = 'idle';
      controller.abort();
    }, idleMs);
  };

  const maxTimer = setTimeout(() => {
    timeoutKind = 'max';
    controller.abort();
  }, maxMs);

  armIdleTimeout();

  try {
    if (state.status === 'cancelled') {
      return { outcome: 'complete' };
    }

    if (isHostDead(origin)) {
      const message = `Host in cooldown: ${origin}`;
      if (canFailover) return { outcome: 'retry', message };
      return { outcome: 'fatal', message };
    }

    markStreaming(state);

    const body = parseOpenAiRequestBody(state.requestBody);
    if (candidate.modelId) {
      body.model = candidate.modelId;
    }

    const anthropic = buildAnthropicProvider(runtime);
    const callOptions = buildGenerationCallOptions(body, anthropic, controller.signal);
    const stream = body.stream === true;

    if (stream) {
      const result = streamText(
        /** @type {Parameters<typeof streamText>[0]} */ (callOptions),
      );
      const encoder = createOpenAiSseEncoder();
      /** @type {import('ai').LanguageModelUsage | undefined} */
      let lastUsage;
      /** @type {import('ai').FinishReason | undefined} */
      let lastFinishReason;

      for await (const part of result.fullStream) {
        if (state.status === 'cancelled' || state.status === 'error') {
          return { outcome: 'complete' };
        }

        armIdleTimeout();

        if (part.type === 'finish') {
          lastUsage = part.totalUsage;
          lastFinishReason = part.finishReason;
          continue;
        }

        const encoded = encoder.encodeStreamPart(part);
        if (encoded) {
          if (!bytesEmitted) {
            bytesEmitted = true;
            noteGenerationCandidateChosen(state, {
              providerId: candidate.providerId,
              modelId: candidate.modelId,
              index,
            });
          }
          appendChunk(state, Buffer.from(encoded, 'utf8'));
        }
      }

      if (lastUsage && !bytesEmitted) {
        noteGenerationCandidateChosen(state, {
          providerId: candidate.providerId,
          modelId: candidate.modelId,
          index,
        });
      }

      if (lastUsage) {
        appendChunk(
          state,
          Buffer.from(encodeUsageSseChunk(lastUsage, lastFinishReason), 'utf8'),
        );
      } else if (lastFinishReason) {
        appendChunk(
          state,
          Buffer.from(
            encodeUsageSseChunk(undefined, lastFinishReason),
            'utf8',
          ),
        );
      }
      appendChunk(state, Buffer.from(encodeOpenAiSseDone(), 'utf8'));

      if (state.status !== 'error' && state.status !== 'cancelled') {
        markComplete(state);
      }
      return { outcome: 'complete' };
    }

    const result = await generateText(
      /** @type {Parameters<typeof generateText>[0]} */ (callOptions),
    );

    noteGenerationCandidateChosen(state, {
      providerId: candidate.providerId,
      modelId: candidate.modelId,
      index,
    });

    const completion = encodeNonStreamingCompletion({
      model: typeof body.model === 'string' ? body.model : candidate.modelId,
      text: result.text,
      reasoningText: result.reasoningText,
      toolCalls: result.toolCalls,
      finishReason: result.finishReason,
      usage: result.usage,
    });

    appendChunk(state, Buffer.from(JSON.stringify(completion), 'utf8'));
    markComplete(state);
    return { outcome: 'complete' };
  } catch (err) {
    if (state.status === 'cancelled') {
      return { outcome: 'complete' };
    }

    if (timeoutKind) {
      const message = generationTimeoutMessage({ idleMs, maxMs }, timeoutKind);
      if (!bytesEmitted && canFailover) {
        markHostDead(origin, cooldownSeconds);
        return { outcome: 'retry', message };
      }
      return { outcome: 'fatal', message };
    }

    const classified = classifySdkError(err);
    if (!bytesEmitted && classified.kind === 'retryable' && canFailover) {
      markHostDead(origin, cooldownSeconds);
      return { outcome: 'retry', message: classified.reason };
    }

    if (!bytesEmitted) {
      markError(state, classified.reason);
    }
    return { outcome: 'fatal', message: classified.reason };
  } finally {
    if (idleTimer) clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    if (state.upstreamController === controller) {
      state.upstreamController = null;
    }
  }
}
