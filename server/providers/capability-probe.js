/**
 * Provider capability probes (separate entry points, shared capabilities.json):
 * - runCapabilityProbe — per-model matrix (MIN-48): vision, tools, streaming
 * - probeProviderCapabilities — structured output (#10): response_format / json_schema
 * Persists via capabilities-store.
 */

import { getProviderRuntime } from './store.js';
import { proxyModels } from './proxy.js';
import {
  capabilitiesFileExists,
  mergeCapabilities,
  readCapabilities,
  writeCapabilities,
} from './capabilities-store.js';
import { validateProviderId } from './validate.js';
import { generateText, streamText } from 'ai';
import { buildAnthropicProvider } from '../generations/anthropic/provider-runtime.js';
import { resolveModelApi } from '../generations/resolve-model-api.js';
import { openAiMessagesToCoreMessages } from '../generations/anthropic/openai-to-core-messages.js';
import { mapOpenAiToolChoice, mapOpenAiTools } from '../generations/anthropic/openai-tools.js';

const MAX_MODELS_PER_PROBE = 8;
const MODEL_PROBE_TIMEOUT_MS = 25_000;
const STRUCTURED_PROBE_TIMEOUT_MS = 30_000;

export const NO_LOADED_MODEL_MATRIX_PROBE_MSG =
  'No loaded model found. Load a model in LM Studio, then run the probe again.';

export const ANTHROPIC_STRUCTURED_PROBE_MSG =
  'Structured output probe is not supported for Anthropic Messages API (v1 bridge).';

/** Minimal JSON Schema for structured-output probe. */
const PROBE_SCHEMA = {
  type: 'object',
  properties: {
    ok: { type: 'boolean' },
  },
  required: ['ok'],
  additionalProperties: false,
};

const DUMMY_TOOL = {
  type: 'function',
  function: {
    name: 'ping',
    description: 'Capability probe',
    parameters: { type: 'object', properties: {} },
  },
};

/**
 * @param {string[]} modelIds
 * @param {string | undefined} selectedModelId
 * @param {Array<{ id: string, state?: string }>} catalog
 */
export function prioritizeModelIds(modelIds, selectedModelId, catalog = []) {
  const unique = [...new Set(modelIds.filter((id) => typeof id === 'string' && id.trim()))];
  const loaded = new Set(
    catalog.filter((m) => m.state === 'loaded').map((m) => m.id),
  );

  const score = (id) => {
    if (selectedModelId && id === selectedModelId) return 0;
    if (loaded.has(id)) return 1;
    return 2;
  };

  return unique
    .sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      return a.localeCompare(b);
    })
    .slice(0, MAX_MODELS_PER_PROBE);
}

/**
 * @param {object} row
 */
function catalogRowHasVision(row) {
  return row.type === 'vlm' || row.catalogVision === true;
}

function ingestFromCatalog(row) {
  const vision = catalogRowHasVision(row);
  const contextLength =
    typeof row.loaded_context_length === 'number' && row.loaded_context_length > 0
      ? row.loaded_context_length
      : typeof row.max_context_length === 'number' && row.max_context_length > 0
        ? row.max_context_length
        : null;

  const loadState =
    typeof row.state === 'string' && row.state.trim() ? row.state.trim() : 'unknown';

  return {
    vision,
    tools: null,
    streaming: null,
    grammar: null,
    reasoning: null,
    contextLength,
    loadState,
    sources: {
      vision: 'catalog',
      contextLength: contextLength !== null ? 'catalog' : undefined,
      loadState: 'catalog',
    },
    probeErrors: {},
  };
}

/**
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {object} body
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} signal
 */
async function postChatCompletion(url, headers, body, timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const linked = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', linked, { once: true });
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* non-json */
    }
    return { ok: res.ok, status: res.status, json, text };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', linked);
  }
}

/**
 * @param {{ url: string, headers: Record<string, string>, body: object }} params
 */
async function postStructuredProbeCompletion({ url, headers, body }) {
  const result = await postChatCompletion(
    url,
    headers,
    body,
    STRUCTURED_PROBE_TIMEOUT_MS,
    undefined,
  );
  if (result.ok) {
    return { ok: true, status: result.status };
  }
  return {
    ok: false,
    status: result.status,
    error: result.text?.slice(0, 300) || `HTTP ${result.status}`,
  };
}

/**
 * @param {unknown} json
 */
function responseHasToolCalls(json) {
  if (!json || typeof json !== 'object') return false;
  const choices = /** @type {{ choices?: unknown[] }} */ (json).choices;
  if (!Array.isArray(choices) || choices.length === 0) return false;
  const first = choices[0];
  if (!first || typeof first !== 'object') return false;
  const message = /** @type {{ message?: { tool_calls?: unknown[] } }} */ (first).message;
  if (message?.tool_calls && message.tool_calls.length > 0) return true;
  const finish = /** @type {{ finish_reason?: string }} */ (first).finish_reason;
  return finish === 'tool_calls';
}

/**
 * @param {object} cap
 * @param {{ ok: boolean, json: unknown }} result
 */
function applyStreamingProbe(cap, result) {
  if (result.ok) {
    cap.streaming = true;
    cap.sources = { ...cap.sources, streaming: 'probe' };
  } else {
    cap.streaming = false;
    cap.sources = { ...cap.sources, streaming: 'probe' };
    cap.probeErrors = { ...cap.probeErrors, streaming: 'chat probe failed' };
  }
}

/**
 * @param {object} cap
 * @param {{ ok: boolean, json: unknown }} result
 */
function applyToolsProbe(cap, result) {
  const hasTools = result.ok && responseHasToolCalls(result.json);
  cap.tools = hasTools;
  cap.sources = { ...cap.sources, tools: 'probe' };
  if (!result.ok) {
    cap.probeErrors = { ...cap.probeErrors, tools: 'tool probe failed' };
  }
}

/**
 * @param {number} timeoutMs
 * @param {AbortSignal | undefined} signal
 */
function createProbeAbortSignal(timeoutMs, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onParentAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onParentAbort);
    },
  };
}

/**
 * Matrix probe via the Anthropic Messages bridge (AI SDK) instead of raw OpenAI fetch.
 *
 * @param {object} modelRow
 * @param {{ profile: object, headers: Record<string, string>, paths: object, secrets: object }} runtime
 * @param {AbortSignal | undefined} signal
 */
async function probeAnthropicModelCapabilities(modelRow, runtime, signal) {
  const cap = ingestFromCatalog(modelRow);
  const modelId = modelRow.id;
  const anthropic = buildAnthropicProvider(runtime);
  const messages = openAiMessagesToCoreMessages([{ role: 'user', content: 'ping' }]);

  const streamProbe = createProbeAbortSignal(MODEL_PROBE_TIMEOUT_MS, signal);
  try {
    const result = streamText({
      model: anthropic(modelId),
      messages,
      maxOutputTokens: 1,
      abortSignal: streamProbe.signal,
    });
    let gotStream = false;
    for await (const _part of result.fullStream) {
      gotStream = true;
      break;
    }
    applyStreamingProbe(cap, { ok: gotStream, json: null });
  } catch {
    applyStreamingProbe(cap, { ok: false, json: null });
  } finally {
    streamProbe.dispose();
  }

  const toolBody = [
    {
      type: 'function',
      function: {
        name: 'probe_noop',
        description: 'Capability probe noop',
        parameters: { type: 'object', properties: {} },
      },
    },
  ];
  const tools = mapOpenAiTools(toolBody);
  const toolProbe = createProbeAbortSignal(MODEL_PROBE_TIMEOUT_MS, signal);
  try {
    const result = await generateText({
      model: anthropic(modelId),
      messages,
      tools,
      toolChoice: mapOpenAiToolChoice('auto'),
      maxOutputTokens: 64,
      abortSignal: toolProbe.signal,
    });
    const hasTools = Array.isArray(result.toolCalls) && result.toolCalls.length > 0;
    cap.tools = hasTools;
    cap.sources = { ...cap.sources, tools: 'probe' };
    if (!hasTools) {
      cap.probeErrors = { ...cap.probeErrors, tools: 'tool probe returned no tool calls' };
    }
  } catch {
    cap.tools = false;
    cap.sources = { ...cap.sources, tools: 'probe' };
    cap.probeErrors = { ...cap.probeErrors, tools: 'tool probe failed' };
  } finally {
    toolProbe.dispose();
  }

  return cap;
}

/**
 * @param {object} modelRow
 * @param {{ profile: object, headers: Record<string, string>, paths: object }} runtime
 * @param {AbortSignal | undefined} signal
 */
async function probeModelCapabilities(modelRow, runtime, signal) {
  const cap = ingestFromCatalog(modelRow);
  const resolvedApi = resolveModelApi(runtime, modelRow.id, modelRow);
  cap.api = resolvedApi;
  const isLmStudio = runtime.profile.apiKind === 'lm-studio-v0';
  if (isLmStudio && !isCatalogModelLoaded(modelRow)) {
    return cap;
  }

  if (resolvedApi === 'anthropic-v1') {
    return probeAnthropicModelCapabilities(modelRow, runtime, signal);
  }

  const modelId = modelRow.id;
  const url = `${runtime.profile.baseUrl}${runtime.paths.chatCompletionsPath}`;

  const chatBody = {
    model: modelId,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    stream: false,
  };

  const chatResult = await postChatCompletion(
    url,
    runtime.headers,
    chatBody,
    MODEL_PROBE_TIMEOUT_MS,
    signal,
  );
  applyStreamingProbe(cap, chatResult);

  const toolBody = {
    ...chatBody,
    tools: [
      {
        type: 'function',
        function: {
          name: 'probe_noop',
          description: 'Capability probe noop',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
    tool_choice: 'auto',
  };

  const toolResult = await postChatCompletion(
    url,
    runtime.headers,
    toolBody,
    MODEL_PROBE_TIMEOUT_MS,
    signal,
  );
  applyToolsProbe(cap, toolResult);

  return cap;
}

/**
 * Per-model capability matrix probe (vision, tools, streaming, context).
 *
 * @param {string} providerId
 * @param {{ modelIds?: string[], selectedModelId?: string, signal?: AbortSignal }} [options]
 */
export async function runCapabilityProbe(providerId, options = {}) {
  validateProviderId(providerId);
  const runtime = await getProviderRuntime(providerId);
  if (runtime.profile.enabled === false) {
    throw new Error('Provider is disabled');
  }

  const modelsResponse = await proxyModels(providerId);
  const catalog = Array.isArray(modelsResponse.data) ? modelsResponse.data : [];
  const isLmStudio = runtime.profile.apiKind === 'lm-studio-v0';

  let allIds;
  if (options.modelIds?.length) {
    allIds = options.modelIds;
  } else if (isLmStudio) {
    allIds = catalog.filter(isCatalogModelLoaded).map((m) => m.id);
    if (allIds.length === 0) {
      throw new Error(NO_LOADED_MODEL_MATRIX_PROBE_MSG);
    }
  } else {
    allIds = catalog.map((m) => m.id);
  }

  const prioritized = prioritizeModelIds(
    allIds,
    options.selectedModelId,
    catalog,
  );

  const catalogById = new Map(catalog.map((m) => [m.id, m]));
  const patches = {};
  const probedAt = new Date().toISOString();

  for (const modelId of prioritized) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const row = catalogById.get(modelId) || { id: modelId, type: 'llm' };
    try {
      patches[modelId] = await probeModelCapabilities(row, runtime, options.signal);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw err;
      }
      const base = ingestFromCatalog(row);
      base.probeErrors = {
        ...base.probeErrors,
        probe: err instanceof Error ? err.message : String(err),
      };
      patches[modelId] = base;
    }
  }

  for (const row of catalog) {
    if (patches[row.id]) continue;
    patches[row.id] = ingestFromCatalog(row);
  }

  return mergeCapabilities(providerId, patches, {
    probedAt,
    apiKind: runtime.profile.apiKind,
  });
}

/**
 * @param {{ state?: string }} row
 */
function isCatalogModelLoaded(row) {
  return typeof row.state === 'string' && row.state.trim().toLowerCase() === 'loaded';
}

/**
 * Pick a loaded model id for structured-output probes (LM Studio requires a loaded model).
 *
 * @param {string} providerId
 * @param {{ modelId?: string, selectedModelId?: string }} [options]
 */
export async function resolveStructuredProbeModelId(providerId, options = {}) {
  const modelsResponse = await proxyModels(providerId);
  const catalog = Array.isArray(modelsResponse.data) ? modelsResponse.data : [];
  const loadedIds = catalog.filter(isCatalogModelLoaded).map((m) => m.id);

  const explicit =
    typeof options.modelId === 'string' && options.modelId.trim()
      ? options.modelId.trim()
      : undefined;

  if (explicit) {
    if (!loadedIds.includes(explicit)) {
      throw new Error(
        `Model "${explicit}" is not loaded. Load it in your backend, then run the structured-output probe again.`,
      );
    }
    return explicit;
  }

  const selected =
    typeof options.selectedModelId === 'string' && options.selectedModelId.trim()
      ? options.selectedModelId.trim()
      : undefined;

  const pick = prioritizeModelIds(loadedIds, selected, catalog)[0];
  if (!pick) {
    throw new Error(
      'No loaded model found. Load a model in LM Studio (or your backend), then run the structured-output probe again.',
    );
  }
  return pick;
}

/**
 * Read capabilities for structured-output UI (#10). Returns null when never probed.
 *
 * @param {string} id
 */
export async function readProviderCapabilitiesFile(id) {
  if (!(await capabilitiesFileExists(id))) {
    return null;
  }
  const file = await readCapabilities(id);
  if (!file.probedAt?.trim() && !file.structuredOutput && !file.structuredOutputWithTools) {
    return null;
  }
  return file;
}

/**
 * Structured-output probe (response_format / json_schema). Merges into capabilities.json.
 * Requires a loaded model (resolved from catalog when modelId is omitted).
 *
 * @param {string} id
 * @param {{ modelId?: string, selectedModelId?: string }} [options]
 */
export async function probeProviderCapabilities(id, options = {}) {
  validateProviderId(id);
  const runtime = await getProviderRuntime(id);

  const modelsResponse = await proxyModels(id);
  const catalog = Array.isArray(modelsResponse.data) ? modelsResponse.data : [];
  const prioritized = prioritizeModelIds(
    catalog.map((m) => m.id),
    options.selectedModelId,
    catalog,
  );
  const catalogById = new Map(catalog.map((m) => [m.id, m]));
  const modelId =
    typeof options.modelId === 'string' && options.modelId.trim()
      ? options.modelId.trim()
      : prioritized[0];
  const modelRow = modelId ? catalogById.get(modelId) || { id: modelId } : null;
  const resolvedApi = modelRow
    ? resolveModelApi(runtime, modelRow.id, modelRow)
    : runtime.profile.apiKind;

  if (resolvedApi === 'anthropic-v1') {
    const existing = await readCapabilities(id);
    const models = { ...existing.models };
    if (modelId) {
      models[modelId] = {
        ...(models[modelId] || {}),
        api: 'anthropic-v1',
        structuredOutput: false,
        denyReason: ANTHROPIC_STRUCTURED_PROBE_MSG,
      };
    }

    return writeCapabilities(id, {
      ...existing,
      providerId: id,
      probedAt: new Date().toISOString(),
      apiKind: runtime.profile.apiKind,
      structuredOutput: false,
      structuredOutputWithTools: false,
      structuredOutputStreaming: false,
      probeError: ANTHROPIC_STRUCTURED_PROBE_MSG,
      models,
    });
  }

  const url = `${runtime.profile.baseUrl}${runtime.paths.chatCompletionsPath}`;
  const probeModelId = await resolveStructuredProbeModelId(id, options);

  const baseMessages = [{ role: 'user', content: 'Reply with JSON: {"ok":true}' }];
  const responseFormat = {
    type: 'json_schema',
    json_schema: {
      name: 'probe_ok',
      strict: true,
      schema: PROBE_SCHEMA,
    },
  };

  const structuredOnly = await postStructuredProbeCompletion({
    url,
    headers: runtime.headers,
    body: {
      model: probeModelId,
      messages: baseMessages,
      max_tokens: 16,
      temperature: 0,
      stream: false,
      response_format: responseFormat,
    },
  });

  const withTools = await postStructuredProbeCompletion({
    url,
    headers: runtime.headers,
    body: {
      model: probeModelId,
      messages: baseMessages,
      max_tokens: 16,
      temperature: 0,
      stream: false,
      response_format: responseFormat,
      tools: [DUMMY_TOOL],
      tool_choice: 'auto',
    },
  });

  const streaming = await postStructuredProbeCompletion({
    url,
    headers: runtime.headers,
    body: {
      model: probeModelId,
      messages: baseMessages,
      max_tokens: 16,
      temperature: 0,
      stream: true,
      response_format: responseFormat,
      tools: [DUMMY_TOOL],
      tool_choice: 'auto',
    },
  });

  const probeError =
    !structuredOnly.ok && !withTools.ok
      ? structuredOnly.error || withTools.error || `HTTP ${structuredOnly.status}`
      : null;

  const existing = await readCapabilities(id);
  const models = { ...existing.models };

  if (probeModelId) {
    models[probeModelId] = {
      ...(models[probeModelId] || {}),
      structuredOutput: withTools.ok || structuredOnly.ok,
      denyReason: null,
    };
  }

  return writeCapabilities(id, {
    ...existing,
    providerId: id,
    probedAt: new Date().toISOString(),
    apiKind: runtime.profile.apiKind,
    structuredOutput: structuredOnly.ok,
    structuredOutputWithTools: withTools.ok,
    structuredOutputStreaming: streaming.ok,
    probeError,
    models,
  });
}
