import { appAlert, appConfirm, appPrompt } from '../app-dialog';
/**
 * Brain graph inspector: title, tags, summary, backlinks, body preview, actions.
 */

import { fetchBrainPage, deleteBrainPage, deleteBrainArchive } from '../../brain/client';
import type { BrainPageMeta } from '../../brain/types';
import { computeBrainBacklinks } from './tree-utils';
import { renderBrainEmptyState, renderBrainLoading } from './empty-state';
import { renderBrainMarkdown } from './wikilink-markdown';

export type InspectorNavigateFn = (relPath: string) => void;
export type InspectorEditFn = (relPath: string) => void;
export type InspectorDeletedFn = () => void | Promise<void>;

/** Parse workspace/chat ids from an archive page path. */
function parseArchiveFromPath(relPath: string): { workspaceKey: string; chatId: string } | null {
  const match = relPath.match(/^workspaces\/([^/]+)\/archive\/([^/]+)(?:\/|$)/);
  if (!match) return null;
  return { workspaceKey: match[1], chatId: match[2] };
}

/** Content mount inside #brainInspector (resize handle stays as a sibling). */
function getInspectorContent(mount: HTMLElement): HTMLElement {
  let content = mount.querySelector('.brain-inspector__content') as HTMLElement | null;
  if (!content) {
    content = document.createElement('div');
    content.className = 'brain-inspector__content';
    mount.append(content);
  }
  return content;
}

/** Mount or refresh the right-hand node inspector for a wiki page. */
export async function renderBrainInspector(
  mount: HTMLElement,
  relPath: string,
  catalogPages: BrainPageMeta[],
  navigate: InspectorNavigateFn,
  onEdit: InspectorEditFn,
  onDeleted?: InspectorDeletedFn,
): Promise<void> {
  mount.classList.add('is-open');
  mount.setAttribute('aria-hidden', 'false');
  const content = getInspectorContent(mount);
  content.replaceChildren();

  const inner = document.createElement('div');
  inner.className = 'brain-inspector__inner';
  content.append(inner);

  const loadingMount = document.createElement('div');
  inner.append(loadingMount);
  renderBrainLoading(loadingMount, 'Loading page…');

  const page = await fetchBrainPage(relPath);
  inner.replaceChildren();

  if (!page) {
    renderBrainEmptyState(inner, {
      icon: 'file',
      title: 'Page unavailable',
      message: `Could not load ${relPath}.`,
    });
    return;
  }

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'brain-inspector__close icon-btn';
  closeBtn.setAttribute('aria-label', 'Close inspector');
  closeBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  closeBtn.addEventListener('click', () => closeBrainInspector(mount));
  inner.append(closeBtn);

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
    const chips = document.createElement('div');
    chips.className = 'brain-inspector__tag-chips brain-chip-row';
    for (const tag of page.meta.tags) {
      const chip = document.createElement('span');
      chip.className = 'brain-chip';
      chip.textContent = tag;
      chips.append(chip);
    }
    head.append(chips);
  }

  if (page.meta.summary?.trim()) {
    const summary = document.createElement('p');
    summary.className = 'brain-inspector__summary';
    summary.textContent = page.meta.summary;
    head.append(summary);
  }

  inner.append(head);

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
  inner.append(backSection);

  const bodyWrap = document.createElement('div');
  bodyWrap.className = 'brain-inspector__body';
  renderBrainMarkdown(bodyWrap, page.body, navigate);
  inner.append(bodyWrap);

  const actions = document.createElement('div');
  actions.className = 'brain-inspector__actions';
  const editBtn = document.createElement('button');
  editBtn.type = 'button';
  editBtn.className = 'brain-action-btn is-primary';
  editBtn.textContent = 'Edit page';
  editBtn.addEventListener('click', () => onEdit(page.path));
  actions.append(editBtn);

  const deleteBtn = document.createElement('button');
  deleteBtn.type = 'button';
  deleteBtn.className = 'brain-action-btn brain-action-btn--danger';
  deleteBtn.textContent = 'Delete page';
  deleteBtn.addEventListener('click', () => {
    void (async () => {
      const ok = await appConfirm(
        `Delete wiki page "${page.meta.title}"?\n\nPath: ${page.path}\n\nThis cannot be undone.`,
      );
      if (!ok) return;
      const result = await deleteBrainPage(page.path);
      if (!result.ok) {
        await appAlert(result.error ?? 'Delete failed.');
        return;
      }
      closeBrainInspector(mount);
      await onDeleted?.();
    })();
  });
  actions.append(deleteBtn);

  const archiveInfo = parseArchiveFromPath(page.path);
  if (archiveInfo) {
    const archiveBtn = document.createElement('button');
    archiveBtn.type = 'button';
    archiveBtn.className = 'brain-action-btn brain-action-btn--danger';
    archiveBtn.textContent = 'Delete entire chat archive';
    archiveBtn.addEventListener('click', () => {
      void (async () => {
        const ok = await appConfirm(
          `Delete the entire chat archive for "${archiveInfo.chatId}"?\n\nAll pages under this chat folder will be removed.`,
        );
        if (!ok) return;
        const result = await deleteBrainArchive(
          archiveInfo.chatId,
          archiveInfo.workspaceKey,
        );
        if (!result.ok) {
          await appAlert(result.error ?? 'Archive delete failed.');
          return;
        }
        closeBrainInspector(mount);
        await onDeleted?.();
      })();
    });
    actions.append(archiveBtn);
  }

  inner.append(actions);
}

/** Collapse the inspector panel. */
export function closeBrainInspector(mount: HTMLElement): void {
  mount.classList.remove('is-open');
  mount.setAttribute('aria-hidden', 'true');
  mount.querySelector('.brain-inspector__content')?.replaceChildren();
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
  const content = getInspectorContent(mount);
  content.replaceChildren();

  const inner = document.createElement('div');
  inner.className = 'brain-inspector__inner';
  content.append(inner);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'brain-inspector__close icon-btn';
  closeBtn.setAttribute('aria-label', 'Close inspector');
  closeBtn.innerHTML =
    '<svg class="icon-svg" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>';
  closeBtn.addEventListener('click', () => closeBrainInspector(mount));
  inner.append(closeBtn);

  const head = document.createElement('header');
  head.className = 'brain-inspector__head';
  const title = document.createElement('h2');
  title.className = 'brain-inspector__title';
  title.textContent = label;
  const pathLine = document.createElement('p');
  pathLine.className = 'brain-inspector__path';
  pathLine.textContent = meta;
  head.append(title, pathLine);
  inner.append(head);

  if (source?.trim()) {
    const pre = document.createElement('pre');
    pre.className = 'brain-code-def';
    pre.textContent = source;
    inner.append(pre);
  }
}
