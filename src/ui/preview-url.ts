/**
 * Address-bar parsing and file URL helpers for the in-app Chromium preview.
 */

const HTTP_URL_RE = /^https?:\/\//i;
const FILE_URL_RE = /^file:\/\//i;
const WINDOWS_ABS_RE = /^[a-zA-Z]:[\\/]/;
const IPV4_RE = /^(\d{1,3}\.){3}\d{1,3}$/;
const DOMAIN_LABEL_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i;

/**
 * Common TLDs we recognize for bare-hostname auto-prefixing in the address bar.
 * Distinguishes `example.com` (host → URL) from `index.html` (file → workspace).
 */
const COMMON_TLDS = new Set([
  'com', 'org', 'net', 'edu', 'gov', 'mil', 'int', 'info', 'biz', 'name',
  'io', 'dev', 'app', 'ai', 'co', 'me', 'tv', 'cc', 'gg', 'sh', 'ly',
  'xyz', 'online', 'site', 'tech', 'store', 'shop', 'blog', 'news',
  'cloud', 'page', 'space', 'website', 'wiki', 'world', 'pro',
  'us', 'uk', 'ca', 'eu', 'de', 'fr', 'jp', 'cn', 'ru', 'br', 'in',
  'au', 'mx', 'kr', 'it', 'es', 'nl', 'se', 'no', 'fi', 'dk', 'pl',
  'ch', 'at', 'be', 'ie', 'nz', 'za', 'sg', 'hk', 'tw', 'tr', 'gr',
]);

/** True when the string looks like a Windows or file:// absolute path. */
export function isAbsoluteFilePathInput(input: string): boolean {
  const trimmed = input.trim();
  return FILE_URL_RE.test(trimmed) || WINDOWS_ABS_RE.test(trimmed);
}

/** True when a Unix path is likely an absolute filesystem path (not workspace-relative). */
export function isUnixAbsoluteFilePath(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return false;
  return /\.[a-zA-Z0-9]+(?:[?#].*)?$/.test(trimmed) || trimmed.includes('/.');
}

/**
 * Convert a filesystem path to a file:// URL (renderer-safe, no node:url).
 */
export function pathToFileUrl(absPath: string): string {
  let normalized = absPath.trim().replace(/\\/g, '/');
  if (FILE_URL_RE.test(normalized)) return normalized;

  if (/^[a-zA-Z]:/.test(normalized)) {
    return `file:///${encodeURI(normalized)}`;
  }

  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`;
  }
  return `file://${encodeURI(normalized)}`;
}

export type ParsedPreviewAddress =
  | { kind: 'workspace'; path: string }
  | { kind: 'url'; url: string };

export interface ParsePreviewAddressOptions {
  /** When true, absolute filesystem paths become file:// URLs. */
  allowLocalFiles?: boolean;
}

/**
 * Detect inputs like `google.com`, `www.example.co.uk/path`, `localhost:5173`,
 * or `127.0.0.1:8080` and return a fully-qualified URL. Returns null when the
 * input doesn't look like a host (so `index.html` / `src/foo.ts` stay workspace-relative).
 */
export function tryUrlFromBareHost(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (HTTP_URL_RE.test(trimmed) || FILE_URL_RE.test(trimmed)) return null;

  // Split host[:port] from the rest. Path/query/fragment may follow either form.
  const sepMatch = trimmed.match(/[/?#]/);
  const hostAndPort = sepMatch ? trimmed.slice(0, sepMatch.index) : trimmed;
  if (!hostAndPort) return null;

  const colon = hostAndPort.indexOf(':');
  const host = colon >= 0 ? hostAndPort.slice(0, colon) : hostAndPort;
  const port = colon >= 0 ? hostAndPort.slice(colon + 1) : '';
  if (port && !/^\d+$/.test(port)) return null;
  if (!host) return null;

  const lowerHost = host.toLowerCase();
  const isLoopback = lowerHost === 'localhost' || lowerHost === '127.0.0.1' || host === '::1';
  let recognized = isLoopback || IPV4_RE.test(host);

  if (!recognized) {
    const labels = host.split('.');
    if (labels.length < 2) return null;
    if (!labels.every((label) => DOMAIN_LABEL_RE.test(label))) return null;
    const tld = labels[labels.length - 1].toLowerCase();
    if (!COMMON_TLDS.has(tld)) return null;
    recognized = true;
  }

  if (!recognized) return null;
  const protocol = isLoopback ? 'http' : 'https';
  return `${protocol}://${trimmed}`;
}

/**
 * Parse the preview address bar into a workspace path or loadable URL.
 */
export function parsePreviewAddress(
  raw: string,
  options?: ParsePreviewAddressOptions,
): ParsedPreviewAddress | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (HTTP_URL_RE.test(trimmed) || FILE_URL_RE.test(trimmed)) {
    return { kind: 'url', url: trimmed };
  }

  if (options?.allowLocalFiles) {
    if (WINDOWS_ABS_RE.test(trimmed)) {
      return { kind: 'url', url: pathToFileUrl(trimmed) };
    }
    if (isUnixAbsoluteFilePath(trimmed)) {
      return { kind: 'url', url: pathToFileUrl(trimmed) };
    }
  }

  const bareHostUrl = tryUrlFromBareHost(trimmed);
  if (bareHostUrl) {
    return { kind: 'url', url: bareHostUrl };
  }

  return { kind: 'workspace', path: trimmed.replace(/^\/+/, '') };
}

export { HTTP_URL_RE };
