/**
 * Local fetcher for remote email images.
 *
 * When the user chooses to load images, the request must not go out from the
 * renderer: a direct fetch carries the Referer, any ambient cookies, and the
 * browser's own fingerprint to the sender's tracking host. Routing through the
 * server strips all of that — the sender learns only that some IP fetched the
 * image, with no message correlation from headers.
 *
 * Only reachable for allowed images; see `remote-content.js` for the blocking
 * that makes this opt-in.
 */

import net from 'node:net';
import { isPrivateIpAddress, resolveHostnameIps } from '../webhooks/ssrf.js';

/** Cap on proxied image size — enough for banner art, not for exfiltration. */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

/** Remote hosts get one shot; a hung tracker must not pin a socket open. */
const FETCH_TIMEOUT_MS = 10_000;

/** CDNs redirect constantly, but each hop is re-validated. */
const MAX_REDIRECTS = 3;

/**
 * Reject anything that is not a public http(s) endpoint.
 *
 * Note: the address is validated, then fetched by hostname, so a hostile DNS
 * server could in principle answer differently for the two lookups. Pinning the
 * resolved address through `fetch` is not expressible with the global fetch, and
 * the residual window only matters to an attacker who already controls the
 * user's resolver — at which point the LAN is theirs regardless.
 *
 * @param {string} rawUrl
 * @returns {Promise<URL>}
 */
async function validateImageUrl(rawUrl) {
  const trimmed = String(rawUrl ?? '').trim();
  if (!trimmed) {
    throw new Error('url is required');
  }
  if (trimmed.length > 2048) {
    throw new Error('url too long');
  }

  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('url must be an absolute http(s) URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('url must use http or https');
  }

  const hostname = (parsed.hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!hostname) {
    throw new Error('url must have a hostname');
  }

  const addrs = net.isIP(hostname) ? [hostname] : await resolveHostnameIps(hostname);
  if (addrs.length === 0) {
    throw new Error('url host does not resolve');
  }
  if (addrs.some((addr) => isPrivateIpAddress(addr))) {
    throw new Error('url must not point to private/internal addresses');
  }

  return parsed;
}

/**
 * Fetch a remote image with no referrer, no credentials, and no redirect
 * laundering past the SSRF check.
 * @param {string} rawUrl
 * @returns {Promise<{ body: Buffer, contentType: string }>}
 */
export async function fetchRemoteImage(rawUrl) {
  let target = await validateImageUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let res;
    try {
      res = await fetch(target, {
        method: 'GET',
        redirect: 'manual',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
        headers: {
          // A bare Accept keeps the request from advertising anything the
          // sender could fingerprint. No Referer, no Cookie, no User-Agent
          // beyond the runtime default.
          Accept: 'image/*',
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        throw new Error('redirect without a location');
      }
      // Re-validate: a public host must not be able to bounce us onto the LAN.
      target = await validateImageUrl(new URL(location, target).toString());
      continue;
    }

    if (!res.ok) {
      throw new Error(`upstream responded ${res.status}`);
    }

    const contentType = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error('upstream did not return an image');
    }

    const declared = Number(res.headers.get('content-length') ?? 0);
    if (declared > MAX_IMAGE_BYTES) {
      throw new Error('image too large');
    }

    const body = Buffer.from(await res.arrayBuffer());
    if (body.byteLength > MAX_IMAGE_BYTES) {
      throw new Error('image too large');
    }

    return { body, contentType };
  }

  throw new Error('too many redirects');
}
