/**
 * Role-based fallback chain resolution and upstream error classification.
 */

/** @typedef {'default' | 'utility' | 'vision' | 'research'} FallbackRole */

/** @typedef {{ providerId: string, modelId: string }} FallbackCandidate */

export const FALLBACK_ROLES = ['default', 'utility', 'vision', 'research'];

const RETRYABLE_NODE_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

const RETRYABLE_HTTP_STATUSES = new Set([502, 503, 504]);

/**
 * @param {unknown} config
 * @returns {{ enabled: boolean, cooldownSeconds: number, maxChainLength: number, roles: Record<string, FallbackCandidate[]> }}
 */
export function readFallbackChainsConfig(config) {
  const block =
    config && typeof config === 'object' && config.fallbackChains && typeof config.fallbackChains === 'object'
      ? /** @type {Record<string, unknown>} */ (config.fallbackChains)
      : {};

  const roles = {};
  if (block.roles && typeof block.roles === 'object') {
    for (const [role, entries] of Object.entries(/** @type {Record<string, unknown>} */ (block.roles))) {
      if (!Array.isArray(entries)) continue;
      roles[role] = entries
        .map((entry) => normalizeCandidate(entry))
        .filter((entry) => entry !== null);
    }
  }

  return {
    enabled: block.enabled === true,
    cooldownSeconds:
      typeof block.cooldownSeconds === 'number' && Number.isFinite(block.cooldownSeconds)
        ? block.cooldownSeconds
        : 60,
    maxChainLength:
      typeof block.maxChainLength === 'number' && Number.isFinite(block.maxChainLength)
        ? block.maxChainLength
        : 4,
    roles,
  };
}

/**
 * @param {unknown} entry
 * @returns {FallbackCandidate | null}
 */
function normalizeCandidate(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const row = /** @type {Record<string, unknown>} */ (entry);
  if (typeof row.providerId !== 'string' || !row.providerId.trim()) return null;
  return {
    providerId: row.providerId.trim(),
    modelId: typeof row.modelId === 'string' ? row.modelId : '',
  };
}

/**
 * @param {string} providerId
 * @param {string} modelId
 * @returns {string}
 */
export function candidateKey(providerId, modelId) {
  return `${providerId}:${modelId}`;
}

/**
 * Build an ordered, deduped candidate list capped at maxChainLength.
 *
 * @param {{
 *   role?: string | null,
 *   primaryProviderId: string,
 *   primaryModelId?: string,
 *   config?: unknown,
 *   enabledProviderIds?: Set<string> | string[],
 * }} params
 * @returns {FallbackCandidate[]}
 */
export function resolveFallbackChain({
  role,
  primaryProviderId,
  primaryModelId = '',
  config,
  enabledProviderIds,
}) {
  const primaryModel = typeof primaryModelId === 'string' ? primaryModelId : '';
  const primary = {
    providerId: primaryProviderId,
    modelId: primaryModel,
  };

  const fallback = readFallbackChainsConfig(config);
  if (!fallback.enabled) {
    return [primary];
  }

  const enabled = toEnabledSet(enabledProviderIds);
  const roleKey = typeof role === 'string' && role.trim() ? role.trim() : 'default';
  const roleChain = Array.isArray(fallback.roles[roleKey]) ? fallback.roles[roleKey] : [];

  /** @type {FallbackCandidate[]} */
  const ordered = [];
  const seen = new Set();

  const pushCandidate = (candidate) => {
    if (!candidate.providerId) return;
    if (enabled && !enabled.has(candidate.providerId)) return;
    const modelId =
      typeof candidate.modelId === 'string' && candidate.modelId.trim()
        ? candidate.modelId.trim()
        : primaryModel;
    const key = candidateKey(candidate.providerId, modelId);
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push({ providerId: candidate.providerId, modelId });
  };

  pushCandidate(primary);
  for (const step of roleChain) {
    pushCandidate(step);
    if (ordered.length >= fallback.maxChainLength) break;
  }

  if (ordered.length === 0) {
    return [primary];
  }

  return ordered.slice(0, fallback.maxChainLength);
}

/**
 * @param {Set<string> | string[] | undefined} enabledProviderIds
 * @returns {Set<string> | null}
 */
function toEnabledSet(enabledProviderIds) {
  if (!enabledProviderIds) return null;
  if (enabledProviderIds instanceof Set) return enabledProviderIds;
  if (Array.isArray(enabledProviderIds)) {
    return new Set(enabledProviderIds.filter((id) => typeof id === 'string' && id.trim()));
  }
  return null;
}

/**
 * @param {unknown} err
 * @param {{ status?: number } | null | undefined} [response]
 * @returns {{ kind: 'retryable' | 'fatal', reason: string }}
 */
export function classifyUpstreamError(err, response) {
  const status = response?.status;

  if (typeof status === 'number') {
    if (status === 401 || status === 403) {
      return { kind: 'fatal', reason: `Upstream HTTP ${status} (auth)` };
    }
    if (status === 400) {
      return { kind: 'fatal', reason: 'Upstream HTTP 400 (bad request / model not found)' };
    }
    if (status === 422) {
      return { kind: 'fatal', reason: 'Upstream HTTP 422 (validation)' };
    }
    if (RETRYABLE_HTTP_STATUSES.has(status)) {
      return { kind: 'retryable', reason: `Upstream HTTP ${status}` };
    }
    if (status >= 500) {
      return { kind: 'retryable', reason: `Upstream HTTP ${status}` };
    }
    return { kind: 'fatal', reason: `Upstream HTTP ${status}` };
  }

  if (err && typeof err === 'object') {
    const e = /** @type {{ name?: string, code?: string, message?: string, cause?: unknown }} */ (err);
    if (e.name === 'AbortError') {
      return { kind: 'fatal', reason: 'Request aborted' };
    }
    if (typeof e.code === 'string' && RETRYABLE_NODE_CODES.has(e.code)) {
      return { kind: 'retryable', reason: e.code };
    }
    if (e.cause) {
      return classifyUpstreamError(e.cause, response);
    }
    const message = typeof e.message === 'string' ? e.message : String(err);
    const lower = message.toLowerCase();
    if (
      lower.includes('econnrefused') ||
      lower.includes('enotfound') ||
      lower.includes('etimedout') ||
      lower.includes('fetch failed') ||
      lower.includes('network')
    ) {
      return { kind: 'retryable', reason: message };
    }
    return { kind: 'fatal', reason: message };
  }

  return { kind: 'fatal', reason: String(err) };
}

/**
 * @param {Buffer} requestBody
 * @param {string} modelId
 * @returns {Buffer}
 */
export function buildCandidateRequestBody(requestBody, modelId) {
  if (!modelId) return requestBody;
  try {
    const parsed = JSON.parse(requestBody.toString('utf8'));
    if (!parsed || typeof parsed !== 'object') return requestBody;
    return Buffer.from(JSON.stringify({ ...parsed, model: modelId }), 'utf8');
  } catch {
    return requestBody;
  }
}
