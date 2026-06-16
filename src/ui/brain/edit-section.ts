/**
 * Brain app — Edit section: frontmatter fields + body editor, save via PUT /page.
 */

import { fetchBrainPage, saveBrainPage } from '../../brain/client';
import { getWikiSelectedPath, setWikiSelectedPath } from './wiki-section';

let bindingsDone = false;

function setEditStatus(kind: 'ok' | 'err' | 'spin', message: string): void {
  const el = document.getElementById('brainEditStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
}

function bindEditSection(): void {
  if (bindingsDone) return;
  bindingsDone = true;

  document.getElementById('brainEditLoad')?.addEventListener('click', () => {
    void loadEditForm();
  });

  document.getElementById('brainEditSave')?.addEventListener('click', () => {
    void saveEditForm();
  });
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
    setEditStatus('ok', 'New page — fill in title and body, then save.');
    return;
  }

  titleEl.value = page.meta.title;
  tagsEl.value = (page.meta.tags ?? []).join(', ');
  bodyEl.value = page.body;
  setEditStatus('ok', `Loaded ${relPath}`);
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

  setWikiSelectedPath(relPath);
  setEditStatus('ok', `Saved ${relPath}`);
}

/** Mount edit section and optionally pre-fill a path from Wiki. */
export async function renderEditSection(prefillPath?: string): Promise<void> {
  bindEditSection();
  const pathEl = document.getElementById('brainEditPath') as HTMLInputElement | null;
  if (pathEl && prefillPath) {
    pathEl.value = prefillPath;
    await loadEditForm();
    return;
  }
  if (pathEl && !pathEl.value.trim()) {
    const fromWiki = getWikiSelectedPath();
    if (fromWiki) pathEl.value = fromWiki;
  }
}
