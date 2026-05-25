/**
 * Probe upstream chat/completions for structured output (response_format) support.
 * Persists results to ~/.minnow/providers/<id>/capabilities.json.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { getMinnowHome } from '../config/home.js';
import { getProviderRuntime } from './store.js';
import { validateProviderId } from './validate.js';

const PROBE_TIMEOUT_MS = 30_000;
const CAPABILITIES_SCHEMA_VERSION = 1;

/** Minimal JSON Schema used for capability probes. */
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
 * @param {string} id
 * @returns {string}
 */
function capabilitiesPath(id) {
  validateProviderId(id);
  return path.join(getMinnowHome(), 'providers', id, 'capabilities.json');
}

/**
 * @param {unknown} raw
 * @param {string} providerId
 */
function normalizeCapabilities(raw, providerId) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const row = /** @type {Record<string, unknown>} */ (raw);
  return {
    schemaVersion:
      typeof row.schemaVersion === 'number' ? row.schemaVersion : CAPABILITIES_SCHEMA_VERSION,
    probedAt: typeof row.probedAt === 'string' ? row.probedAt : '',
    providerId: typeof row.providerId === 'string' ? row.providerId : providerId,
    structuredOutput: row.structuredOutput === true,
    structuredOutputWithTools: row.structuredOutputWithTools === true,
    structuredOutputStreaming: row.structuredOutputStreaming === true,
    probeError: typeof row.probeError === 'string' ? row.probeError : null,
    models:
      row.models && typeof row.models === 'object'
        ? /** @type {Record<string, unknown>} */ (row.models)
        : undefined,
  };
}

/**
 * @param {string} id
 */
export async function readProviderCapabilitiesFile(id) {
  try {
    const raw = await fs.readFile(capabilitiesPath(id), 'utf8');
    return normalizeCapabilities(JSON.parse(raw), id);
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') {
      return null;
    }
    throw err;
  }
}

/**
 * @param {string} id
 * @param {object} caps
 */
async function writeProviderCapabilitiesFile(id, caps) {
  const file = capabilitiesPath(id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(tmp, `${JSON.stringify(caps, null, 2)}\n`, 'utf8');
  await fs.rename(tmp, file);
}

/**
 * @param {{ url: string, headers: Record<string, string>, body: object }} params
 * @returns {Promise<{ ok: boolean, status: number, error?: string }>}
 */
async function postProbeCompletion({ url, headers, body }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
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
    if (res.ok) {
      return { ok: true, status: res.status };
    }
    const text = await res.text();
    return {
      ok: false,
      status: res.status,
      error: text.slice(0, 300),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, status: 0, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
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

  const structuredOnly = await postProbeCompletion({
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

  const withTools = await postProbeCompletion({
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

  const streaming = await postProbeCompletion({
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

  /** @type {Record<string, unknown>} */
  const caps = {
    schemaVersion: CAPABILITIES_SCHEMA_VERSION,
    probedAt: new Date().toISOString(),
    providerId: id,
    structuredOutput: structuredOnly.ok,
    structuredOutputWithTools: withTools.ok,
    structuredOutputStreaming: streaming.ok,
    probeError,
  };

  if (modelId) {
    caps.models = {
      [modelId]: {
        structuredOutput: withTools.ok || structuredOnly.ok,
        denyReason: null,
      },
    };
  }

  await writeProviderCapabilitiesFile(id, caps);
  return caps;
}
