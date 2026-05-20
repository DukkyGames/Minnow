/**
 * Validate prompt-config JSON against Step 04 schema (subset checks).
 */

const PART_IDS = new Set([
  'base',
  'mode',
  'expert',
  'tool-usage',
  'info',
  'memory',
  'work-agent',
  'skill',
]);

const ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

/**
 * @param {unknown} body
 * @returns {{ ok: true, config: object } | { ok: false, error: string }}
 */
export function validatePromptConfig(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Config must be an object' };
  }

  const config = /** @type {Record<string, unknown>} */ (body);

  if (typeof config.id !== 'string' || !ID_PATTERN.test(config.id)) {
    return { ok: false, error: 'Invalid config id' };
  }
  if (typeof config.label !== 'string' || !config.label.trim() || config.label.length > 120) {
    return { ok: false, error: 'Invalid label' };
  }
  if (config.profile !== 'custom') {
    return { ok: false, error: 'profile must be "custom"' };
  }
  if (!config.parts || typeof config.parts !== 'object' || Array.isArray(config.parts)) {
    return { ok: false, error: 'parts must be an object' };
  }

  const parts = /** @type {Record<string, unknown>} */ (config.parts);
  for (const key of Object.keys(parts)) {
    if (!PART_IDS.has(key)) {
      return { ok: false, error: `Unknown part: ${key}` };
    }
    const part = parts[key];
    if (!part || typeof part !== 'object' || Array.isArray(part)) {
      return { ok: false, error: `Invalid part settings: ${key}` };
    }
    const settings = /** @type {Record<string, unknown>} */ (part);
    if (typeof settings.enabled !== 'boolean') {
      return { ok: false, error: `part ${key} requires enabled boolean` };
    }
    if (
      settings.contentOverride != null &&
      typeof settings.contentOverride !== 'string'
    ) {
      return { ok: false, error: `part ${key} contentOverride must be string or null` };
    }
  }

  const extraKeys = Object.keys(config).filter(
    (k) => !['id', 'label', 'profile', 'parts', 'meta'].includes(k),
  );
  if (extraKeys.length > 0) {
    return { ok: false, error: `Unexpected fields: ${extraKeys.join(', ')}` };
  }

  return { ok: true, config };
}
