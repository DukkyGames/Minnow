import DOMPurify from 'dompurify';
import hljs from 'highlight.js';
import { marked } from 'marked';

const REPOSITORY_BASE = 'https://github.com/DukkyGames/Minnow/blob/main/';
let markedConfigured = false;

/** Configure the shared Markdown parser once. */
function ensureMarked(): void {
  if (markedConfigured) return;
  markedConfigured = true;
  marked.use({ gfm: true, breaks: false });
}

/** Resolve a relative documentation link against the page being read. */
function resolveRepositoryPath(currentPath: string, href: string): string {
  const base = new URL(currentPath, 'https://minnow.local/');
  return new URL(href, base).pathname.replace(/^\/+/u, '');
}

/** Render sanitized official docs and keep documentation links inside the wiki. */
export function renderProductWikiMarkdown(
  container: HTMLElement,
  markdown: string,
  currentPath: string,
  onNavigate: (path: string) => void,
): void {
  ensureMarked();
  const rendered = marked.parse(markdown) as string;
  container.className = 'product-wiki-markdown';
  container.innerHTML = DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } });

  const usedHeadingIds = new Set<string>();
  container.querySelectorAll('h2, h3, h4').forEach((heading) => {
    const text = heading.textContent?.trim() ?? '';
    if (!text) return;
    const base = text
      .toLowerCase()
      .replace(/[^\w\s-]/gu, '')
      .replace(/\s+/gu, '-')
      .replace(/-+/gu, '-')
      .replace(/^-|-$/gu, '');
    let id = base || 'section';
    let suffix = 2;
    while (usedHeadingIds.has(id)) {
      id = `${base}-${suffix}`;
      suffix += 1;
    }
    usedHeadingIds.add(id);
    heading.id = id;
  });

  container.querySelectorAll('pre code').forEach((block) => {
    try {
      hljs.highlightElement(block as HTMLElement);
    } catch {
      // Unknown languages remain readable as plain code.
    }
  });

  container.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
    const href = anchor.getAttribute('href') ?? '';
    if (!href || href.startsWith('#')) return;
    if (/^(https?:|mailto:)/iu.test(href)) {
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      return;
    }
    const repositoryPath = resolveRepositoryPath(currentPath, href);
    if (repositoryPath.startsWith('documentation/') && repositoryPath.endsWith('.md')) {
      anchor.href = `#/wiki/${encodeURIComponent(repositoryPath)}`;
      anchor.addEventListener('click', (event) => {
        event.preventDefault();
        onNavigate(repositoryPath);
      });
      return;
    }
    anchor.href = `${REPOSITORY_BASE}${repositoryPath}`;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
  });
}
