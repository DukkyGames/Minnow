/**
 * Feature flag for the server-owned Session Engine (MIN-354 / MIN-362 Phase 4).
 * Default ON — chat/board/sub-agent driving runs in the engine.
 * Emergency opt-out: MINNOW_SERVER_ENGINE=0|false|off|no.
 */

/**
 * True unless MINNOW_SERVER_ENGINE is explicitly disabled (0/false/off/no).
 * Unset / empty ⇒ enabled (default-on cutover).
 * @returns {boolean}
 */
export function isServerEngineEnabled() {
  const raw = process.env.MINNOW_SERVER_ENGINE;
  if (raw == null || raw === '') return true;
  const normalized = String(raw).trim().toLowerCase();
  if (
    normalized === '0' ||
    normalized === 'false' ||
    normalized === 'off' ||
    normalized === 'no'
  ) {
    return false;
  }
  // Any other explicit value (1/true/yes/on/…) keeps the engine on.
  return true;
}
