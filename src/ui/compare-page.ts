/**
 * Blind A/B model compare — dual streaming panes, vote, reveal, history.
 */

import '../styles/compare.css';
import '../styles/settings-page.css';

import { humanizeModelSlug, slugFromModelId } from '../lib/format-model-label';
import { isOsAppHash, isOsShellEnabled } from '../os/page-bridge';
import { navigateToDesktop } from '../os/router';
import { BenchmarkStreamTextAccumulator } from '../benchmark/stream-text';
import { listCompareHistory, submitCompareVote } from '../compare/persistence';
import { subscribeToCompareStream } from '../compare/stream';
import type {
  CompareAlias,
  CompareStartResponse,
  CompareVote,
  CompareWinner,
} from '../compare/types';
import { aggregateWinRates } from '../compare/win-rates';
import { cancelGeneration } from '../api/generations';
import { fillModelSelect, fillProviderSelect } from './settings-model-binding';
import {
  mountAuxiliaryModelSelectCombobox,
  syncAuxiliaryModelSelectCombobox,
} from './model-select-picker';

type ColumnSide = 'left' | 'right';

interface ColumnState {
  label: CompareAlias;
  generationId: string;
  text: string;
  status: 'idle' | 'streaming' | 'complete' | 'error' | 'cancelled';
  error?: string;
  unsubscribe: (() => void) | null;
}

let sessionId: string | null = null;
let revealed = false;
let leftColumn: ColumnState | null = null;
let rightColumn: ColumnState | null = null;
let runAbort: AbortController | null = null;
let initialized = false;
let modelComboboxesMounted = false;

function ensureCompareModelComboboxes(): void {
  if (modelComboboxesMounted) return;
  const leftModel = el<HTMLSelectElement>('compareLeftModel');
  const rightModel = el<HTMLSelectElement>('compareRightModel');
  if (!leftModel || !rightModel) return;
  mountAuxiliaryModelSelectCombobox(leftModel);
  mountAuxiliaryModelSelectCombobox(rightModel);
  modelComboboxesMounted = true;
}

function syncCompareModelComboboxes(): void {
  const leftModel = el<HTMLSelectElement>('compareLeftModel');
  const rightModel = el<HTMLSelectElement>('compareRightModel');
  if (leftModel) syncAuxiliaryModelSelectCombobox(leftModel);
  if (rightModel) syncAuxiliaryModelSelectCombobox(rightModel);
}

function getRoot(): HTMLElement | null {
  return document.getElementById('compareView');
}

function getShell(): HTMLElement | null {
  return document.getElementById('chatShell');
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function setVoteEnabled(enabled: boolean): void {
  for (const id of [
    'btnCompareVoteLeft',
    'btnCompareVoteRight',
    'btnCompareVoteTie',
    'btnCompareVoteBothBad',
  ]) {
    const btn = el<HTMLButtonElement>(id);
    if (btn) btn.disabled = !enabled;
  }
}

function columnEls(side: ColumnSide): {
  pane: HTMLElement | null;
  label: HTMLElement | null;
  body: HTMLElement | null;
  status: HTMLElement | null;
  reveal: HTMLElement | null;
} {
  const prefix = side === 'left' ? 'compareLeft' : 'compareRight';
  return {
    pane: el(`${prefix}Pane`),
    label: el(`${prefix}Label`),
    body: el(`${prefix}Body`),
    status: el(`${prefix}Status`),
    reveal: el(`${prefix}Reveal`),
  };
}

function renderColumn(side: ColumnSide, col: ColumnState | null): void {
  const { label, body, status, reveal } = columnEls(side);
  if (!label || !body || !status) return;
  if (!col) {
    label.textContent = side === 'left' ? 'A' : 'B';
    body.textContent = '';
    status.textContent = 'Waiting…';
    if (reveal) reveal.textContent = '';
    return;
  }
  label.textContent = col.label;
  body.textContent = col.text;
  if (col.status === 'streaming') {
    status.textContent = 'Streaming…';
  } else if (col.status === 'complete') {
    status.textContent = 'Complete';
  } else if (col.status === 'error') {
    status.textContent = col.error ?? 'Error';
  } else if (col.status === 'cancelled') {
    status.textContent = 'Stopped';
  } else {
    status.textContent = 'Waiting…';
  }
}

function formatModelRef(providerId: string, modelId: string): string {
  const slug = slugFromModelId(modelId);
  const name = humanizeModelSlug(slug);
  return `${name} (${providerId})`;
}

function showReveal(
  left: { providerId: string; modelId: string },
  right: { providerId: string; modelId: string },
): void {
  const leftReveal = el('compareLeftReveal');
  const rightReveal = el('compareRightReveal');
  if (leftReveal) {
    leftReveal.textContent =
      left.providerId && left.modelId
        ? formatModelRef(left.providerId, left.modelId)
        : '';
  }
  if (rightReveal) {
    rightReveal.textContent =
      right.providerId && right.modelId
        ? formatModelRef(right.providerId, right.modelId)
        : '';
  }
}

function bothColumnsSettled(): boolean {
  const settled = (col: ColumnState | null) =>
    col &&
    (col.status === 'complete' ||
      col.status === 'error' ||
      col.status === 'cancelled');
  return Boolean(settled(leftColumn) && settled(rightColumn));
}

function updateVoteBar(): void {
  setVoteEnabled(!revealed && bothColumnsSettled() && Boolean(sessionId));
}

async function refreshModelPickers(): Promise<void> {
  ensureCompareModelComboboxes();
  const leftProvider = el<HTMLSelectElement>('compareLeftProvider');
  const leftModel = el<HTMLSelectElement>('compareLeftModel');
  const rightProvider = el<HTMLSelectElement>('compareRightProvider');
  const rightModel = el<HTMLSelectElement>('compareRightModel');
  if (!leftProvider || !leftModel || !rightProvider || !rightModel) return;

  await fillProviderSelect(leftProvider, leftProvider.value, { includeEmptyOption: false });
  await fillProviderSelect(rightProvider, rightProvider.value, { includeEmptyOption: false });

  const wireModel = async (provider: HTMLSelectElement, model: HTMLSelectElement) => {
    const refresh = async () => {
      await fillModelSelect(model, provider.value, model.value, {
        includeEmptyOption: false,
      });
      syncAuxiliaryModelSelectCombobox(model);
    };
    provider.onchange = () => void refresh();
    await refresh();
  };

  await wireModel(leftProvider, leftModel);
  await wireModel(rightProvider, rightModel);
  syncCompareModelComboboxes();
}

function resetRunUi(): void {
  if (leftColumn?.unsubscribe) leftColumn.unsubscribe();
  if (rightColumn?.unsubscribe) rightColumn.unsubscribe();
  runAbort?.abort();
  runAbort = null;
  sessionId = null;
  revealed = false;
  leftColumn = null;
  rightColumn = null;
  renderColumn('left', null);
  renderColumn('right', null);
  showReveal({ providerId: '', modelId: '' }, { providerId: '', modelId: '' });
  setVoteEnabled(false);
  const runBtn = el<HTMLButtonElement>('btnCompareRun');
  if (runBtn) runBtn.disabled = false;
}

function startColumnStream(
  side: ColumnSide,
  col: ColumnState,
  signal: AbortSignal,
): void {
  const acc = new BenchmarkStreamTextAccumulator();
  col.unsubscribe = subscribeToCompareStream(sessionId!, side, {
    signal,
    onChunk: (chunk) => {
      acc.ingestChunk(chunk);
      col.text = acc.getText();
      col.status = 'streaming';
      renderColumn(side, col);
    },
    onEnd: (event) => {
      if (event?.status === 'error') {
        col.status = 'error';
        col.error = event.errorMessage ?? 'Generation failed';
      } else if (event?.status === 'cancelled') {
        col.status = 'cancelled';
      } else {
        col.status = 'complete';
      }
      renderColumn(side, col);
      updateVoteBar();
    },
    onTransportError: (err) => {
      col.status = 'error';
      col.error = err instanceof Error ? err.message : String(err);
      renderColumn(side, col);
      updateVoteBar();
    },
  });
}

async function startCompareRun(): Promise<void> {
  const prompt = el<HTMLTextAreaElement>('comparePrompt')?.value.trim() ?? '';
  const leftProvider = el<HTMLSelectElement>('compareLeftProvider')?.value ?? '';
  const leftModel = el<HTMLSelectElement>('compareLeftModel')?.value ?? '';
  const rightProvider = el<HTMLSelectElement>('compareRightProvider')?.value ?? '';
  const rightModel = el<HTMLSelectElement>('compareRightModel')?.value ?? '';

  if (!prompt || !leftProvider || !leftModel || !rightProvider || !rightModel) {
    setStatus('Select two models and enter a prompt.');
    return;
  }

  resetRunUi();
  const runBtn = el<HTMLButtonElement>('btnCompareRun');
  if (runBtn) runBtn.disabled = true;

  try {
    const res = await fetch('/api/compare/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        left: { providerId: leftProvider, modelId: leftModel },
        right: { providerId: rightProvider, modelId: rightModel },
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Start failed (${res.status})`);
    }
    const payload = (await res.json()) as CompareStartResponse;
    sessionId = payload.sessionId;
    runAbort = new AbortController();

    leftColumn = {
      label: payload.left.label,
      generationId: payload.left.generationId,
      text: '',
      status: 'streaming',
      unsubscribe: null,
    };
    rightColumn = {
      label: payload.right.label,
      generationId: payload.right.generationId,
      text: '',
      status: 'streaming',
      unsubscribe: null,
    };
    renderColumn('left', leftColumn);
    renderColumn('right', rightColumn);

    startColumnStream('left', leftColumn, runAbort.signal);
    startColumnStream('right', rightColumn, runAbort.signal);
    updateVoteBar();
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    if (runBtn) runBtn.disabled = false;
  }
}

async function stopCompareRun(): Promise<void> {
  const ids = [leftColumn?.generationId, rightColumn?.generationId].filter(Boolean) as string[];
  runAbort?.abort();
  for (const id of ids) {
    try {
      await cancelGeneration(id);
    } catch {
      /* ignore */
    }
  }
  if (leftColumn && leftColumn.status === 'streaming') leftColumn.status = 'cancelled';
  if (rightColumn && rightColumn.status === 'streaming') rightColumn.status = 'cancelled';
  renderColumn('left', leftColumn);
  renderColumn('right', rightColumn);
  updateVoteBar();
  const runBtn = el<HTMLButtonElement>('btnCompareRun');
  if (runBtn) runBtn.disabled = false;
}

async function handleVote(winner: CompareWinner): Promise<void> {
  if (!sessionId || revealed) return;
  try {
    const reveal = await submitCompareVote(sessionId, winner);
    revealed = true;
    showReveal(reveal.left, reveal.right);
    setVoteEnabled(false);
    const prompt = el<HTMLTextAreaElement>('comparePrompt')?.value.trim() ?? '';
    await cacheVoteAfterReveal(sessionId, prompt, reveal);
    await refreshHistory();
    const runBtn = el<HTMLButtonElement>('btnCompareRun');
    if (runBtn) runBtn.disabled = false;
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  }
}

async function cacheVoteAfterReveal(
  id: string,
  prompt: string,
  reveal: Awaited<ReturnType<typeof submitCompareVote>>,
): Promise<void> {
  const { cacheCompareVote } = await import('../compare/persistence');
  const vote: CompareVote = {
    id,
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    prompt,
    ...reveal,
  };
  await cacheCompareVote(vote);
}

function renderHistory(votes: CompareVote[]): void {
  const list = el('compareHistoryList');
  const winRates = el('compareWinRates');
  if (!list || !winRates) return;

  list.replaceChildren();
  if (votes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'compare-history-empty';
    empty.textContent = 'No votes yet — run a comparison and pick a winner.';
    list.appendChild(empty);
  } else {
    for (const vote of votes) {
      const row = document.createElement('article');
      row.className = 'compare-history-row';
      const winnerLabel =
        vote.winner === 'tie'
          ? 'Tie'
          : vote.winner === 'both_bad'
            ? 'Both bad'
            : vote.winner === 'left'
              ? `Left (${vote.assignment.leftAlias})`
              : `Right (${vote.assignment.rightAlias})`;
      row.innerHTML = `
        <div class="compare-history-prompt">${escapeHtml(vote.prompt.slice(0, 120))}</div>
        <div class="compare-history-meta">
          <span>${escapeHtml(winnerLabel)}</span>
          <span>${escapeHtml(formatModelRef(vote.left.providerId, vote.left.modelId))}</span>
          <span>vs</span>
          <span>${escapeHtml(formatModelRef(vote.right.providerId, vote.right.modelId))}</span>
        </div>`;
      list.appendChild(row);
    }
  }

  const rates = aggregateWinRates(votes);
  winRates.replaceChildren();
  if (rates.length === 0) {
    winRates.textContent = 'Win rates appear after your first vote.';
    return;
  }
  for (const row of rates.slice(0, 8)) {
    const line = document.createElement('div');
    line.className = 'compare-win-rate-row';
    const pct = Math.round(row.winRate * 100);
    line.textContent = `${formatModelRef(row.providerId, row.modelId)} — ${pct}% wins (${row.wins}W / ${row.losses}L / ${row.ties}T)`;
    winRates.appendChild(line);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function refreshHistory(): Promise<void> {
  const votes = await listCompareHistory();
  renderHistory(votes);
}

function setStatus(message: string): void {
  const status = el('compareStatus');
  if (status) status.textContent = message;
}

function wireControls(): void {
  el('btnCompareRun')?.addEventListener('click', () => void startCompareRun());
  el('btnCompareStop')?.addEventListener('click', () => void stopCompareRun());
  el('btnCompareVoteLeft')?.addEventListener('click', () => void handleVote('left'));
  el('btnCompareVoteRight')?.addEventListener('click', () => void handleVote('right'));
  el('btnCompareVoteTie')?.addEventListener('click', () => void handleVote('tie'));
  el('btnCompareVoteBothBad')?.addEventListener('click', () => void handleVote('both_bad'));
}

export function initComparePage(): void {
  if (initialized) return;
  initialized = true;
  wireControls();
  void refreshModelPickers();
  void refreshHistory();
  window.addEventListener('hashchange', onHashChange);
  if (
    window.location.hash === '#/compare' ||
    window.location.hash.startsWith('#/app/compare')
  ) {
    openCompare();
  }
}

export function openCompare(): void {
  const root = getRoot();
  const shell = getShell();
  if (!root || !shell) return;

  void import('./benchmark-page').then((m) => {
    const bench = document.getElementById('benchmarkView');
    if (bench?.classList.contains('is-open')) m.closeBenchmark({ skipNavigate: true });
  });
  void import('./experts/experts-hub').then((m) => {
    if (m.isExpertsPageOpen()) m.closeExpertsHub({ skipNavigate: true });
  });
  void import('../research/panel').then((m) => {
    if (m.isResearchPageOpen()) m.closeResearch({ skipNavigate: true });
  });

  root.classList.add('is-open');
  if (!isOsShellEnabled()) {
    shell.classList.add('hidden');
    window.location.hash = '#/compare';
  }
  void refreshModelPickers();
  void refreshHistory();
}

export function closeCompare(options?: { skipNavigate?: boolean }): void {
  const root = getRoot();
  const shell = getShell();
  if (!root || !shell) return;
  resetRunUi();
  root.classList.remove('is-open');
  if (!isOsShellEnabled()) {
    shell.classList.remove('hidden');
    if (!options?.skipNavigate && window.location.hash.startsWith('#/compare')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    navigateToDesktop();
  }
}

export function isComparePageOpen(): boolean {
  return getRoot()?.classList.contains('is-open') ?? false;
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash === '#/compare' || hash.startsWith('#/app/compare')) {
    openCompare();
    return;
  }
  if (isOsShellEnabled() && isOsAppHash(hash)) return;
  if (isComparePageOpen()) {
    closeCompare();
  }
}

export function openCompareFromTopbar(): void {
  if (isOsShellEnabled()) {
    void import('../os/router').then((m) => m.launchApp('compare'));
    return;
  }
  openCompare();
}
