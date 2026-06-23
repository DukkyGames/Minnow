/**
 * LAN address discovery for Settings and GET /api/system/network.
 */

import os from 'node:os';
import {
  getConfigNetworkAccess,
  getNetworkAccess,
  isNetworkRestartRequired,
  resolveConfigNetworkAccess,
} from '../network/access.js';
import { readConfigJson } from '../config/store.js';

/**
 * List non-internal IPv4 LAN addresses (excludes loopback and link-local).
 * @returns {string[]}
 */
export function listLanAddresses() {
  const seen = new Set();
  const out = [];

  for (const entries of Object.values(os.networkInterfaces())) {
    if (!entries) continue;
    for (const entry of entries) {
      if (entry.internal || entry.family !== 'IPv4') continue;
      const addr = entry.address.trim();
      if (!addr || addr.startsWith('127.') || addr.startsWith('169.254.')) continue;
      if (seen.has(addr)) continue;
      seen.add(addr);
      out.push(addr);
    }
  }

  return out.sort();
}

/**
 * Build reachable http URLs for each LAN address.
 * @param {number} port
 * @returns {string[]}
 */
export function buildNetworkUrls(port) {
  return listLanAddresses().map((addr) => `http://${addr}:${port}/`);
}

/**
 * Snapshot for GET /api/system/network.
 * @param {{ port: number, localUrl?: string }} opts
 * @returns {Promise<{
 *   networkAccess: string,
 *   port: number,
 *   localUrl: string,
 *   lanUrls: string[],
 *   restartRequired: boolean,
 *   configNetworkAccess: string,
 * }>}
 */
export async function getNetworkStatus(opts) {
  const port = Number(opts.port) || 5173;
  const localUrl = opts.localUrl?.trim() || `http://localhost:${port}/`;
  const meta = (await readConfigJson('config.json')) ?? {};
  const persisted = resolveConfigNetworkAccess(meta);

  return {
    networkAccess: getNetworkAccess(),
    configNetworkAccess: persisted,
    port,
    localUrl: localUrl.endsWith('/') ? localUrl : `${localUrl}/`,
    lanUrls: buildNetworkUrls(port),
    restartRequired: isNetworkRestartRequired(),
  };
}
