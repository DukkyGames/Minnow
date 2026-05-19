/**
 * In-process snapshot cache keyed by browser_url + target_id (opencode-browser pattern).
 */

/** @type {Map<string, import('./snapshot.js').Snapshot>} */
const cache = new Map();

/**
 * @param {string} browserUrl
 * @param {string | undefined} targetId
 */
export function cacheKey(browserUrl, targetId) {
  return `${browserUrl}::${targetId ?? ''}`;
}

/**
 * @param {string} key
 * @param {import('./snapshot.js').Snapshot} snap
 */
export function setSnapshot(key, snap) {
  cache.set(key, snap);
}

/**
 * @param {string} key
 * @returns {import('./snapshot.js').Snapshot | undefined}
 */
export function getSnapshot(key) {
  return cache.get(key);
}

/** Clear all cached snapshots (tests). */
export function clearSnapshotCache() {
  cache.clear();
}
