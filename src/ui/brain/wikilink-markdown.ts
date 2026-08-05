/**
 * Render wiki markdown with path-based wikilink navigation for the Brain viewer.
 */

import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { highlightCodeElement } from '../../markdown/highlighter';

let markedConfigured = false;

function ensureMarked(): void {
  if (markedConfigured) return;
  markedConfigured = true;
  try {
    if (typeof marked.use === 'function') {
      marked.use({ gfm: true, breaks: false });
    }
  } catch {
    /* defaults are acceptable */
  }
}

/** Rewrite [[path/to/page]] wikilinks into in-app hash anchors before markdown parse. */
export function rewriteBrainWikilinks(markdown: string): string {
  return markdown.replace(/\[\[([^\]]+)\]\]/g, (_match, raw: string) => {
    const path = raw.trim().replace(/\\/g, '/').replace(/\.md$/i, '');
    const label = path.split('/').pop() ?? path;
    return `[${label}](#brain-wiki/${encodeURIComponent(path)})`;
  });
}

/**
 * Render markdown into a container and wire wikilink clicks.
 * @param onNavigate Called with a relative page path (with or without .md).
 */
export function renderBrainMarkdown(
  container: HTMLElement,
  markdown: string,
  onNavigate: (relPath: string) => void,
): void {
  ensureMarked();
  container.replaceChildren();
  container.classList.add('brain-markdown');

  const raw = markdown.trim();
  if (!raw) {
    const empty = document.createElement('p');
    empty.className = 'brain-muted';
    empty.textContent = 'This page has no body yet.';
    container.append(empty);
    return;
  }

  const prepared = rewriteBrainWikilinks(raw);
  let html: string;
  try {
    html = marked.parse(prepared) as string;
  } catch {
    container.textContent = raw;
    return;
  }

  container.innerHTML = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });

  container.querySelectorAll('pre code').forEach((block) => {
    if (!block.classList.contains('hljs')) {
      void highlightCodeElement(block as HTMLElement);
    }
  });

  container.onclick = (event) => {
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest('a[href^="#brain-wiki/"]') as HTMLAnchorElement | null;
    if (!anchor) return;
    event.preventDefault();
    const encoded = anchor.getAttribute('href')?.replace(/^#brain-wiki\//, '') ?? '';
    const path = decodeURIComponent(encoded).replace(/\\/g, '/');
    const relPath = path.endsWith('.md') ? path : `${path}.md`;
    onNavigate(relPath);
  };
}
