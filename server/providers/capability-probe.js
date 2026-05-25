/**
 * Provider capability probes: per-model matrix (MIN-48) + structured output (#10).
 * Persists to ~/.minnow/providers/<id>/capabilities.json via capabilities-store.
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

const MAX_MODELS_PER_PROBE = 8;
const MODEL_PROBE_TIMEOUT_MS = 25_000;
const STRUCTURED_PROBE_TIMEOUT_MS = 30_000;

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
function ingestFromCatalog(row) {
  const isVlm = row.type === 'vlm';
  const contextLength =
    typeof row.loaded_context_length === 'number' && row.loaded_context_length > 0
      ? row.loaded_context_length
      : typeof row.max_context_length === 'number' && row.max_context_length > 0
        ? row.max_context_length
        : null;

  const loadState =
    typeof row.state === 'string' && row.state.trim() ? row.state.trim() : 'unknown';

  return {
    vision: isVlm ? true : false,
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
 * @param {object} modelRow
 * @param {{ profile: object, headers: Record<string, string>, paths: object }} runtime
 * @param {AbortSignal | undefined} signal
 */
async function probeModelCapabilities(modelRow, runtime, signal) {
  const cap = ingestFromCatalog(modelRow);
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

  const allIds = options.modelIds?.length
    ? options.modelIds
    : catalog.map((m) => m.id);

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
 *
 * @param {string} id
 * @param {{ modelId?: string }} [options]
 */
export async function probeProviderCapabilities(id, options = {}) {
  validateProviderId(id);
  const runtime = await getProviderRuntime(id);
  const url = `${runtime.profile.baseUrl}${runtime.paths.chatCompletionsPath}`;
  const modelId =
    typeof options.modelId === 'string' && options.modelId.trim()
      ? options.modelId.trim()
      : undefined;

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
      model: modelId,
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
      model: modelId,
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
      model: modelId,
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

  if (modelId) {
    models[modelId] = {
      ...(models[modelId] || {}),
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
