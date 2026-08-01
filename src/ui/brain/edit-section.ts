/**
 * Brain app — Edit section: frontmatter fields + body editor, save via PUT /page.
 */

import { fetchBrainPage, saveBrainPage } from '../../brain/client';
import { getGraphSelectedPath, setGraphSelectedPath } from './graph-section';
import { renderBrainMarkdown } from './wikilink-markdown';
import {
  memorySavedPayloadFromBrainPage,
  showMemorySavedToast,
} from '../memory-saved-toast';

let bindingsDone = false;
let previewBound = false;

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
    titleEl.value = '';
    tagsEl.value = '';
    bodyEl.value = '';
    refreshEditPreview();
    setEditStatus('ok', 'New page — fill in title and body, then save.');
    return;
  }

  titleEl.value = page.meta.title;
  tagsEl.value = (page.meta.tags ?? []).join(', ');
  bodyEl.value = page.body;
  refreshEditPreview();
  setEditStatus('ok', `Loaded ${relPath}`);
}

/** Reset the form for manual page creation. */
async function prepareNewPage(): Promise<void> {
  const pathEl = document.getElementById('brainEditPath') as HTMLInputElement | null;
  const titleEl = document.getElementById('brainEditTitle') as HTMLInputElement | null;
  const tagsEl = document.getElementById('brainEditTags') as HTMLInputElement | null;
  const bodyEl = document.getElementById('brainEditBody') as HTMLTextAreaElement | null;
  if (!pathEl || !titleEl || !tagsEl || !bodyEl) return;

  pathEl.value = 'facts/';
  titleEl.value = '';
  tagsEl.value = '';
  bodyEl.value = '';
  refreshEditPreview();
  setEditStatus('ok', 'New page — enter a path, title, and body, then save.');
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
    setEditStatus('err', 'Save failed. Is Minnow running?');
    return;
  }

  setGraphSelectedPath(relPath);
  setEditStatus('ok', `Saved ${relPath}`);
  showMemorySavedToast(memorySavedPayloadFromBrainPage(saved));
}

/** Mount edit section and optionally pre-fill a path from Wiki. */
export async function renderEditSection(prefillPath?: string): Promise<void> {
  bindEditSection();
  bindEditPreview();

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
