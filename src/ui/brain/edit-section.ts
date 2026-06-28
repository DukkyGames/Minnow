/**
 * Brain app — Edit section: frontmatter fields + body editor, save via PUT /page.
 */

import { fetchBrainPage, saveBrainPage, deleteBrainPage } from '../../brain/client';
import { setBrainHeaderActions } from '../brain-page';
import { getGraphSelectedPath, setGraphSelectedPath } from './graph-section';
import { renderBrainMarkdown } from './wikilink-markdown';
import { openBrain } from '../brain-page';

let bindingsDone = false;
let previewBound = false;
let editPageLoaded = false;

function setEditStatus(kind: 'ok' | 'err' | 'spin', message: string): void {
  const el = document.getElementById('brainEditStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
}

/** Refresh the live markdown preview pane from the body textarea. */
function refreshEditPreview(): void {
  const bodyEl = document.getElementById('brainEditBody') as HTMLTextAreaElement | null;
  const previewEl = document.getElementById('brainEditPreview');
  if (!bodyEl || !previewEl) return;

  const body = bodyEl.value;
  if (!body.trim()) {
    previewEl.replaceChildren();
    previewEl.classList.add('brain-muted');
    previewEl.textContent = 'Start typing in the body to see a live preview.';
    return;
  }

  previewEl.classList.remove('brain-muted');
  renderBrainMarkdown(previewEl, body, (path) => {
    void import('../brain-page').then((m) => m.openBrainEditForPath(path));
  });
}

function mountEditHeaderActions(): void {
  const wrap = document.createElement('div');
  wrap.className = 'brain-header-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'brain-action-btn is-primary';
  saveBtn.textContent = 'Save';
  saveBtn.addEventListener('click', () => {
    void saveEditForm();
  });
  wrap.append(saveBtn);

  if (editPageLoaded) {
    const deleteBtn = document.createElement('button');
    deleteBtn.type = 'button';
    deleteBtn.className = 'brain-action-btn brain-action-btn--danger';
    deleteBtn.textContent = 'Delete';
    deleteBtn.addEventListener('click', () => {
      void deleteLoadedPage();
    });
    wrap.append(deleteBtn);
  }

  setBrainHeaderActions(wrap);
}

async function deleteLoadedPage(): Promise<void> {
  const pathEl = document.getElementById('brainEditPath') as HTMLInputElement | null;
  const titleEl = document.getElementById('brainEditTitle') as HTMLInputElement | null;
  if (!pathEl) return;
  const relPath = pathEl.value.trim().replace(/\\/g, '/');
  if (!relPath || !editPageLoaded) return;
  const title = titleEl?.value.trim() || relPath;
  const ok = window.confirm(`Delete wiki page "${title}"?\n\nPath: ${relPath}`);
  if (!ok) return;

  setEditStatus('spin', 'Deleting…');
  const result = await deleteBrainPage(relPath);
  if (!result.ok) {
    setEditStatus('err', result.error ?? 'Delete failed.');
    return;
  }

  editPageLoaded = false;
  pathEl.value = '';
  const titleInput = document.getElementById('brainEditTitle') as HTMLInputElement | null;
  const tagsEl = document.getElementById('brainEditTags') as HTMLInputElement | null;
  const bodyEl = document.getElementById('brainEditBody') as HTMLTextAreaElement | null;
  if (titleInput) titleInput.value = '';
  if (tagsEl) tagsEl.value = '';
  if (bodyEl) bodyEl.value = '';
  refreshEditPreview();
  setGraphSelectedPath(null);
  setEditStatus('ok', `Deleted ${relPath}`);
  openBrain('graph');
}

function bindEditSection(): void {
  if (bindingsDone) return;
  bindingsDone = true;

  document.getElementById('brainEditLoad')?.addEventListener('click', () => {
    void loadEditForm();
  });

  document.getElementById('brainEditNew')?.addEventListener('click', () => {
    void prepareNewPage();
  });

  document.getElementById('brainEditSave')?.addEventListener('click', () => {
    void saveEditForm();
  });
}

function bindEditPreview(): void {
  if (previewBound) return;
  previewBound = true;
  const bodyEl = document.getElementById('brainEditBody');
  bodyEl?.addEventListener('input', refreshEditPreview);
}

async function loadEditForm(): Promise<void> {
  const pathEl = document.getElementById('brainEditPath') as HTMLInputElement | null;
  const titleEl = document.getElementById('brainEditTitle') as HTMLInputElement | null;
  const tagsEl = document.getElementById('brainEditTags') as HTMLInputElement | null;
  const bodyEl = document.getElementById('brainEditBody') as HTMLTextAreaElement | null;
  if (!pathEl || !titleEl || !tagsEl || !bodyEl) return;

  const relPath = pathEl.value.trim().replace(/\\/g, '/');
  if (!relPath) {
    setEditStatus('err', 'Enter a relative path (e.g. facts/my-note.md).');
    return;
  }

  setEditStatus('spin', 'Loading…');
  const page = await fetchBrainPage(relPath);
  if (!page) {
    editPageLoaded = false;
    titleEl.value = '';
    tagsEl.value = '';
    bodyEl.value = '';
    refreshEditPreview();
    setEditStatus('ok', 'New page — fill in title and body, then save.');
    mountEditHeaderActions();
    return;
  }

  editPageLoaded = true;
  titleEl.value = page.meta.title;
  tagsEl.value = (page.meta.tags ?? []).join(', ');
  bodyEl.value = page.body;
  refreshEditPreview();
  setEditStatus('ok', `Loaded ${relPath}`);
  mountEditHeaderActions();
}

/** Reset the form for manual page creation. */
async function prepareNewPage(): Promise<void> {
  const pathEl = document.getElementById('brainEditPath') as HTMLInputElement | null;
  const titleEl = document.getElementById('brainEditTitle') as HTMLInputElement | null;
  const tagsEl = document.getElementById('brainEditTags') as HTMLInputElement | null;
  const bodyEl = document.getElementById('brainEditBody') as HTMLTextAreaElement | null;
  if (!pathEl || !titleEl || !tagsEl || !bodyEl) return;

  pathEl.value = 'facts/';
  editPageLoaded = false;
  titleEl.value = '';
  tagsEl.value = '';
  bodyEl.value = '';
  refreshEditPreview();
  setEditStatus('ok', 'New page — enter a path, title, and body, then save.');
  mountEditHeaderActions();
  pathEl.focus();
}

async function saveEditForm(): Promise<void> {
  const pathEl = document.getElementById('brainEditPath') as HTMLInputElement | null;
  const titleEl = document.getElementById('brainEditTitle') as HTMLInputElement | null;
  const tagsEl = document.getElementById('brainEditTags') as HTMLInputElement | null;
  const bodyEl = document.getElementById('brainEditBody') as HTMLTextAreaElement | null;
  if (!pathEl || !titleEl || !tagsEl || !bodyEl) return;

  let relPath = pathEl.value.trim().replace(/\\/g, '/');
  if (!relPath) {
    setEditStatus('err', 'Path is required.');
    return;
  }
  if (!relPath.endsWith('.md')) relPath = `${relPath}.md`;
  pathEl.value = relPath;

  const title = titleEl.value.trim();
  const body = bodyEl.value;
  if (!title || !body.trim()) {
    setEditStatus('err', 'Title and body are required.');
    return;
  }

  const tags = tagsEl.value
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  setEditStatus('spin', 'Saving…');
  const saved = await saveBrainPage({ path: relPath, title, body, tags, source: 'user' });
  if (!saved) {
    setEditStatus('err', 'Save failed. Is npm start running?');
    return;
  }

  setGraphSelectedPath(relPath);
  setEditStatus('ok', `Saved ${relPath}`);
}

/** Mount edit section and optionally pre-fill a path from Wiki. */
export async function renderEditSection(prefillPath?: string): Promise<void> {
  bindEditSection();
  bindEditPreview();
  mountEditHeaderActions();

  const pathEl = document.getElementById('brainEditPath') as HTMLInputElement | null;
  if (pathEl && prefillPath) {
    pathEl.value = prefillPath;
    if (prefillPath.endsWith('/')) {
      await prepareNewPage();
    } else {
      await loadEditForm();
    }
    return;
  }
  if (pathEl && !pathEl.value.trim()) {
    const fromGraph = getGraphSelectedPath();
    if (fromGraph) pathEl.value = fromGraph;
  }
  refreshEditPreview();
}
