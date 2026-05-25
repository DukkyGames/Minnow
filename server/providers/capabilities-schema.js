/**
 * Schema validation for ~/.minnow/providers/<id>/capabilities.json
 */

const SCHEMA_VERSION = 1;

const CAPABILITY_SOURCES = new Set(['catalog', 'probe', 'assumed']);

/**
 * @param {unknown} value
 * @returns {boolean | null}
 */
function coerceNullableBool(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value;
  return null;
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
function coerceNullableNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string>}
 */
function normalizeProbeErrors(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && value.trim()) {
      out[key] = value.trim();
    }
  }
  return out;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string> | undefined}
 */
function normalizeSources(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === 'string' && CAPABILITY_SOURCES.has(value)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * @param {unknown} raw
 * @returns {object | null}
 */
export function normalizeModelCapabilities(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const row = /** @type {Record<string, unknown>} */ (raw);

  return {
    vision: coerceNullableBool(row.vision),
    tools: coerceNullableBool(row.tools),
    streaming: coerceNullableBool(row.streaming),
    grammar: coerceNullableBool(row.grammar),
    reasoning: coerceNullableBool(row.reasoning),
    contextLength: coerceNullableNumber(row.contextLength),
    loadState:
      typeof row.loadState === 'string' && row.loadState.trim()
        ? row.loadState.trim()
        : null,
    sources: normalizeSources(row.sources),
    probeErrors: normalizeProbeErrors(row.probeErrors),
  };
}

/**
 * @param {unknown} raw
 * @returns {{ schemaVersion: number, providerId: string, probedAt: string, apiKind: string, models: Record<string, object> }}
 */
export function normalizeCapabilitiesFile(raw) {
  if (!raw || typeof raw !== 'object') {
    return {
      schemaVersion: SCHEMA_VERSION,
      providerId: '',
      probedAt: new Date(0).toISOString(),
      apiKind: 'openai-v1',
      models: {},
    };
  }

  const file = /** @type {Record<string, unknown>} */ (raw);
  const models = {};
  if (file.models && typeof file.models === 'object') {
    for (const [modelId, cap] of Object.entries(file.models)) {
      if (typeof modelId !== 'string' || !modelId.trim()) continue;
      const normalized = normalizeModelCapabilities(cap);
      if (normalized) models[modelId] = normalized;
    }
  }

  return {
    schemaVersion:
      typeof file.schemaVersion === 'number' && file.schemaVersion > 0
        ? file.schemaVersion
        : SCHEMA_VERSION,
    providerId: typeof file.providerId === 'string' ? file.providerId : '',
    probedAt:
      typeof file.probedAt === 'string' && file.probedAt.trim()
        ? file.probedAt
        : new Date(0).toISOString(),
    apiKind:
      typeof file.apiKind === 'string' && file.apiKind.trim()
        ? file.apiKind
        : 'openai-v1',
    models,
  };
}

/**
 * @param {object} file
 * @returns {object}
 */
export function validateCapabilitiesFile(file) {
  const normalized = normalizeCapabilitiesFile(file);
  if (normalized.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`Unsupported capabilities schemaVersion: ${normalized.schemaVersion}`);
  }
  return normalized;
}

export { SCHEMA_VERSION };
