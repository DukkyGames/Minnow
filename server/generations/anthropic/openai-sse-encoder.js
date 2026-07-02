/**
 * Encode AI SDK stream parts as OpenAI chat-completion SSE lines.
 */

/**
 * @param {import('ai').LanguageModelUsage | undefined} usage
 * @returns {{ prompt_tokens?: number, completion_tokens?: number, total_tokens?: number } | undefined}
 */
export function mapOpenAiUsage(usage) {
  if (!usage) return undefined;
  const promptTokens = usage.inputTokens;
  const completionTokens = usage.outputTokens;
  const totalTokens =
    usage.totalTokens ??
    (typeof promptTokens === 'number' && typeof completionTokens === 'number'
      ? promptTokens + completionTokens
      : undefined);

  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: totalTokens,
  };
}

/**
 * @param {import('ai').FinishReason | string | undefined} finishReason
 * @returns {string | null}
 */
export function mapOpenAiFinishReason(finishReason) {
  switch (finishReason) {
    case 'stop':
      return 'stop';
    case 'length':
      return 'length';
    case 'tool-calls':
      return 'tool_calls';
    case 'content-filter':
      return 'content_filter';
    default:
      return finishReason ? String(finishReason) : null;
  }
}

/**
 * @param {Record<string, unknown>} chunk
 * @returns {string}
 */
export function encodeOpenAiSseChunk(chunk) {
  return `data: ${JSON.stringify(chunk)}\n\n`;
}

/**
 * @returns {string}
 */
export function encodeOpenAiSseDone() {
  return 'data: [DONE]\n\n';
}

/**
 * Stateful encoder that tracks tool-call indices for mergeToolCallDelta compatibility.
 */
export function createOpenAiSseEncoder() {
  /** @type {Map<string, number>} */
  const toolIdToIndex = new Map();
  let nextToolIndex = 0;

  /**
   * @param {string} toolCallId
   * @returns {number}
   */
  function indexForToolCall(toolCallId) {
    if (!toolIdToIndex.has(toolCallId)) {
      toolIdToIndex.set(toolCallId, nextToolIndex);
      nextToolIndex += 1;
    }
    return /** @type {number} */ (toolIdToIndex.get(toolCallId));
  }

  /**
   * @param {Record<string, unknown>} delta
   * @param {string} toolCallId
   * @returns {string}
   */
  function encodeToolDelta(delta, toolCallId) {
    const index = indexForToolCall(toolCallId);
    return encodeOpenAiSseChunk({
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index,
                ...delta,
              },
            ],
          },
        },
      ],
    });
  }

  /**
   * @param {Record<string, unknown>} part
   * @returns {string | null}
   */
  function encodeStreamPart(part) {
    switch (part.type) {
      case 'text-delta':
        return encodeOpenAiSseChunk({
          choices: [{ index: 0, delta: { content: part.text } }],
        });

      case 'reasoning-delta':
        return encodeOpenAiSseChunk({
          choices: [{ index: 0, delta: { reasoning: part.text } }],
        });

      case 'tool-input-start': {
        const toolCallId = typeof part.id === 'string' ? part.id : '';
        if (!toolCallId) return null;
        return encodeToolDelta(
          {
            id: toolCallId,
            type: 'function',
            function: {
              name: typeof part.toolName === 'string' ? part.toolName : '',
              arguments: '',
            },
          },
          toolCallId,
        );
      }

      case 'tool-input-delta':
      case 'tool-call-delta': {
        const toolCallId = typeof part.id === 'string' ? part.id : '';
        const deltaText =
          typeof part.delta === 'string'
            ? part.delta
            : typeof part.argsTextDelta === 'string'
              ? part.argsTextDelta
              : '';
        if (!toolCallId || !deltaText) return null;
        return encodeToolDelta(
          {
            type: 'function',
            function: { arguments: deltaText },
          },
          toolCallId,
        );
      }

      case 'tool-call': {
        const toolCallId = typeof part.toolCallId === 'string' ? part.toolCallId : '';
        const toolName = typeof part.toolName === 'string' ? part.toolName : '';
        if (!toolCallId || !toolName) return null;
        const args =
          typeof part.input === 'string'
            ? part.input
            : JSON.stringify(part.input ?? {});
        return encodeToolDelta(
          {
            id: toolCallId,
            type: 'function',
            function: { name: toolName, arguments: args },
          },
          toolCallId,
        );
      }

      case 'finish':
        return encodeOpenAiSseChunk({
          choices: [
            {
              index: 0,
              delta: {},
              finish_reason: mapOpenAiFinishReason(part.finishReason),
            },
          ],
          ...(part.totalUsage ? { usage: mapOpenAiUsage(part.totalUsage) } : {}),
        });

      default:
        return null;
    }
  }

  return {
    encodeStreamPart,
    indexForToolCall,
  };
}

/**
 * @param {{
 *   model: string,
 *   text?: string,
 *   reasoningText?: string,
 *   toolCalls?: Array<{ toolCallId: string, toolName: string, input: unknown }>,
 *   finishReason?: import('ai').FinishReason | string,
 *   usage?: import('ai').LanguageModelUsage,
 * }} params
 * @returns {Record<string, unknown>}
 */
export function encodeNonStreamingCompletion({
  model,
  text,
  reasoningText,
  toolCalls,
  finishReason,
  usage,
}) {
  /** @type {Record<string, unknown>} */
  const message = {
    role: 'assistant',
    content: text ?? '',
  };

  if (reasoningText) {
    message.reasoning = reasoningText;
  }

  if (Array.isArray(toolCalls) && toolCalls.length > 0) {
    message.tool_calls = toolCalls.map((call) => ({
      id: call.toolCallId,
      type: 'function',
      function: {
        name: call.toolName,
        arguments:
          typeof call.input === 'string' ? call.input : JSON.stringify(call.input ?? {}),
      },
    }));
  }

  return {
    id: `chatcmpl-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message,
        finish_reason: mapOpenAiFinishReason(finishReason),
      },
    ],
    ...(usage ? { usage: mapOpenAiUsage(usage) } : {}),
  };
}

/**
 * @param {import('ai').LanguageModelUsage | undefined} usage
 * @param {import('ai').FinishReason | string | undefined} [finishReason]
 * @returns {string}
 */
export function encodeUsageSseChunk(usage, finishReason = 'stop') {
  return encodeOpenAiSseChunk({
    choices: [{ index: 0, delta: {}, finish_reason: mapOpenAiFinishReason(finishReason) }],
    ...(usage ? { usage: mapOpenAiUsage(usage) } : {}),
  });
}
