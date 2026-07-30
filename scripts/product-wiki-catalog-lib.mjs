import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const EXCLUDED_SEGMENTS = new Set(['archive', 'extracts', 'images', 'memory', 'plans', 'schemas', 'specs', 'templates']);
const EXCLUDED_FILES = new Set(['MEMORY.md']);

/** Return whether a documentation-relative Markdown path belongs in the product wiki. */
export function isProductWikiPath(relativePath) {
  const normalized = String(relativePath ?? '').replaceAll('\\', '/');
  if (!normalized.endsWith('.md') || path.posix.isAbsolute(normalized)) return false;
  const segments = normalized.split('/');
  if (segments.some((segment) => !segment || segment === '..')) return false;
  if (segments.some((segment) => EXCLUDED_SEGMENTS.has(segment))) return false;
  return !EXCLUDED_FILES.has(segments.at(-1));
}

/** Recursively collect allowlisted Markdown paths in stable lexical order. */
async function collectMarkdownPaths(root, relativeDirectory = '') {
  const directory = path.join(root, relativeDirectory);
  const rows = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const row of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    const relativePath = path.posix.join(relativeDirectory.replaceAll('\\', '/'), row.name);
    if (row.isDirectory()) {
      if (EXCLUDED_SEGMENTS.has(row.name)) continue;
      paths.push(...(await collectMarkdownPaths(root, relativePath)));
      continue;
    }
    if (row.isFile() && isProductWikiPath(relativePath)) paths.push(relativePath);
  }
  return paths;
}

/** Remove lightweight Markdown syntax for compact catalog summaries. */
function plainText(markdown) {
  return markdown
    .replace(/^---[\s\S]*?---\s*/u, '')
    .replace(/```[\s\S]*?```/gu, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/[`*_>#|~-]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

/** Derive the reader section from the canonical documentation path. */
function sectionForPath(relativePath) {
  if (relativePath === 'ROADMAP.md') return 'Roadmap';
  if (relativePath === 'context.md') return 'Developer reference';
  if (relativePath.startsWith('guides/')) return 'Guides';
  if (relativePath.startsWith('design-system/')) return 'Design system';
  if (relativePath.startsWith('plugins/')) return 'Extensions';
  if (relativePath.startsWith('agent-packs/')) return 'Extensions';
  if (relativePath.startsWith('maintainer/')) return 'Maintainers';
  return 'Overview';
}

/** Extract stable searchable metadata from one Markdown document. */
export function createProductWikiEntry(relativePath, markdown) {
  const normalizedMarkdown = markdown.replace(/^\uFEFF/u, '').replace(/\r\n/g, '\n');
  const headingRows = [...normalizedMarkdown.matchAll(/^(#{1,3})[^\S\r\n]+(.+?)[^\S\r\n]*$/gmu)];
  const title = headingRows.find((row) => row[1].length === 1)?.[2]?.trim()
    ?? path.posix.basename(relativePath, '.md').replaceAll('-', ' ');
  const headings = headingRows
    .filter((row) => row[1].length > 1)
    .map((row) => row[2].replace(/\s+#+$/u, '').trim())
    .filter(Boolean);
  const bodyWithoutTitle = normalizedMarkdown.replace(/^#[^\S\r\n]+.+$/mu, '');
  const summary = plainText(bodyWithoutTitle).slice(0, 280);
  const hash = createHash('sha256').update(normalizedMarkdown).digest('hex');
  return {
    path: `documentation/${relativePath}`,
    title,
    summary,
    headings,
    section: sectionForPath(relativePath),
    hash,
  };
}

/** Build the deterministic product-wiki catalog from documentation/. */
export async function buildProductWikiCatalog(documentationRoot) {
  const relativePaths = await collectMarkdownPaths(documentationRoot);
  const entries = [];
  for (const relativePath of relativePaths) {
    const markdown = await readFile(path.join(documentationRoot, relativePath), 'utf8');
    entries.push(createProductWikiEntry(relativePath, markdown));
  }
  return { version: 1, entries };
}
