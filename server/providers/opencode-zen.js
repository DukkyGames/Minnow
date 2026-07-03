/**
 * OpenCode Zen routing for GPT models (Responses API) and path normalization.
 *
 * Zen GPT models use POST /zen/v1/responses (@ai-sdk/openai), not /chat/completions.
 * See https://opencode.ai/docs/zen/
 */

import { isOpenCodeProviderBaseUrl } from './models-dev-context.js';

/**
 * GPT / o-series models on OpenCode Zen require the Responses API.
 * @param {string} modelId
 */
export function openCodeZenModelUsesResponsesApi(modelId) {
  const id = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  if (!id) return false;
  return /^gpt-/.test(id) || /^o\d/.test(id);
}

/**
 * Avoid https://opencode.ai/zen/v1/v1/chat/completions when defaults stack /v1 twice.
 * @param {string} baseUrl
 * @param {string} relativePath
 */
export function normalizeOpenCodeZenRelativePath(baseUrl, relativePath) {
  const base = typeof baseUrl === 'string' ? baseUrl.replace(/\/$/, '') : '';
  const path = typeof relativePath === 'string' ? relativePath : '';
  if (!base || !path) return path;
  if (isOpenCodeProviderBaseUrl(base) && base.endsWith('/v1') && path.startsWith('/v1/')) {
    return path.slice(3);
  }
  return path;
}

/**
 * Resolve upstream chat URL for a provider/model pair.
 * @param {string} baseUrl
 * @param {string} chatCompletionsPath
 * @param {string} modelId
 */
export function resolveOpenCodeZenUpstreamUrl(baseUrl, chatCompletionsPath, modelId) {
  const base = baseUrl.replace(/\/$/, '');
  if (!isOpenCodeProviderBaseUrl(base)) {
    return `${base}${chatCompletionsPath}`;
  }

  if (openCodeZenModelUsesResponsesApi(modelId)) {
    if (base.endsWith('/v1')) {
      return `${base}/responses`;
    }
    if (base.endsWith('/zen')) {
      return `${base}/v1/responses`;
    }
    return `${base}/responses`;
  }

  const chatPath = normalizeOpenCodeZenRelativePath(base, chatCompletionsPath);
  return `${base}${chatPath}`;
}

/**
 * @param {unknown} part
 */
function toInputImagePart(part) {
  if (!part || typeof part !== 'object') return undefined;
  const p = /** @type {Record<string, unknown>} */ (part);
  if (p.type === 'text' && typeof p.text === 'string') {
    return { type: 'input_text', text: p.text };
  }
  if (p.type === 'image_url' && p.image_url) {
    return { type: 'input_image', image_url: p.image_url };
  }
  const source = p.source;
  if (!source || typeof source !== 'object') return undefined;
  const s = /** @type {Record<string, unknown>} */ (source);
  if (s.type === 'url' && typeof s.url === 'string') {
    return { type: 'input_image', image_url: { url: s.url } };
  }
  if (s.type === 'base64' && typeof s.media_type === 'string' && typeof s.data === 'string') {
    return {
      type: 'input_image',
      image_url: { url: `data:${s.media_type};base64,${s.data}` },
    };
  }
  return undefined;
}

/**
 * Map chat completion messages to OpenAI Responses API `input`.
 * @param {unknown[]} messages
 */
function messagesToResponsesInput(messages) {
  const input = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') continue;
    const m = /** @type {Record<string, unknown>} */ (message);
    const role = m.role;

    if (role === 'system') {
      if (typeof m.content === 'string' && m.content.length > 0) {
        input.push({ role: 'system', content: m.content });
      }
      continue;
    }

    if (role === 'user') {
      const content = m.content;
      if (typeof content === 'string') {
        input.push({ role: 'user', content: [{ type: 'input_text', text: content }] });
      } else if (Array.isArray(content)) {
        const parts = [];
        for (const part of content) {
          const mapped = toInputImagePart(part);
          if (mapped) parts.push(mapped);
        }
        if (parts.length > 0) {
          input.push({ role: 'user', content: parts });
        }
      }
      continue;
    }

    if (role === 'assistant') {
      const content = m.content;
      if (typeof content === 'string' && content.length > 0) {
        input.push({ role: 'assistant', content: [{ type: 'output_text', text: content }] });
      }
      if (Array.isArray(m.tool_calls)) {
        for (const toolCall of m.tool_calls) {
          if (!toolCall || typeof toolCall !== 'object') continue;
          const tc = /** @type {Record<string, unknown>} */ (toolCall);
          if (tc.type !== 'function' || !tc.function || typeof tc.function !== 'object') continue;
          const fn = /** @type {Record<string, unknown>} */ (tc.function);
          const name = fn.name;
          const args = fn.arguments;
          if (typeof name !== 'string') continue;
          input.push({
            type: 'function_call',
            call_id: typeof tc.id === 'string' ? tc.id : undefined,
            name,
            arguments: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
          });
        }
      }
      continue;
    }

    if (role === 'tool') {
      const output =
        typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? '');
      input.push({
        type: 'function_call_output',
        call_id: m.tool_call_id,
        output,
      });
    }
  }

  return input;
}

/**
 * Resolve Responses API reasoning effort from chat completion body fields.
 * @param {Record<string, unknown>} body
 */
function resolveResponsesReasoningEffort(body) {
  const reasoning = body.reasoning;
  if (reasoning && typeof reasoning === 'object') {
    const effort = /** @type {{ effort?: unknown }} */ (reasoning).effort;
    if (typeof effort === 'string' && effort.length > 0) {
      return effort;
    }
  }
  const reasoningEffort = body.reasoning_effort;
  if (
    typeof reasoningEffort === 'string' &&
    reasoningEffort !== 'off' &&
    reasoningEffort !== 'on'
  ) {
    return reasoningEffort;
  }
  const thinking = body.thinking;
  if (thinking && typeof thinking === 'object') {
    const type = /** @type {{ type?: unknown }} */ (thinking).type;
    if (type === 'disabled') return 'low';
  }
  return 'medium';
}

/**
 * Convert a chat/completions JSON body to OpenAI Responses API shape for Zen GPT models.
 * @param {Record<string, unknown>} body
 */
export function chatCompletionBodyToResponsesApi(body) {
  const model = typeof body.model === 'string' ? body.model : '';
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const maxTokens =
    typeof body.max_completion_tokens === 'number'
      ? body.max_completion_tokens
      : typeof body.max_tokens === 'number'
        ? body.max_tokens
        : undefined;

  const stopSequences = (() => {
    const stop = body.stop;
    if (!stop) return undefined;
    if (Array.isArray(stop)) return stop;
    if (typeof stop === 'string') return [stop];
    return undefined;
  })();

  const tools = Array.isArray(body.tools)
    ? body.tools.map((tool) => {
        if (!tool || typeof tool !== 'object') return tool;
        const t = /** @type {Record<string, unknown>} */ (tool);
        if (t.type !== 'function' || !t.function || typeof t.function !== 'object') {
          return tool;
        }
        const fn = /** @type {Record<string, unknown>} */ (t.function);
        return {
          type: 'function',
          name: fn.name,
          description: fn.description,
          parameters: fn.parameters,
          strict: fn.strict,
        };
      })
    : undefined;

  const out = {
    model,
    input: messagesToResponsesInput(messages),
    stream: body.stream === true,
    ...(maxTokens !== undefined ? { max_output_tokens: maxTokens } : {}),
    ...(stopSequences ? { stop_sequences: stopSequences } : {}),
    ...(tools ? { tools, tool_choice: body.tool_choice ?? 'auto' } : {}),
    reasoning: { effort: resolveResponsesReasoningEffort(body) },
    text: {
      verbosity: /codex/i.test(model) ? 'medium' : 'low',
    },
  };

  return out;
}

/**
 * Convert one Responses API SSE block to chat.completion.chunk SSE for Minnow clients.
 * @param {string} block
 * @returns {string | null}
 */
export function convertResponsesSseBlockToChatCompletion(block) {
  const lines = block.split('\n');
  let eventName = '';
  let dataLine = '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('event:')) {
      eventName = trimmed.slice(6).trim();
    } else if (trimmed.startsWith('data:')) {
      dataLine = trimmed.slice(5).trim();
    }
  }

  if (!eventName || !dataLine || dataLine === '[DONE]') {
    return null;
  }

  let json;
  try {
    json = JSON.parse(dataLine);
  } catch {
    return null;
  }

  const respObj = json.response ?? {};
  const chunk = {
    id: respObj.id ?? json.id ?? '',
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: respObj.model ?? json.model ?? '',
    choices: [],
  };

  if (eventName === 'response.output_text.delta') {
    const delta = json.delta ?? json.text ?? json.output_text_delta;
    if (typeof delta === 'string' && delta.length > 0) {
      chunk.choices.push({ index: 0, delta: { content: delta }, finish_reason: null });
    }
  } else if (eventName === 'response.output_item.added' && json.item?.type === 'function_call') {
    const name = json.item?.name;
    const id = json.item?.id;
    if (typeof name === 'string' && name.length > 0) {
      chunk.choices.push({
        index: 0,
        delta: {
          tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: '' } }],
        },
        finish_reason: null,
      });
    }
  } else if (eventName === 'response.function_call_arguments.delta') {
    const args = json.delta ?? json.arguments_delta;
    if (typeof args === 'string' && args.length > 0) {
      chunk.choices.push({
        index: 0,
        delta: { tool_calls: [{ index: 0, function: { arguments: args } }] },
        finish_reason: null,
      });
    }
  } else if (eventName === 'response.completed') {
    const stopReason = respObj.stop_reason ?? json.stop_reason;
    const finishReason = (() => {
      if (stopReason === 'stop') return 'stop';
      if (stopReason === 'tool_call' || stopReason === 'tool_calls') return 'tool_calls';
      if (stopReason === 'length' || stopReason === 'max_output_tokens') return 'length';
      if (stopReason === 'content_filter') return 'content_filter';
      return null;
    })();
    chunk.choices.push({ index: 0, delta: {}, finish_reason: finishReason });

    const usage = respObj.usage ?? json.response?.usage;
    if (usage) {
      chunk.usage = {
        prompt_tokens: usage.input_tokens,
        completion_tokens: usage.output_tokens,
        total_tokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
        ...(usage.input_tokens_details?.cached_tokens
          ? { prompt_tokens_details: { cached_tokens: usage.input_tokens_details.cached_tokens } }
          : {}),
      };
    }
  } else {
    return null;
  }

  if (chunk.choices.length === 0) {
    return null;
  }

  return `data: ${JSON.stringify(chunk)}\n`;
}

/**
 * Incrementally transform Responses API SSE bytes into chat.completion.chunk SSE bytes.
 */
export class ResponsesToChatCompletionsStream {
  constructor() {
    /** @type {string} */
    this.buffer = '';
  }

  /**
   * @param {Buffer} chunk
   * @returns {Buffer}
   */
  transform(chunk) {
    this.buffer += chunk.toString('utf8');
    let out = '';

    let endIndex = this.buffer.indexOf('\n\n');
    while (endIndex >= 0) {
      const block = this.buffer.slice(0, endIndex);
      this.buffer = this.buffer.slice(endIndex + 2);
      const converted = convertResponsesSseBlockToChatCompletion(block);
      if (converted) {
        out += `${converted}\n`;
      }
      endIndex = this.buffer.indexOf('\n\n');
    }

    return Buffer.from(out, 'utf8');
  }

  /** @returns {Buffer} */
  flush() {
    const trimmed = this.buffer.trim();
    this.buffer = '';
    if (!trimmed) return Buffer.alloc(0);
    const converted = convertResponsesSseBlockToChatCompletion(trimmed);
    return converted ? Buffer.from(`${converted}\n`, 'utf8') : Buffer.alloc(0);
  }
}

/**
 * Convert a non-streaming Responses API JSON body to chat.completion JSON.
 * @param {unknown} payload
 */
export function convertResponsesJsonToChatCompletion(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }
  const record = /** @type {Record<string, unknown>} */ (payload);
  if (Array.isArray(record.choices)) {
    return payload;
  }

  const response = record.response ?? payload;
  if (!response || typeof response !== 'object') {
    return payload;
  }
  const r = /** @type {Record<string, unknown>} */ (response);
  const idIn = r.id;
  const id =
    typeof idIn === 'string'
      ? idIn.replace(/^resp_/, 'chatcmpl_')
      : `chatcmpl_${Math.random().toString(36).slice(2)}`;

  const output = Array.isArray(r.output) ? r.output : [];
  const text = output
    .filter((item) => item && typeof item === 'object' && item.type === 'message')
    .flatMap((item) => {
      const content = /** @type {{ content?: unknown[] }} */ (item).content;
      return Array.isArray(content) ? content : [];
    })
    .filter((part) => part && part.type === 'output_text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('');

  const toolCalls = output
    .filter((item) => item && typeof item === 'object' && item.type === 'function_call')
    .map((item) => {
      const call = /** @type {{ id?: string, name?: string, arguments?: unknown }} */ (item);
      const args =
        typeof call.arguments === 'string' ? call.arguments : JSON.stringify(call.arguments ?? {});
      const tid =
        typeof call.id === 'string' && call.id.length > 0
          ? call.id
          : `toolu_${Math.random().toString(36).slice(2)}`;
      return {
        id: tid,
        type: 'function',
        function: { name: call.name, arguments: args },
      };
    });

  const finishReason = (() => {
    const stopReason = r.stop_reason;
    if (stopReason === 'stop') return 'stop';
    if (stopReason === 'tool_call' || stopReason === 'tool_calls') return 'tool_calls';
    if (stopReason === 'length' || stopReason === 'max_output_tokens') return 'length';
    if (stopReason === 'content_filter') return 'content_filter';
    return null;
  })();

  const usageRaw = r.usage;
  const usage =
    usageRaw && typeof usageRaw === 'object'
      ? {
          prompt_tokens: usageRaw.input_tokens,
          completion_tokens: usageRaw.output_tokens,
          total_tokens: (usageRaw.input_tokens || 0) + (usageRaw.output_tokens || 0),
        }
      : undefined;

  return {
    id,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: r.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          ...(text ? { content: text } : {}),
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason,
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

/**
 * Prepare upstream request body for OpenCode Zen (responses rewrite or passthrough).
 * @param {Buffer} requestBody
 * @param {string} baseUrl
 * @param {string} modelId
 * @returns {{ body: Buffer, usesResponsesApi: boolean }}
 */
export function prepareOpenCodeZenRequestBody(requestBody, baseUrl, modelId) {
  let parsed;
  try {
    parsed = JSON.parse(requestBody.toString('utf8'));
  } catch {
    return { body: requestBody, usesResponsesApi: false };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { body: requestBody, usesResponsesApi: false };
  }

  const body = /** @type {Record<string, unknown>} */ (parsed);
  const resolvedModelId = modelId || (typeof body.model === 'string' ? body.model : '');
  const usesResponsesApi =
    isOpenCodeProviderBaseUrl(baseUrl) && openCodeZenModelUsesResponsesApi(resolvedModelId);

  if (!usesResponsesApi) {
    return { body: requestBody, usesResponsesApi: false };
  }

  const responsesBody = chatCompletionBodyToResponsesApi(body);
  return {
    body: Buffer.from(JSON.stringify(responsesBody), 'utf8'),
    usesResponsesApi: true,
  };
}
