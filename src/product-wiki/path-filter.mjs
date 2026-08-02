import path from 'node:path';

const EXCLUDED_SEGMENTS = new Set(['archive', 'extracts', 'images', 'memory', 'plans', 'schemas', 'specs', 'templates']);
const EXCLUDED_FILES = new Set(['MEMORY.md']);

/** Root-level Markdown files published to GitHub Wiki (not in the in-app manual catalog). */
const GITHUB_WIKI_ROOT_FILES = new Set(['README.md', 'ROADMAP.md', 'context.md']);

/** Top-level documentation folders published to GitHub Wiki (plus root allowlist files). */
const GITHUB_WIKI_DIRECTORY_PREFIXES = [
  'manual/',
  'contributor/',
  'guides/',
  'maintainer/',
  'design-system/',
  'plugins/',
  'agent-packs/',
];

/** Root Markdown files included in the in-app manual catalog (not under manual/). */
const IN_APP_ROOT_FILES = new Set(['ROADMAP.md', 'THIRD_PARTY_NOTICES.md']);

/** Return whether relative path segments are safe and not in excluded working folders. */
function isAllowedDocumentationPath(relativePath) {
  const normalized = String(relativePath ?? '').replaceAll('\\', '/');
  if (!normalized.endsWith('.md') || path.posix.isAbsolute(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '..')) return false;
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  return !EXCLUDED_FILES.has(segments.at(-1));
}

/** Return whether a documentation-relative Markdown path belongs in the in-app product wiki. */
export function isProductWikiPath(relativePath) {
  if (!isAllowedDocumentationPath(relativePath)) return false;
  const normalized = String(relativePath).replaceAll('\\', '/');
  if (IN_APP_ROOT_FILES.has(normalized)) return true;
  return normalized.startsWith('manual/');
}

/** Return whether a documentation-relative Markdown path is published to GitHub Wiki. */
export function isGitHubWikiPublishPath(relativePath) {
  if (!isAllowedDocumentationPath(relativePath)) return false;
  const normalized = String(relativePath).replaceAll('\\', '/');
  if (GITHUB_WIKI_ROOT_FILES.has(normalized)) return true;
  return GITHUB_WIKI_DIRECTORY_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Directory segments excluded from wiki catalogs (for maintainer docs). */
export const PRODUCT_WIKI_EXCLUDED_SEGMENTS = EXCLUDED_SEGMENTS;
