/**
 * Minnow dev-server network access — local (loopback) vs LAN (all interfaces).
 */

import net from 'node:net';
import os from 'node:os';
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
 * True for loopback remote addresses only. Requires a separator before a
 * trailing 127.0.0.1 so values like `foo127.0.0.1` are not treated as loopback.
 * @param {string} address
 * @returns {boolean}
 */
export function isLoopbackAddress(address) {
  return (
    address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1' ||
    address.endsWith(':127.0.0.1')
  );
}

/**
 * Whether the request's TCP peer is loopback. Unlike `isClientAllowed`, this
 * never admits private LAN addresses — used for the session-token bootstrap.
 * @param {import('http').IncomingMessage} req
 * @returns {boolean}
 */
export function isLoopbackClient(req) {
  const addr = req.socket?.remoteAddress ?? '';
  if (!addr) return false;
  return isLoopbackAddress(addr);
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

/**
 * @param {string} hostname - already lowercased, port stripped
 * @returns {boolean}
 */
function isLoopbackHostname(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Strip a trailing `:port` from a `Host` header value. Handles bracketed
 * IPv6 literals (`[::1]:9473`) and bare IPv6 (`::1`, no port — browsers
 * always bracket IPv6 literals that carry a port).
 * @param {string} host
 * @returns {string}
 */
function stripHostPort(host) {
  if (!host) return '';
  if (host.startsWith('[')) {
    const end = host.indexOf(']');
    return end === -1 ? '' : host.slice(1, end);
  }
  const colonCount = host.split(':').length - 1;
  if (colonCount <= 1) {
    const idx = host.indexOf(':');
    return idx === -1 ? host : host.slice(0, idx);
  }
  return host;
}

/** @type {Set<string> | null} */
let cachedOwnLanHostnames = null;

/**
 * This machine's own hostname plus non-internal interface addresses,
 * lowercased. Used to allow LAN clients that reach us via our real LAN IP
 * while still rejecting an attacker-chosen Host header (DNS rebinding).
 * @returns {Set<string>}
 */
function getOwnLanHostnames() {
  if (cachedOwnLanHostnames) return cachedOwnLanHostnames;
  const names = new Set([os.hostname().toLowerCase()]);
  const interfaces = os.networkInterfaces();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (!entry.internal) names.add(entry.address.toLowerCase());
    }
  }
  cachedOwnLanHostnames = names;
  return names;
}

/** Reset cached LAN hostname set (tests only). */
export function resetOwnLanHostnamesCache() {
  cachedOwnLanHostnames = null;
}

/**
 * Anti-DNS-rebinding `Host` header check for /api/* requests. Loopback
 * hostnames are always allowed; in LAN mode, this machine's own hostname/IPs
 * are also allowed. Everything else (including an attacker's domain that
 * merely *resolves* to a local address) is rejected.
 * @param {string} hostHeader - raw `Host` header value (may include :port)
 * @param {NetworkAccess} [networkAccess]
 * @returns {boolean}
 */
export function isHostAllowed(hostHeader, networkAccess = activeNetworkAccess) {
  const hostname = stripHostPort(hostHeader).toLowerCase();
  if (!hostname) return false;
  if (isLoopbackHostname(hostname)) return true;
  if (networkAccess !== 'lan') return false;
  return getOwnLanHostnames().has(hostname);
}
