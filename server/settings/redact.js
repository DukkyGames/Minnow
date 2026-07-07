/**
 * Redact secret values for get_settings responses.
 */

/** @param {unknown} value */
export function redactSecretValue(value) {
  if (value == null) return { value: null, configured: false, redacted: false };
  const str = String(value).trim();
  if (!str) return { value: null, configured: false, redacted: false };
  return { value: '[redacted]', configured: true, redacted: true };
}

/**
 * @param {unknown} value
 * @param {import('../../src/settings/types.ts').SettingsFieldDef} field
 */
export function formatReadValue(value, field) {
  if (field.sensitivity === 'secret') {
    if (field.type === 'json' && value && typeof value === 'object') {
      /** @type {Record<string, unknown>} */
      const redacted = {};
      for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        const inner = redactSecretValue(v);
        redacted[k] = inner.configured ? '[redacted]' : null;
      }
      return { value: redacted, configured: true, redacted: true };
    }
    return redactSecretValue(value);
  }
  if (value === undefined) {
    return { value: null, configured: false };
  }
  return { value, configured: value != null && value !== '' };
}
