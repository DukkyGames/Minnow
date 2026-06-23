/**
 * Minnow dev-server network access — local (loopback) vs LAN (all interfaces).
 */

import net from 'node:net';
import { isPrivateIpAddress } from '../webhooks/ssrf.js';

/** @typedef {'local' | 'lan'} NetworkAccess */

/** Active bind mode set once at server boot. */
/** @type {NetworkAccess} */
let activeNetworkAccess = 'local';

/** Last known value from config.json (ignores env override). */
/** @type {NetworkAccess} */
let configNetworkAccess = 'local';

const NETWORK_ACCESS_VALUES = new Set(['local', 'lan']);

/**
 * Normalize persisted config value.
 * @param {unknown} value
 * @returns {NetworkAccess | null}
 */
export function normalizeNetworkAccess(value) {
  if (typeof value !== 'string') return null;
  const mode = value.trim().toLowerCase();
  return NETWORK_ACCESS_VALUES.has(mode) ? /** @type {NetworkAccess} */ (mode) : null;
}

/**
 * Resolve network mode from config only (no env).
 * @param {unknown} configMeta
 * @returns {NetworkAccess}
 */
export function resolveConfigNetworkAccess(configMeta) {
  const fromConfig =
    configMeta && typeof configMeta === 'object'
      ? normalizeNetworkAccess(/** @type {{ server?: { networkAccess?: unknown } }} */ (configMeta).server?.networkAccess)
      : null;
  return fromConfig ?? 'local';
}

/**
 * Resolve active network mode — MINNOW_NETWORK env wins, else config, default local.
 * @param {unknown} configMeta
 * @returns {NetworkAccess}
 */
export function resolveNetworkAccess(configMeta) {
  const fromEnv = normalizeNetworkAccess(process.env.MINNOW_NETWORK);
  if (fromEnv) return fromEnv;
  return resolveConfigNetworkAccess(configMeta);
}

/**
 * Record boot-time and config values for WS policy and restart detection.
 * @param {unknown} configMeta
 */
export function initNetworkAccess(configMeta) {
  configNetworkAccess = resolveConfigNetworkAccess(configMeta);
  activeNetworkAccess = resolveNetworkAccess(configMeta);
}

/**
 * Update persisted config value after PUT /api/config/meta (active bind unchanged until restart).
 * @param {NetworkAccess} mode
 */
export function setConfigNetworkAccess(mode) {
  if (NETWORK_ACCESS_VALUES.has(mode)) {
    configNetworkAccess = mode;
  }
}

/** @returns {NetworkAccess} */
export function getNetworkAccess() {
  return activeNetworkAccess;
}

/** @returns {NetworkAccess} */
export function getConfigNetworkAccess() {
  return configNetworkAccess;
}

/** True when saved config differs from the running bind mode. */
export function isNetworkRestartRequired() {
  return configNetworkAccess !== activeNetworkAccess;
}

/**
 * Vite `server.host` for the resolved mode.
 * @param {NetworkAccess} networkAccess
 * @returns {string | boolean}
 */
export function resolveViteHost(networkAccess) {
  return networkAccess === 'lan' ? true : 'localhost';
}

/**
 * @param {string} address
 * @returns {boolean}
 */
function isLoopbackAddress(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.endsWith('127.0.0.1')
  );
}

/**
 * Whether a WebSocket upgrade client may connect.
 * Loopback is always allowed; LAN mode also allows private-network addresses.
 * @param {import('http').IncomingMessage} req
 * @param {NetworkAccess} [networkAccess]
 * @returns {boolean}
 */
export function isClientAllowed(req, networkAccess = activeNetworkAccess) {
  const addr = req.socket?.remoteAddress ?? '';
  if (!addr) return false;
  if (isLoopbackAddress(addr)) return true;
  if (networkAccess !== 'lan') return false;

  const normalized = addr.startsWith('::ffff:') ? addr.slice(7) : addr;
  if (net.isIP(normalized) === 0 && net.isIP(addr) === 0) return false;
  return isPrivateIpAddress(addr);
}
