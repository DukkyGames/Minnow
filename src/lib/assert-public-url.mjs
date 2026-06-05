/**
 * SSRF guard for research page fetch — rejects private, loopback, link-local, and metadata targets.
 * Config-controlled search API endpoints are exempt (callers do not route those through here).
 */

import dns from 'node:dns/promises';
import net from 'node:net';
import { validateHttpUrl } from './fetch-web-content.mjs';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.google',
]);

/**
 * @param {string} host
 * @returns {boolean}
 */
function isBlockedHostname(host) {
  const lower = String(host ?? '').toLowerCase().replace(/\.$/, '');
  if (!lower) {
    return true;
  }
  if (BLOCKED_HOSTNAMES.has(lower)) {
    return true;
  }
  if (lower.endsWith('.localhost')) {
    return true;
  }
  if (lower.endsWith('.local')) {
    return true;
  }
  return false;
}

/**
 * @param {string} ip
 * @returns {boolean}
 */
function isBlockedIp(ip) {
  const version = net.isIP(ip);
  if (version === 4) {
    const parts = ip.split('.').map((p) => Number(p));
    if (parts[0] === 10) {
      return true;
    }
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      return true;
    }
    if (parts[0] === 192 && parts[1] === 168) {
      return true;
    }
    if (parts[0] === 127) {
      return true;
    }
    if (parts[0] === 169 && parts[1] === 254) {
      return true;
    }
    if (parts[0] === 0) {
      return true;
    }
    return false;
  }

  if (version === 6) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') {
      return true;
    }
    if (lower.startsWith('fe80:')) {
      return true;
    }
    if (lower.startsWith('fc') || lower.startsWith('fd')) {
      return true;
    }
    if (lower.startsWith('::ffff:')) {
      const mapped = lower.slice('::ffff:'.length);
      if (net.isIP(mapped) === 4) {
        return isBlockedIp(mapped);
      }
    }
    return false;
  }

  return true;
}

/**
 * Resolve hostname and ensure every address is public.
 * @param {string} hostname
 * @returns {Promise<void>}
 */
async function assertResolvablePublicHost(hostname) {
  if (isBlockedHostname(hostname)) {
    throw new Error(`Error: blocked host "${hostname}" (private or metadata)`);
  }

  const literalVersion = net.isIP(hostname);
  if (literalVersion) {
    if (isBlockedIp(hostname)) {
      throw new Error(`Error: blocked IP "${hostname}" (private, loopback, or link-local)`);
    }
    return;
  }

  let records;
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Error: could not resolve host "${hostname}" (${message})`);
  }

  if (!records.length) {
    throw new Error(`Error: no DNS records for host "${hostname}"`);
  }

  for (const record of records) {
    if (isBlockedIp(record.address)) {
      throw new Error(
        `Error: host "${hostname}" resolves to blocked address ${record.address}`,
      );
    }
  }
}

/**
 * Validates http(s) URL and ensures the target is not a private/metadata endpoint.
 * @param {string} urlString
 * @returns {Promise<URL>}
 */
export async function assertPublicUrl(urlString) {
  const validated = validateHttpUrl(urlString);
  if (!validated.ok) {
    throw new Error(validated.error);
  }

  await assertResolvablePublicHost(validated.url.hostname);
  return validated.url;
}
