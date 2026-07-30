import '../styles/product-wiki.css';

import {
  fetchProductWikiCatalog,
  fetchProductWikiPage,
  searchProductWiki,
  type ProductWikiEntry,
  type ProductWikiSearchHit,
} from '../product-wiki/client';
import { iconHtml } from './icon';
import { renderProductWikiMarkdown } from './product-wiki-markdown';

const DEFAULT_PAGE_PATH = 'documentation/README.md';
let initialized = false;
let returnHash = '#/desktop';
let catalog: ProductWikiEntry[] = [];
let activePath = DEFAULT_PAGE_PATH;
let searchTimer: number | undefined;

/** Decode a stable page path from the product-wiki hash route. */
export function productWikiPathFromHash(hash: string): string | null {
  const match = hash.match(/^#\/wiki(?:\/(.+))?$/u);
  if (!match) return null;
  if (!match[1]) return DEFAULT_PAGE_PATH;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return DEFAULT_PAGE_PATH;
  }
}

/** Build the overlay once and return its root. */
function ensureProductWikiRoot(): HTMLElement {
  const existing = document.getElementById('productWikiOverlay');
  if (existing) return existing;

  const root = document.createElement('section');
  root.id = 'productWikiOverlay';
  root.className = 'product-wiki hidden';
  root.setAttribute('aria-label', 'Minnow wiki');
  root.innerHTML = `
    <header class="product-wiki__header">
      <div class="product-wiki__identity">
        <button id="productWikiNavToggle" class="product-wiki__icon-button product-wiki__nav-toggle" type="button" aria-label="Toggle wiki navigation" aria-expanded="false">${iconHtml('menu', { size: 17 })}</button>
        <div>
          <strong>Minnow wiki</strong>
          <span>Official product help</span>
        </div>
      </div>
      <label class="product-wiki__search">
        ${iconHtml('search', { size: 16 })}
        <span class="sr-only">Search the Minnow wiki</span>
        <input id="productWikiSearch" type="search" autocomplete="off" placeholder="Search setup, apps, tools, architecture…" />
        <kbd>Ctrl K</kbd>
      </label>
      <button id="productWikiClose" class="product-wiki__icon-button" type="button" aria-label="Close Minnow wiki">${iconHtml('close', { size: 17 })}</button>
    </header>
    <div class="product-wiki__body">
      <nav id="productWikiNav" class="product-wiki__nav" aria-label="Wiki pages">
        <div id="productWikiNavContent" class="product-wiki__nav-content" aria-live="polite"></div>
      </nav>
      <button id="productWikiNavScrim" class="product-wiki__scrim" type="button" aria-label="Close wiki navigation"></button>
      <main id="productWikiArticle" class="product-wiki__article" tabindex="-1">
        <div class="product-wiki__article-inner">
          <div id="productWikiArticleMeta" class="product-wiki__article-meta"></div>
          <article id="productWikiArticleBody" aria-live="polite"></article>
        </div>
      </main>
    </div>
  `;
  (document.getElementById('osStage') ?? document.body).appendChild(root);
  bindProductWiki(root);
  return root;
}

/** Navigate to a page while preserving a reloadable deep link. */
function navigateToProductWikiPage(path: string): void {
  const next = `#/wiki/${encodeURIComponent(path)}`;
  if (window.location.hash !== next) window.location.hash = next;
  else void renderProductWikiPage(path);
}

/** Render the grouped catalog navigation. */
function renderCatalogNavigation(entries: ProductWikiEntry[]): void {
  const host = document.getElementById('productWikiNavContent');
  if (!host) return;
  host.replaceChildren();
  const sections = new Map<string, ProductWikiEntry[]>();
  for (const entry of entries) {
    const rows = sections.get(entry.section) ?? [];
    rows.push(entry);
    sections.set(entry.section, rows);
  }
  for (const [section, rows] of sections) {
    const group = document.createElement('section');
    group.className = 'product-wiki__nav-group';
    const heading = document.createElement('h2');
    heading.textContent = section;
    group.appendChild(heading);
    for (const entry of rows) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'product-wiki__nav-page';
      button.dataset.path = entry.path;
      button.setAttribute('aria-current', entry.path === activePath ? 'page' : 'false');
      const title = document.createElement('strong');
      title.textContent = entry.title;
      const summary = document.createElement('span');
      summary.textContent = entry.summary;
      button.append(title, summary);
      button.addEventListener('click', () => navigateToProductWikiPage(entry.path));
      group.appendChild(button);
    }
    host.appendChild(group);
  }
}

/** Render ranked full-text search hits in the navigation rail. */
function renderSearchResults(query: string, hits: ProductWikiSearchHit[]): void {
  const host = document.getElementById('productWikiNavContent');
  if (!host) return;
  host.replaceChildren();
  const heading = document.createElement('div');
  heading.className = 'product-wiki__results-heading';
  heading.textContent = `${hits.length} result${hits.length === 1 ? '' : 's'} for “${query}”`;
  host.appendChild(heading);
  if (!hits.length) {
    const empty = document.createElement('p');
    empty.className = 'product-wiki__empty';
    empty.textContent = 'Try a feature name, setting, command, or error message.';
    host.appendChild(empty);
    return;
  }
  for (const hit of hits) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'product-wiki__result';
    const section = document.createElement('span');
    section.className = 'product-wiki__result-section';
    section.textContent = hit.section;
    const title = document.createElement('strong');
    title.textContent = hit.title;
    const excerpt = document.createElement('span');
    excerpt.textContent = hit.excerpt;
    button.append(section, title, excerpt);
    button.addEventListener('click', () => navigateToProductWikiPage(hit.path));
    host.appendChild(button);
  }
}

/** Show a compact loading or failure state in the article pane. */
function renderArticleState(message: string, error = false): void {
  const meta = document.getElementById('productWikiArticleMeta');
  const body = document.getElementById('productWikiArticleBody');
  if (meta) meta.replaceChildren();
  if (!body) return;
  body.className = error ? 'product-wiki__state is-error' : 'product-wiki__state';
  body.textContent = message;
}

/** Load and render one documentation page. */
async function renderProductWikiPage(path: string): Promise<void> {
  activePath = path;
  renderArticleState('Loading page…');
  renderCatalogNavigation(catalog);
  try {
    const page = await fetchProductWikiPage(path);
    const meta = document.getElementById('productWikiArticleMeta');
    const body = document.getElementById('productWikiArticleBody');
    if (!meta || !body || activePath !== path) return;
    meta.innerHTML = `<span>${page.section}</span><code></code>`;
    const code = meta.querySelector('code');
    if (code) code.textContent = page.path;
    renderProductWikiMarkdown(body, page.content, page.path, navigateToProductWikiPage);
    document.getElementById('productWikiArticle')?.scrollTo({ top: 0 });
    closeMobileNavigation();
  } catch (error) {
    renderArticleState(
      error instanceof Error ? error.message : 'The wiki page could not be loaded.',
      true,
    );
  }
}

/** Run full-text search after a short input debounce. */
async function updateProductWikiSearch(query: string): Promise<void> {
  const normalized = query.trim();
  if (!normalized) {
    renderCatalogNavigation(catalog);
    return;
  }
  const host = document.getElementById('productWikiNavContent');
  if (host) host.textContent = 'Searching…';
  try {
    const hits = await searchProductWiki(normalized);
    const current = (document.getElementById('productWikiSearch') as HTMLInputElement | null)?.value.trim();
    if (current === normalized) renderSearchResults(normalized, hits);
  } catch (error) {
    if (host) host.textContent = error instanceof Error ? error.message : 'Search failed.';
  }
}

/** Close the navigation drawer on compact layouts. */
function closeMobileNavigation(): void {
  const root = document.getElementById('productWikiOverlay');
  root?.classList.remove('is-nav-open');
  document.getElementById('productWikiNavToggle')?.setAttribute('aria-expanded', 'false');
}

/** Bind overlay controls once. */
function bindProductWiki(root: HTMLElement): void {
  root.querySelector('#productWikiClose')?.addEventListener('click', closeProductWiki);
  root.querySelector('#productWikiNavScrim')?.addEventListener('click', closeMobileNavigation);
  root.querySelector('#productWikiNavToggle')?.addEventListener('click', () => {
    const open = root.classList.toggle('is-nav-open');
    document.getElementById('productWikiNavToggle')?.setAttribute('aria-expanded', String(open));
  });
  const search = root.querySelector<HTMLInputElement>('#productWikiSearch');
  search?.addEventListener('input', () => {
    if (searchTimer !== undefined) window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => void updateProductWikiSearch(search.value), 180);
  });
}

/** Synchronize overlay visibility and article state from the hash route. */
async function syncProductWikiFromHash(): Promise<void> {
  const path = productWikiPathFromHash(window.location.hash);
  const root = ensureProductWikiRoot();
  if (!path) {
    root.classList.add('hidden');
    return;
  }
  root.classList.remove('hidden');
  if (!catalog.length) {
    try {
      catalog = await fetchProductWikiCatalog();
    } catch (error) {
      renderArticleState(error instanceof Error ? error.message : 'The wiki is unavailable.', true);
      return;
    }
  }
  renderCatalogNavigation(catalog);
  await renderProductWikiPage(path);
}

/** Initialize the in-app product wiki overlay and keyboard search shortcut. */
export function initProductWiki(): void {
  if (initialized) return;
  initialized = true;
  ensureProductWikiRoot();
  window.addEventListener('hashchange', () => void syncProductWikiFromHash());
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.key.toLocaleLowerCase() !== 'k') return;
    if (productWikiPathFromHash(window.location.hash) === null) return;
    event.preventDefault();
    document.getElementById('productWikiSearch')?.focus();
  });
  void syncProductWikiFromHash();
}

/** Open the official product wiki from any Minnow surface. */
export function openProductWiki(path = DEFAULT_PAGE_PATH): void {
  if (productWikiPathFromHash(window.location.hash) === null) {
    returnHash = window.location.hash || '#/desktop';
  }
  navigateToProductWikiPage(path);
}

/** Close the overlay and restore the surface that opened it. */
export function closeProductWiki(): void {
  closeMobileNavigation();
  window.location.hash = returnHash;
}
