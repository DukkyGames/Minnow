/**
 * CalDAV URL validation — SSRF guard for remote calendar endpoints.
 */

import net from 'node:net';
import {
  isPrivateIpAddress,
  isPrivateUrl,
  resolveHostnameIps,
} from '../webhooks/ssrf.js';

/**
 * Validate a CalDAV server URL before saving credentials or syncing.
 * @param {string} url
 * @param {{ allowLocalHttp?: boolean }} [options]
 */
export async function validateCaldavUrl(url, options = {}) {
  const trimmed = typeof url === 'string' ? url.trim() : '';
  if (!trimmed) {
    throw new Error('CalDAV URL is required');
  }
  if (trimmed.length > 2048) {
    throw new Error('CalDAV URL too long (max 2048 characters)');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('CalDAV URL must be a valid http or https URL');
  }

  const allowLocalHttp = options.allowLocalHttp === true;
  if (parsed.protocol !== 'https:' && !(allowLocalHttp && parsed.protocol === 'http:')) {
    throw new Error('CalDAV URL must use https (or http://127.0.0.1 when local CalDAV is enabled)');
  }

  if (!parsed.hostname) {
    throw new Error('CalDAV URL must have a hostname');
  }

  if (await isPrivateUrl(trimmed, { allowLocalHttp })) {
    throw new Error('CalDAV URL must not point to private/internal addresses');
  }

  return trimmed.replace(/\/+$/, '');
}

/**
 * Resolve hostname and reject private targets (DNS rebinding guard).
 * @param {string} hostname
 */
export async function assertResolvablePublicHost(hostname) {
  if (net.isIP(hostname)) {
    if (isPrivateIpAddress(hostname)) {
      throw new Error('CalDAV host resolves to a private address');
    }
    return;
  }

  const ips = await resolveHostnameIps(hostname);
  if (ips.length === 0) {
    throw new Error('CalDAV host does not resolve');
  }
  if (ips.some((ip) => isPrivateIpAddress(ip))) {
    throw new Error('CalDAV host resolves to a private address');
  }
}
