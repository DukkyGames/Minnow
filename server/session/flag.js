/**
 * Feature flag for the server-owned Session Engine (MIN-354 Phase 1 / MIN-359).
 * Default OFF — renderer loop.ts remains the main-chat driver until flipped.
 */

/**
 * True when MINNOW_SERVER_ENGINE is explicitly enabled (1/true/yes/on).
 * @returns {boolean}
 */
export function isServerEngineEnabled() {
  const raw = process.env.MINNOW_SERVER_ENGINE;
  if (raw == null || raw === '') return false;
  const normalized = String(raw).trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}
