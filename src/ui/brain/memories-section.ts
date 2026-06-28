/**
 * Brain app — Memories: store toggles, entry CRUD, backup/clear.
 */

import {
  backupMemory,
  clearMemory,
  createMemoryEntry,
  deleteMemoryEntry,
  fetchMemoryEnabled,
  fetchMemoryEntries,
  fetchMemoryStatus,
} from '../../memory/client';
import { parseMemoryTagsInput } from '../../memory/parse-tags';
import type { MemoryEntryWithBody } from '../../memory/types';

type StatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

let bindingsDone = false;
let listBindingsDone = false;
let addFormBound = false;

const MEMORY_BODY_MAX_BYTES = 32 * 1024;

const setStatus: StatusFn = (kind, message) => {
  const el = document.getElementById('brainMemoriesStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
};

async function saveFeatureToggle(key: string, enabled: boolean): Promise<void> {
  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) return;
    const config = (await res.json()) as Record<string, unknown>;
    const features =
      config.features && typeof config.features === 'object'
        ? { ...(config.features as Record<string, boolean>) }
        : {};
    features[key] = enabled;
    config.features = features;
    await fetch('/api/config/file?key=config.json', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
  } catch {
    /* offline */
  }
}

function clearMemoryAddForm(): void {
  const form = document.getElementById('brainMemoryAddForm') as HTMLFormElement | null;
  form?.reset();
  const err = document.getElementById('brainMemoryAddError');
  err?.classList.add('hidden');
  if (err) err.textContent = '';
}

function sortMemoryEntries(entries: MemoryEntryWithBody[]): MemoryEntryWithBody[] {
  return [...entries].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return String(b.updatedAt).localeCompare(String(a.updatedAt));
  });
}

function formatMemoryTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function renderMemoryEntryRow(entry: MemoryEntryWithBody): HTMLElement {
  const row = document.createElement('article');
  row.className = 'settings-memory-row';
  row.setAttribute('role', 'listitem');
  row.dataset.memoryId = entry.id;

  const head = document.createElement('div');
  head.className = 'settings-memory-row-head';

  const title = document.createElement('h3');
  title.className = 'settings-memory-title';
  title.textContent = entry.title || 'Untitled';
  head.append(title);

  const removeBtn = document.createElement('button');
  removeBtn.type = 'button';
  removeBtn.className = 'settings-inline-btn settings-memory-remove';
  removeBtn.textContent = 'Delete';
  removeBtn.setAttribute('aria-label', `Delete memory ${entry.title}`);
  removeBtn.dataset.memoryRemove = entry.id;
  head.append(removeBtn);

  row.append(head);

  const meta = document.createElement('div');
  meta.className = 'settings-memory-meta';

  if (entry.pinned) {
    const pin = document.createElement('span');
    pin.className = 'settings-memory-badge settings-memory-badge--pinned';
    pin.textContent = 'Pinned';
    meta.append(pin);
  }

  const source = document.createElement('span');
  source.className = 'settings-memory-badge';
  source.textContent = entry.source;
  meta.append(source);

  const updated = document.createElement('span');
  updated.className = 'settings-memory-updated';
  updated.textContent = `Updated ${formatMemoryTimestamp(entry.updatedAt)}`;
  meta.append(updated);

  if (entry.tags.length) {
    const tags = document.createElement('span');
    tags.className = 'settings-memory-tags';
    tags.textContent = entry.tags.join(', ');
    meta.append(tags);
  }

  row.append(meta);

  const body = document.createElement('pre');
  body.className = 'settings-memory-body';
  body.textContent = entry.body?.trim() ? entry.body : '(empty)';
  row.append(body);

  return row;
}

function bindMemoryListActions(listEl: HTMLElement): void {
  if (listBindingsDone) return;
  listBindingsDone = true;

  listEl.addEventListener('click', (ev) => {
    const target = (ev.target as HTMLElement).closest(
      '[data-memory-remove]',
    ) as HTMLButtonElement | null;
    if (!target?.dataset.memoryRemove) return;

    const id = target.dataset.memoryRemove;
    void (async () => {
      if (!confirm('Delete this memory entry?')) return;
      const ok = await deleteMemoryEntry(id);
      if (ok) {
        setStatus('ok', 'Memory entry deleted');
        await refreshMemoryEntriesList();
        return;
      }
      setStatus('err', 'Delete failed — use npm start');
    })();
  });
}

function bindMemoryAddForm(): void {
  if (addFormBound) return;
  addFormBound = true;

  const form = document.getElementById('brainMemoryAddForm') as HTMLFormElement | null;
  const errEl = document.getElementById('brainMemoryAddError');
  const resetBtn = document.getElementById('brainMemoryAddReset');

  resetBtn?.addEventListener('click', () => clearMemoryAddForm());

  form?.addEventListener('submit', (event) => {
    event.preventDefault();
    void (async () => {
      const titleInput = document.getElementById('brainMemoryAddTitle') as HTMLInputElement | null;
      const bodyInput = document.getElementById('brainMemoryAddBody') as HTMLTextAreaElement | null;
      const tagsInput = document.getElementById('brainMemoryAddTags') as HTMLInputElement | null;

      const title = titleInput?.value.trim() ?? '';
      const body = bodyInput?.value ?? '';
      const bodyTrimmed = body.trim();

      if (!title || !bodyTrimmed) {
        if (errEl) {
          errEl.textContent = 'Title and body are required.';
          errEl.classList.remove('hidden');
        }
        return;
      }

      const bodyBytes = new TextEncoder().encode(body).length;
      if (bodyBytes > MEMORY_BODY_MAX_BYTES) {
        if (errEl) {
          errEl.textContent = 'Body exceeds 32 KB. Shorten the text and try again.';
          errEl.classList.remove('hidden');
        }
        setStatus('err', 'Memory body too large (max 32 KB)');
        return;
      }

      const tags = parseMemoryTagsInput(tagsInput?.value ?? '');
      const entry = await createMemoryEntry({
        title,
        body,
        tags,
        source: 'user',
      });

      if (!entry) {
        if (errEl) {
          errEl.textContent = 'Save failed — start with npm start and try again.';
          errEl.classList.remove('hidden');
        }
        setStatus('err', 'Save failed — use npm start');
        return;
      }

      if (errEl) errEl.classList.add('hidden');
      clearMemoryAddForm();
      const panel = document.getElementById('brainMemoryAddPanel') as HTMLDetailsElement | null;
      if (panel) panel.open = false;
      setStatus('ok', `Saved memory “${entry.title}”`);
      await refreshMemoryEntriesList();
    })();
  });
}

async function hydrateToggles(): Promise<void> {
  const enableEl = document.getElementById('brainMemoryEnabled') as HTMLInputElement | null;
  if (enableEl) {
    enableEl.checked = await fetchMemoryEnabled();
  }

  try {
    const res = await fetch('/api/config/file?key=config.json');
    if (!res.ok) return;
    const config = (await res.json()) as {
      features?: { memoryInjection?: boolean };
    };
    const injectionEl = document.getElementById(
      'brainFeatureMemoryInjection',
    ) as HTMLInputElement | null;
    if (injectionEl && typeof config.features?.memoryInjection === 'boolean') {
      injectionEl.checked = config.features.memoryInjection;
    }
  } catch {
    /* offline */
  }
}

function bindMemoriesSection(): void {
  if (bindingsDone) return;
  bindingsDone = true;

  const enableEl = document.getElementById('brainMemoryEnabled') as HTMLInputElement | null;
  enableEl?.addEventListener('change', async () => {
    try {
      const res = await fetch('/api/config/file?key=config.json');
      if (!res.ok) return;
      const config = await res.json();
      config.memory = {
        ...(config.memory ?? {}),
        enabled: enableEl.checked,
      };
      await fetch('/api/config/file?key=config.json', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      setStatus('ok', enableEl.checked ? 'Memory enabled' : 'Memory disabled');
    } catch {
      setStatus('err', 'Memory settings require npm start');
    }
  });

  const injectionEl = document.getElementById(
    'brainFeatureMemoryInjection',
  ) as HTMLInputElement | null;
  injectionEl?.addEventListener('change', () => {
    void saveFeatureToggle('memoryInjection', injectionEl.checked);
  });

  document.getElementById('brainMemoryBackup')?.addEventListener('click', async () => {
    const id = await backupMemory();
    setStatus(
      id ? 'ok' : 'err',
      id ? `Memory backup: ${id}` : 'Backup failed. Use npm start.',
    );
  });

  document.getElementById('brainMemoryClear')?.addEventListener('click', async () => {
    if (!confirm('Clear all memory entries?')) return;
    const ok = await clearMemory(true);
    setStatus(
      ok ? 'ok' : 'err',
      ok ? 'Memory cleared (archived)' : 'Clear failed. Use npm start.',
    );
    if (ok) await refreshMemoryEntriesList();
  });

  bindMemoryAddForm();
}

async function refreshMemoryEntriesList(): Promise<void> {
  const countEl = document.getElementById('brainMemoryEntryCount');
  const hintEl = document.getElementById('brainMemoryServerHint');
  const listEl = document.getElementById('brainMemoryList');
  const offlineEl = document.getElementById('brainMemoryOffline');
  const addPanel = document.getElementById('brainMemoryAddPanel');
  if (!countEl || !hintEl || !listEl) return;

  listEl.replaceChildren();
  bindMemoryListActions(listEl);

  const status = await fetchMemoryStatus();
  const online = !!status;
  offlineEl?.classList.toggle('hidden', online);
  addPanel?.classList.toggle('hidden', !online);

  if (!status) {
    countEl.textContent = 'Entries: —';
    hintEl.textContent = 'Start npm start for memory API';
    const offline = document.createElement('p');
    offline.className = 'settings-section-note';
    offline.textContent = 'Start npm start to view and manage stored memories.';
    listEl.append(offline);
    return;
  }

  countEl.textContent = `Entries: ${status.entryCount}`;
  hintEl.textContent = status.home ? `Store: ${status.home}` : 'Server connected';

  const entries = await fetchMemoryEntries(true);
  if (!entries) {
    const err = document.createElement('p');
    err.className = 'settings-section-note';
    err.textContent = 'Could not load memory entries.';
    listEl.append(err);
    return;
  }

  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'settings-section-note';
    empty.textContent = 'No memory entries yet.';
    listEl.append(empty);
    return;
  }

  const sorted = sortMemoryEntries(entries);
  for (const entry of sorted) {
    listEl.append(renderMemoryEntryRow(entry));
  }
}

/** Load Brain memories section: toggles, entries, backup/clear. */
export async function renderMemoriesSection(): Promise<void> {
  bindMemoriesSection();
  await hydrateToggles();
  await refreshMemoryEntriesList();
}
