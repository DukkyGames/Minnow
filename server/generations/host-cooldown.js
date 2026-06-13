/**
 * Module-level dead-host cooldown keyed by provider origin (scheme + host + port).
 */

/** @type {Map<string, number>} origin → expiresAt epoch ms */
const deadHosts = new Map();

/**
 * @param {string} origin
 * @param {number} cooldownSeconds
 */
export function markHostDead(origin, cooldownSeconds) {
  const key = normalizeOrigin(origin);
  if (!key) return;
  const seconds = Number.isFinite(cooldownSeconds) ? Math.max(0.001, cooldownSeconds) : 60;
  const expiresAt = Date.now() + seconds * 1000;
  const existing = deadHosts.get(key);
  if (existing === undefined || expiresAt > existing) {
    deadHosts.set(key, expiresAt);
  }
}

/**
 * @param {string} origin
 * @returns {boolean}
 */
export function isHostDead(origin) {
  const key = normalizeOrigin(origin);
  if (!key) return false;
  const expiresAt = deadHosts.get(key);
  if (expiresAt === undefined) return false;
  if (Date.now() >= expiresAt) {
    deadHosts.delete(key);
    return false;
  }
  return true;
}

/**
 * @returns {{ origin: string, dead: boolean, expiresAt: string }[]}
 */
export function listDeadHosts() {
  const now = Date.now();
  const rows = [];
  for (const [origin, expiresAt] of deadHosts.entries()) {
    if (now >= expiresAt) {
      deadHosts.delete(origin);
      continue;
    }
    rows.push({
      origin,
      dead: true,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }
  rows.sort((a, b) => a.origin.localeCompare(b.origin));
  return rows;
}

/**
 * @param {string} urlOrOrigin
 * @returns {string}
 */
export function originFromUrl(urlOrOrigin) {
  try {
    return new URL(urlOrOrigin).origin;
  } catch {
    return normalizeOrigin(urlOrOrigin);
  }
}

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeOrigin(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
}

/** Reset map (tests only). */
export function resetHostCooldownForTests() {
  deadHosts.clear();
}
