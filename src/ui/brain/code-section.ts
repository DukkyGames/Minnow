/**
 * Brain app — Code section: repo map, symbol search, index status (MIN-B8).
 */

import {
  fetchBrainCodeCallsOf,
  fetchBrainCodeReadSymbol,
  fetchBrainCodeRepoMap,
  fetchBrainCodeStatus,
  fetchBrainCodeWhoCalls,
  findBrainCodeSymbol,
  reindexBrainCode,
} from '../../brain/client';
import type {
  BrainCodeStatus,
  BrainCodeSymbolMatch,
  BrainCodeSymbolRef,
} from '../../brain/types';

let bindingsDone = false;
let searchTimer: ReturnType<typeof setTimeout> | null = null;
let focusTimer: ReturnType<typeof setTimeout> | null = null;
let lastStatus: BrainCodeStatus | null = null;
let selectedSymbolId: string | null = null;

type ActionStatusFn = (kind: 'ok' | 'err' | 'spin', message: string) => void;

const setActionStatus: ActionStatusFn = (kind, message) => {
  const el = document.getElementById('brainCodeActionStatus');
  if (!el) return;
  el.textContent = message;
  el.dataset.kind = kind;
};

/** Format index stats for the toolbar line. */
function formatStatusLine(status: BrainCodeStatus): string {
  const when = status.lastIndexedAt
    ? new Date(status.lastIndexedAt).toLocaleString()
    : 'never';
  return `${status.repo} · ${status.symbolCount} symbols · ${status.fileCount} files · last indexed ${when}`;
}

/** Render repo map text into the pre block. */
async function refreshRepoMap(): Promise<void> {
  const mapEl = document.getElementById('brainCodeMap');
  const budgetEl = document.getElementById('brainCodeMapBudget');
  const focusEl = document.getElementById('brainCodeFocus') as HTMLInputElement | null;
  if (!mapEl) return;

  const focus = focusEl?.value.trim() ?? '';
  const map = await fetchBrainCodeRepoMap({
    focus: focus || undefined,
    tokenBudget: lastStatus?.repoMapTokenBudget,
  });

  if (!map) {
    mapEl.textContent = 'Repo map unavailable. Start npm start and reindex.';
    if (budgetEl) budgetEl.textContent = '';
    return;
  }

  mapEl.textContent = map.text;
  if (budgetEl) {
    const budget = lastStatus?.repoMapTokenBudget ?? '—';
    const truncated = map.truncated ? ' · truncated' : '';
    budgetEl.textContent = `~${map.tokenEstimate} / ${budget} tokens${truncated}`;
  }
}

/** Refresh index status line and offline banner. */
async function refreshCodeStatus(): Promise<void> {
  const line = document.getElementById('brainCodeStatusLine');
  const offlineEl = document.getElementById('brainCodeOffline');
  const status = await fetchBrainCodeStatus();
  lastStatus = status;

  offlineEl?.classList.toggle('hidden', status !== null);
  if (!line) return;

  if (!status) {
    line.textContent = 'Offline — start npm start.';
    return;
  }

  if (!status.enabled) {
    line.textContent = `${status.repo} · code index disabled in Settings`;
    return;
  }

  line.textContent = formatStatusLine(status);
}

/** Build a clickable edge list (callers or callees). */
function renderEdgeList(
  mount: HTMLElement,
  title: string,
  edges: BrainCodeSymbolRef[],
  emptyText: string,
): void {
  const section = document.createElement('section');
  section.className = 'brain-code-edge-group';
  const heading = document.createElement('h4');
  heading.className = 'brain-section-subtitle';
  heading.textContent = title;
  section.append(heading);

  if (!edges.length) {
    const empty = document.createElement('p');
    empty.className = 'brain-muted';
    empty.textContent = emptyText;
    section.append(empty);
    mount.append(section);
    return;
  }

  const list = document.createElement('ul');
  list.className = 'brain-code-edge-list';
  for (const edge of edges) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'brain-inline-link';
    btn.textContent = `${edge.name} (${edge.file}:${edge.line})`;
    btn.addEventListener('click', () => {
      void selectSymbol(edge.symbolId);
    });
    li.append(btn);
    if (edge.signature && edge.signature !== edge.name) {
      const sig = document.createElement('span');
      sig.className = 'brain-code-edge-sig';
      sig.textContent = ` — ${edge.signature}`;
      li.append(sig);
    }
    list.append(li);
  }
  section.append(list);
  mount.append(section);
}

/** Show definition + call graph for one symbol. */
async function selectSymbol(symbolId: string): Promise<void> {
  selectedSymbolId = symbolId;
  const detail = document.getElementById('brainCodeDetail');
  if (!detail) return;

  detail.hidden = false;
  detail.replaceChildren();

  const loading = document.createElement('p');
  loading.className = 'brain-muted';
  loading.textContent = 'Loading symbol…';
  detail.append(loading);

  const [def, callers, callees] = await Promise.all([
    fetchBrainCodeReadSymbol(symbolId),
    fetchBrainCodeWhoCalls(symbolId),
    fetchBrainCodeCallsOf(symbolId),
  ]);

  detail.replaceChildren();

  const sym = def?.symbol ?? callers?.symbol ?? callees?.symbol;
  if (!sym) {
    const err = document.createElement('p');
    err.className = 'brain-error';
    err.textContent = def?.error ?? callers?.error ?? callees?.error ?? 'Symbol not found';
    detail.append(err);
    return;
  }

  const head = document.createElement('div');
  head.className = 'brain-code-detail-head';
  const title = document.createElement('h3');
  title.className = 'brain-code-detail-title';
  title.textContent = sym.name;
  const meta = document.createElement('p');
  meta.className = 'brain-code-detail-meta';
  meta.textContent = `${sym.kind} · ${sym.file}:${sym.line_start}-${sym.line_end}`;
  head.append(title, meta);
  if (sym.signature) {
    const sig = document.createElement('p');
    sig.className = 'brain-code-detail-signature';
    sig.textContent = sym.signature;
    head.append(sig);
  }
  detail.append(head);

  if (def?.text) {
    const pre = document.createElement('pre');
    pre.className = 'brain-code-def';
    pre.textContent = def.text;
    detail.append(pre);
  }

  renderEdgeList(
    detail,
    'Called by',
    callers?.callers ?? [],
    'No indexed callers.',
  );
  renderEdgeList(
    detail,
    'Calls',
    callees?.callees ?? [],
    'No indexed callees.',
  );

  highlightSearchResult(symbolId);
}

/** Mark the active row in the search results list. */
function highlightSearchResult(symbolId: string): void {
  const list = document.getElementById('brainCodeResults');
  if (!list) return;
  for (const child of list.children) {
    if (!(child instanceof HTMLLIElement)) continue;
    const btn = child.querySelector('button');
    const active = btn?.dataset.symbolId === symbolId;
    child.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

/** Render find_symbol matches. */
function renderSearchResults(matches: BrainCodeSymbolMatch[]): void {
  const list = document.getElementById('brainCodeResults');
  if (!list) return;
  list.replaceChildren();

  if (!matches.length) {
    const empty = document.createElement('li');
    empty.className = 'brain-muted';
    empty.textContent = 'No matches. Try reindex or a shorter query.';
    list.append(empty);
    return;
  }

  for (const match of matches) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'brain-code-result-btn';
    btn.dataset.symbolId = match.id;
    const nameSpan = document.createElement('span');
    nameSpan.className = 'brain-code-result-name';
    nameSpan.textContent = match.name;
    const locSpan = document.createElement('span');
    locSpan.className = 'brain-code-result-loc';
    locSpan.textContent = `${match.file}:${match.line_start}`;
    btn.append(nameSpan, locSpan);
    if (match.signature && match.signature !== match.name) {
      const sig = document.createElement('span');
      sig.className = 'brain-code-result-sig';
      sig.textContent = match.signature;
      btn.append(sig);
    }
    btn.addEventListener('click', () => {
      void selectSymbol(match.id);
    });
    li.append(btn);
    list.append(li);
  }

  if (selectedSymbolId) highlightSearchResult(selectedSymbolId);
}

/** Debounced symbol search. */
async function runSymbolSearch(query: string): Promise<void> {
  const trimmed = query.trim();
  if (!trimmed) {
    renderSearchResults([]);
    const detail = document.getElementById('brainCodeDetail');
    if (detail) {
      detail.hidden = true;
      detail.replaceChildren();
    }
    selectedSymbolId = null;
    return;
  }

  const result = await findBrainCodeSymbol(trimmed, 25);
  if (!result) {
    renderSearchResults([]);
    setActionStatus('err', 'Search failed. Is npm start running?');
    return;
  }

  renderSearchResults(result.matches);
  if (result.error && result.matches.length === 0) {
    setActionStatus('err', result.error);
  }
}

/** Full workspace reindex. */
async function runReindex(): Promise<void> {
  const btn = document.getElementById('brainCodeReindex') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  setActionStatus('spin', 'Reindexing workspace…');

  const result = await reindexBrainCode();
  if (btn) btn.disabled = false;

  if (!result?.ok) {
    setActionStatus('err', 'Reindex failed');
    return;
  }

  setActionStatus(
    'ok',
    `Indexed ${result.indexedFiles} changed file${result.indexedFiles === 1 ? '' : 's'} in ${result.repo}`,
  );
  await refreshCodeStatus();
  await refreshRepoMap();
}

function bindCodeSection(): void {
  if (bindingsDone) return;
  bindingsDone = true;

  document.getElementById('brainCodeReindex')?.addEventListener('click', () => {
    void runReindex();
  });

  const searchEl = document.getElementById('brainCodeSearch') as HTMLInputElement | null;
  searchEl?.addEventListener('input', () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      void runSymbolSearch(searchEl.value);
    }, 280);
  });
  searchEl?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') {
      ev.preventDefault();
      if (searchTimer) clearTimeout(searchTimer);
      void runSymbolSearch(searchEl.value);
    }
  });

  const focusEl = document.getElementById('brainCodeFocus') as HTMLInputElement | null;
  focusEl?.addEventListener('input', () => {
    if (focusTimer) clearTimeout(focusTimer);
    focusTimer = setTimeout(() => {
      void refreshRepoMap();
    }, 320);
  });
}

/** Load Code section: status, repo map, wire controls once. */
export async function renderCodeSection(): Promise<void> {
  bindCodeSection();
  await refreshCodeStatus();
  await refreshRepoMap();
}
