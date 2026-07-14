/**
 * Dot-path helpers for settings field resolution.
 */

/**
 * @param {unknown} root
 * @param {string} dotPath
 */
export function getAtPath(root, dotPath) {
  if (!dotPath) return root;
  const parts = dotPath.split('.');
  let cur = root;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = /** @type {Record<string, unknown>} */ (cur)[part];
  }
  return cur;
}

/**
 * @param {Record<string, unknown>} root
 * @param {string} dotPath
 * @param {unknown} value
 */
export function setAtPath(root, dotPath, value) {
  const parts = dotPath.split('.');
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const next = cur[part];
    if (next == null || typeof next !== 'object') {
      cur[part] = {};
    }
    cur = /** @type {Record<string, unknown>} */ (cur[part]);
  }
  cur[parts[parts.length - 1]] = value;
}

/**
 * Build a nested patch object from a dot path and value.
 * @param {string} dotPath
 * @param {unknown} value
 */
export function patchFromPath(dotPath, value) {
  const parts = dotPath.split('.');
  /** @type {Record<string, unknown>} */
  const root = {};
  let cur = root;
  for (let i = 0; i < parts.length - 1; i++) {
    cur[parts[i]] = {};
    cur = /** @type {Record<string, unknown>} */ (cur[parts[i]]);
  }
  cur[parts[parts.length - 1]] = value;
  return root;
}
