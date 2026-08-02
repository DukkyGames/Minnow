import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isProductWikiPath } from '../../src/product-wiki/path-filter.mjs';
import { getAppRoot } from '../workspace/root.js';

const CATALOG_PATH = fileURLToPath(new URL('./catalog.json', import.meta.url));
const MAX_PAGE_CHARS = 120_000;
const contentCache = new Map();
let catalogPromise;

/** Keep only user-manual pages even if catalog.json was generated with an older allowlist. */
function filterInAppCatalogEntries(entries) {
  return entries.filter((entry) => {
    const relative = String(entry?.path ?? '').replace(/^documentation\//u, '');
    return isProductWikiPath(relative);
  });
}

/** Load and validate the generated product-wiki catalog once per process. */
export async function loadProductWikiCatalog() {
  catalogPromise ??= fs.readFile(CATALOG_PATH, 'utf8').then((text) => {
    const parsed = JSON.parse(text);
    if (parsed?.version !== 1 || !Array.isArray(parsed.entries)) {
      throw new Error('Product wiki catalog has an unsupported format.');
    }
    return { ...parsed, entries: filterInAppCatalogEntries(parsed.entries) };
  });
  return catalogPromise;
}

/** Locate packaged extraResources or the development documentation directory. */
async function resolveDocumentationRoot() {
  const appRoot = getAppRoot();
  const resourcesDocumentation =
    typeof process.resourcesPath === 'string' && process.resourcesPath
      ? path.join(process.resourcesPath, 'documentation')
      : null;
  const candidates = [
    resourcesDocumentation,
    path.join(appRoot, 'documentation'),
    path.join(path.dirname(appRoot), 'documentation'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
    } catch {
      // Continue to the packaged extraResources candidate.
    }
  }
  throw new Error('Minnow documentation is not installed.');
}

/** Resolve only paths present in the generated allowlist and reject symlink escapes. */
export async function resolveProductWikiPagePath(requestedPath) {
  const normalized = String(requestedPath ?? '').trim().replaceAll('\\', '/');
  if (!normalized || path.posix.isAbsolute(normalized) || normalized.includes('\0')) {
    throw new Error('A documentation path is required.');
  }
  const catalog = await loadProductWikiCatalog();
  const entry = catalog.entries.find((candidate) => candidate.path === normalized);
  if (!entry) throw new Error(`Documentation page not found: ${normalized}`);

  const root = await resolveDocumentationRoot();
  const relativePath = normalized.replace(/^documentation\//u, '');
  const absolutePath = path.resolve(root, relativePath);
  const [realRoot, realPath] = await Promise.all([fs.realpath(root), fs.realpath(absolutePath)]);
  const boundary = path.relative(realRoot, realPath);
  if (boundary.startsWith('..') || path.isAbsolute(boundary)) {
    throw new Error('Documentation path escapes the installed wiki.');
  }
  return { absolutePath: realPath, entry };
}

/** Read one official page with an explicit output cap. */
export async function readProductWikiPage(requestedPath) {
  const { absolutePath, entry } = await resolveProductWikiPagePath(requestedPath);
  const cached = contentCache.get(entry.hash);
  if (cached) return { ...entry, content: cached };
  const content = await fs.readFile(absolutePath, 'utf8');
  const capped = content.length > MAX_PAGE_CHARS
    ? `${content.slice(0, MAX_PAGE_CHARS)}\n\n[Page truncated by Minnow]`
    : content;
  contentCache.set(entry.hash, capped);
  return { ...entry, content: capped };
}

/** Normalize prose into searchable lowercase terms. */
function queryTerms(query) {
  return [...new Set(String(query ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) ?? [])];
}

/** Select a compact body excerpt around the first matching query term. */
function createExcerpt(content, terms) {
  const compact = content
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/\s+/gu, ' ')
    .trim();
  const lower = compact.toLocaleLowerCase();
  const index = terms.reduce((best, term) => {
    const found = lower.indexOf(term);
    if (found < 0) return best;
    return best < 0 ? found : Math.min(best, found);
  }, -1);
  const start = Math.max(0, index < 0 ? 0 : index - 120);
  const excerpt = compact.slice(start, start + 480).trim();
  return `${start > 0 ? '…' : ''}${excerpt}${start + 480 < compact.length ? '…' : ''}`;
}

/** Rank official docs by title, headings, path, summary, and body matches. */
export async function searchProductWiki(query, options = {}) {
  const terms = queryTerms(query);
  if (!terms.length) throw new Error('Search query must include at least one word.');
  const limit = Math.min(20, Math.max(1, Number(options.limit) || 8));
  const catalog = await loadProductWikiCatalog();
  const candidates = options.section
    ? catalog.entries.filter((entry) => entry.section === options.section)
    : catalog.entries;
  const ranked = [];
  for (const entry of candidates) {
    const page = await readProductWikiPage(entry.path);
    const fields = {
      title: page.title.toLocaleLowerCase(),
      headings: page.headings.join(' ').toLocaleLowerCase(),
      path: page.path.toLocaleLowerCase(),
      summary: page.summary.toLocaleLowerCase(),
      body: page.content.toLocaleLowerCase(),
    };
    let score = 0;
    for (const term of terms) {
      if (fields.title.includes(term)) score += 16;
      if (fields.headings.includes(term)) score += 9;
      if (fields.path.includes(term)) score += 6;
      if (fields.summary.includes(term)) score += 4;
      if (fields.body.includes(term)) score += 1;
    }
    if (!score) continue;
    ranked.push({
      path: page.path,
      title: page.title,
      summary: page.summary,
      section: page.section,
      headings: page.headings.filter((heading) =>
        terms.some((term) => heading.toLocaleLowerCase().includes(term))
      ).slice(0, 4),
      excerpt: createExcerpt(page.content, terms),
      score,
    });
  }
  return ranked
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit);
}

/** Reset module caches for deterministic tests. */
export function resetProductWikiCatalogForTests() {
  catalogPromise = undefined;
  contentCache.clear();
}
