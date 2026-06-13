/**
 * Benchmark Tests tab: catalog browser + custom test editor (absorbs Settings Evals).
 */

import {
  listIntegrationCatalogEntries,
  listStandardCatalogEntries,
  standardToUnified,
  type UnifiedCatalogEntry,
} from '../../benchmark/standard/catalog.ts';
import { getStandardPack } from '../../benchmark/standard/pack-loader.ts';
import type { SuiteId } from '../../benchmark/types.ts';
import {
  deleteUserEvalPack,
  fetchEvalPack,
  fetchEvalPacksList,
  saveUserEvalPack,
} from '../../evals/eval-api.ts';
import type { EvalPack, EvalPackListItem } from '../../evals/types.ts';
import { importStandardDataset } from '../../benchmark/campaign-persistence.ts';
import type { StandardBenchmarkPack } from '../../benchmark/standard/types.ts';
import { isLocalServerAvailable } from '../../tools/config.ts';

const ALL_INTEGRATION_SUITES: SuiteId[] = [
  'capability',
  'speed',
  'tools',
  'skills',
  'coding',
];

type FamilyFilter = 'all' | 'integration' | 'standard' | 'custom';

let familyFilter: FamilyFilter = 'all';
let searchQuery = '';

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function loadCatalog(): Promise<UnifiedCatalogEntry[]> {
  const integration = listIntegrationCatalogEntries(ALL_INTEGRATION_SUITES);
  const standard = standardToUnified(listStandardCatalogEntries());
  let custom: UnifiedCatalogEntry[] = [];
  try {
    const packs = await fetchEvalPacksList();
    custom = packs.map((p) => ({
      id: p.id,
      label: p.label,
      family: 'custom' as const,
      category: 'custom',
      purpose: `User task pack with ${p.taskCount} tasks`,
      method: 'LLM completion graded by rubric',
      passCriteria: 'Rubric score threshold',
      promptPreview: p.label,
      packId: p.id,
    }));
  } catch {
    /* offline */
  }
  return [...integration, ...standard, ...custom];
}

function filterEntries(entries: UnifiedCatalogEntry[]): UnifiedCatalogEntry[] {
  const q = searchQuery.trim().toLowerCase();
  return entries.filter((e) => {
    if (familyFilter !== 'all' && e.family !== familyFilter) return false;
    if (!q) return true;
    const hay = `${e.label} ${e.id} ${e.category} ${e.purpose}`.toLowerCase();
    return hay.includes(q);
  });
}

function openCatalogDrawer(entry: UnifiedCatalogEntry): void {
  const drawer = document.getElementById('benchmarkCatalogDrawer');
  const backdrop = document.getElementById('benchmarkCatalogDrawerBackdrop');
  const body = document.getElementById('benchmarkCatalogDrawerBody');
  if (!(drawer instanceof HTMLElement) || !(body instanceof HTMLElement)) return;

  let promptBlock = `<p class="benchmark-catalog-prompt">${escapeHtml(entry.promptPreview)}</p>`;
  if (entry.family === 'standard' && entry.packId) {
    const pack = getStandardPack(entry.packId);
    if (pack?.items[0]) {
      promptBlock = `<pre class="benchmark-catalog-prompt-pre">${escapeHtml(pack.items[0].prompt)}</pre>`;
    }
  }

  body.innerHTML = `
    <header class="benchmark-catalog-drawer-hdr">
      <span class="benchmark-catalog-badge">${escapeHtml(entry.family)}</span>
      <h3>${escapeHtml(entry.label)}</h3>
    </header>
    <dl class="benchmark-catalog-meta">
      <dt>Category</dt><dd>${escapeHtml(entry.category)}</dd>
      <dt>Purpose</dt><dd>${escapeHtml(entry.purpose)}</dd>
      <dt>Method</dt><dd>${escapeHtml(entry.method)}</dd>
      <dt>Pass criteria</dt><dd>${escapeHtml(entry.passCriteria)}</dd>
      ${entry.tier ? `<dt>Tier</dt><dd>${escapeHtml(entry.tier)}</dd>` : ''}
    </dl>
    <h4 class="benchmark-field-label">Prompt preview</h4>
    ${promptBlock}`;

  drawer.hidden = false;
  backdrop?.removeAttribute('hidden');
}

function closeCatalogDrawer(): void {
  document.getElementById('benchmarkCatalogDrawer')?.setAttribute('hidden', '');
  document.getElementById('benchmarkCatalogDrawerBackdrop')?.setAttribute('hidden', '');
}

async function renderCustomEditor(
  mount: HTMLElement,
  pack?: EvalPackListItem,
): Promise<void> {
  const editor = document.createElement('div');
  editor.className = 'benchmark-custom-editor';
  editor.innerHTML = `
    <h3 class="benchmark-custom-editor-title">${pack ? 'Edit pack' : 'New custom test pack'}</h3>
    <label class="benchmark-custom-field"><span class="benchmark-field-label">Pack ID</span>
      <input type="text" id="benchmarkCustomPackId" value="${escapeHtml(pack?.id ?? '')}" ${pack ? 'readonly' : ''} /></label>
    <label class="benchmark-custom-field"><span class="benchmark-field-label">Label</span>
      <input type="text" id="benchmarkCustomPackLabel" value="${escapeHtml(pack?.label ?? '')}" /></label>
    <label class="benchmark-custom-field"><span class="benchmark-field-label">Tasks JSON</span>
      <textarea id="benchmarkCustomPackJson" rows="12" class="benchmark-custom-json"></textarea></label>
    <div class="benchmark-custom-actions">
      <button type="button" class="is-primary" id="btnBenchmarkSaveCustomPack">Save pack</button>
      ${pack?.source === 'user' ? '<button type="button" id="btnBenchmarkDeleteCustomPack">Delete</button>' : ''}
    </div>`;
  mount.prepend(editor);

  const ta = editor.querySelector('#benchmarkCustomPackJson');
  if (pack && ta instanceof HTMLTextAreaElement) {
    try {
      const full = await fetchEvalPack(pack.id);
      ta.value = JSON.stringify(full, null, 2);
    } catch {
      ta.value = '[]';
    }
  } else if (ta instanceof HTMLTextAreaElement) {
    ta.value = JSON.stringify(
      {
        id: 'my-pack',
        label: 'My pack',
        version: 1,
        tasks: [
          {
            id: 'task-1',
            prompt: 'Say hello in one word.',
            allowedTools: [],
            deniedTools: [],
            rubricPrompt: 'Pass if the response is a greeting.',
          },
        ],
      },
      null,
      2,
    );
  }

  editor.querySelector('#btnBenchmarkSaveCustomPack')?.addEventListener('click', () => {
    void (async () => {
      const raw = (editor.querySelector('#benchmarkCustomPackJson') as HTMLTextAreaElement)?.value;
      try {
        const parsed = JSON.parse(raw) as EvalPack;
        await saveUserEvalPack(parsed);
        await renderTestsPanel(mount.closest('#benchmarkTabTests') as HTMLElement);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        alert(message);
      }
    })();
  });

  editor.querySelector('#btnBenchmarkDeleteCustomPack')?.addEventListener('click', () => {
    if (!pack) return;
    void (async () => {
      await deleteUserEvalPack(pack.id);
      await renderTestsPanel(mount.closest('#benchmarkTabTests') as HTMLElement);
    })();
  });
}

function wireImportDataset(mount: HTMLElement): void {
  const input = mount.querySelector('#benchmarkDatasetImport') as HTMLInputElement | null;
  input?.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    void (async () => {
      const text = await file.text();
      const pack = JSON.parse(text) as StandardBenchmarkPack;
      await importStandardDataset(pack);
      alert(`Imported full-tier pack: ${pack.id}`);
      await renderTestsPanel(mount);
    })();
  });
}

export async function renderTestsPanel(mount: HTMLElement): Promise<void> {
  mount.classList.add('benchmark-tab-panel--tests');
  const entries = await loadCatalog();
  const filtered = filterEntries(entries);

  mount.innerHTML = `
    <div class="benchmark-tests-toolbar">
      <input type="search" id="benchmarkTestsSearch" class="benchmark-tests-search" placeholder="Search tests…" value="${escapeHtml(searchQuery)}" />
      <div class="benchmark-tests-filters" role="group" aria-label="Filter by family">
        ${(['all', 'integration', 'standard', 'custom'] as FamilyFilter[])
          .map(
            (f) =>
              `<button type="button" class="benchmark-tests-filter${familyFilter === f ? ' is-active' : ''}" data-family="${f}">${f}</button>`,
          )
          .join('')}
      </div>
      <div class="benchmark-tests-actions">
        <button type="button" class="benchmark-tests-new is-primary" id="btnBenchmarkNewCustomPack">New custom pack</button>
        <label class="benchmark-tests-import">
          <input type="file" id="benchmarkDatasetImport" class="benchmark-tests-import-input" accept=".json,application/json" />
          <span class="benchmark-tests-import-btn">Import dataset</span>
        </label>
      </div>
    </div>
    <ul class="benchmark-catalog-list" id="benchmarkCatalogList"></ul>`;

  const list = mount.querySelector('#benchmarkCatalogList');
  if (list instanceof HTMLElement) {
    for (const entry of filtered) {
      const li = document.createElement('li');
      li.className = 'benchmark-catalog-item';
      li.innerHTML = `
        <button type="button" class="benchmark-catalog-item-btn">
          <span class="benchmark-catalog-badge">${escapeHtml(entry.family)}</span>
          <strong>${escapeHtml(entry.label)}</strong>
          <span class="benchmark-muted">${escapeHtml(entry.category)}</span>
        </button>`;
      li.querySelector('button')?.addEventListener('click', () => openCatalogDrawer(entry));
      list.appendChild(li);
    }
    if (!filtered.length) {
      list.innerHTML = '<li class="benchmark-empty">No tests match your filter.</li>';
    }
  }

  mount.querySelector('#benchmarkTestsSearch')?.addEventListener('input', (e) => {
    searchQuery = (e.target as HTMLInputElement).value;
    void renderTestsPanel(mount);
  });

  for (const btn of mount.querySelectorAll<HTMLButtonElement>('.benchmark-tests-filter')) {
    btn.addEventListener('click', () => {
      familyFilter = (btn.dataset.family as FamilyFilter) ?? 'all';
      void renderTestsPanel(mount);
    });
  }

  mount.querySelector('#btnBenchmarkNewCustomPack')?.addEventListener('click', () => {
    void renderCustomEditor(mount);
  });

  wireImportDataset(mount);

  if (!isLocalServerAvailable()) {
    const hint = document.createElement('p');
    hint.className = 'benchmark-tests-hint';
    hint.textContent = 'Start npm start to save custom packs and import datasets.';
    mount.appendChild(hint);
  }
}

export function initTestsPanelDrawer(): void {
  document.getElementById('benchmarkCatalogDrawerClose')?.addEventListener('click', closeCatalogDrawer);
  document.getElementById('benchmarkCatalogDrawerBackdrop')?.addEventListener('click', closeCatalogDrawer);
}
