/**
 * Active capability probes per provider model (catalog ingest + tiny completions).
 */

import { getProviderRuntime } from './store.js';
import { proxyModels } from './proxy.js';
import { mergeCapabilities } from './capabilities-store.js';
import { validateProviderId } from './validate.js';

const MAX_MODELS_PER_PROBE = 8;
const PROBE_TIMEOUT_MS = 25_000;

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
 * @param {AbortSignal} signal
 */
async function postChatCompletion(url, headers, body, signal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
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
 * @param {string} providerId
 * @param {object} modelRow
 * @param {{ url: string, headers: Record<string, string> }} runtime
 * @param {AbortSignal | undefined} signal
 */
async function probeModelCapabilities(providerId, modelRow, runtime, signal) {
  const cap = ingestFromCatalog(modelRow);
  const modelId = modelRow.id;

  const chatBody = {
    model: modelId,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    stream: false,
  };

  const chatResult = await postChatCompletion(
    `${runtime.profile.baseUrl}${runtime.paths.chatCompletionsPath}`,
    runtime.headers,
    chatBody,
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
    `${runtime.profile.baseUrl}${runtime.paths.chatCompletionsPath}`,
    runtime.headers,
    toolBody,
    signal,
  );
  applyToolsProbe(cap, toolResult);

  if (cap.vision === false && cap.sources?.vision === 'catalog') {
    /* catalog already set vision */
  }

  return cap;
}

/**
 * Run capability probe for a provider; persists capabilities.json.
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
      patches[modelId] = await probeModelCapabilities(
        providerId,
        row,
        runtime,
        options.signal,
      );
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
