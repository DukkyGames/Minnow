/**
 * Brain graph inspector: title, tags, summary, backlinks, body preview, actions.
 */

import { fetchBrainPage } from '../../brain/client';
import type { BrainPageMeta } from '../../brain/types';
import { computeBrainBacklinks } from './tree-utils';
import { renderBrainMarkdown } from './wikilink-markdown';

export type InspectorNavigateFn = (relPath: string) => void;
export type InspectorEditFn = (relPath: string) => void;

/** Mount or refresh the right-hand node inspector for a wiki page. */
export async function renderBrainInspector(
  mount: HTMLElement,
  relPath: string,
  catalogPages: BrainPageMeta[],
  navigate: InspectorNavigateFn,
  onEdit: InspectorEditFn,
): Promise<void> {
  mount.classList.add('is-open');
  mount.setAttribute('aria-hidden', 'false');
  mount.replaceChildren();

  const loading = document.createElement('p');
  loading.className = 'brain-inspector__loading';
  loading.textContent = 'Loading page…';
  mount.append(loading);

  const page = await fetchBrainPage(relPath);
  mount.replaceChildren();

  if (!page) {
    const err = document.createElement('p');
    err.className = 'brain-error';
    err.textContent = `Could not load ${relPath}.`;
    mount.append(err);
    return;
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'brain-inspector__close icon-btn';
  closeBtn.setAttribute('aria-label', 'Close inspector');
  closeBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  closeBtn.addEventListener('click', () => closeBrainInspector(mount));
  mount.append(closeBtn);

  const head = document.createElement('header');
  head.className = 'brain-inspector__head';
  const title = document.createElement('h2');
  title.className = 'brain-inspector__title';
  title.textContent = page.meta.title;
  const pathLine = document.createElement('p');
  pathLine.className = 'brain-inspector__path';
  pathLine.textContent = page.path;
  head.append(title, pathLine);

  if (page.meta.tags?.length) {
    const tags = document.createElement('p');
    tags.className = 'brain-inspector__tags';
    tags.textContent = page.meta.tags.join(' · ');
    head.append(tags);
  }

  if (page.meta.summary?.trim()) {
    const summary = document.createElement('p');
    summary.className = 'brain-inspector__summary';
    summary.textContent = page.meta.summary;
    head.append(summary);
  }

  mount.append(head);

  const backlinks = computeBrainBacklinks(catalogPages, page.path);
  const backSection = document.createElement('section');
  backSection.className = 'brain-inspector__backlinks';
  const backTitle = document.createElement('h3');
  backTitle.className = 'brain-section-subtitle';
  backTitle.textContent = 'Backlinks';
  backSection.append(backTitle);

  if (!backlinks.length) {
    const none = document.createElement('p');
    none.className = 'brain-muted';
    none.textContent = 'No pages link here yet.';
    backSection.append(none);
  } else {
    const list = document.createElement('ul');
    list.className = 'brain-inspector__backlink-list';
    for (const from of backlinks) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'brain-inline-link';
      btn.textContent = from;
      btn.addEventListener('click', () => navigate(from));
      li.append(btn);
      list.append(li);
    }
    backSection.append(list);
  }
  mount.append(backSection);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'brain-inspector__body';
  renderBrainMarkdown(bodyWrap, page.body, navigate);
  mount.append(bodyWrap);

  const actions = document.createElement('div');
  actions.className = 'brain-inspector__actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'brain-action-btn is-primary';
  editBtn.textContent = 'Edit page';
  editBtn.addEventListener('click', () => onEdit(page.path));
  actions.append(editBtn);
  mount.append(actions);
}

/** Collapse the inspector panel. */
export function closeBrainInspector(mount: HTMLElement): void {
  mount.classList.remove('is-open');
  mount.setAttribute('aria-hidden', 'true');
  mount.replaceChildren();
}

/** Show symbol details in the inspector (code call graph). */
export function renderSymbolInspector(
  mount: HTMLElement,
  label: string,
  meta: string,
  source?: string,
): void {
  mount.classList.add('is-open');
  mount.setAttribute('aria-hidden', 'false');
  mount.replaceChildren();

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'brain-inspector__close icon-btn';
  closeBtn.setAttribute('aria-label', 'Close inspector');
  closeBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  closeBtn.addEventListener('click', () => closeBrainInspector(mount));
  mount.append(closeBtn);

  const head = document.createElement('header');
  head.className = 'brain-inspector__head';
  const title = document.createElement('h2');
  title.className = 'brain-inspector__title';
  title.textContent = label;
  const pathLine = document.createElement('p');
  pathLine.className = 'brain-inspector__path';
  pathLine.textContent = meta;
  head.append(title, pathLine);
  mount.append(head);

  if (source?.trim()) {
    const pre = document.createElement('pre');
    pre.className = 'brain-code-def';
    pre.textContent = source;
    mount.append(pre);
  }
}
