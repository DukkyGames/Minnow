/**
 * Blind model compare — multi-column streaming, vote, reveal, history.
 */

import '../styles/compare.css';
import '../styles/settings-controls.css';

import { humanizeModelSlug, slugFromModelId } from '../lib/format-model-label';
import { isOsAppHash, isOsEmbedded } from '../os/page-bridge';
import { requestCloseWindowApp, registerWindowTeardown } from '../os/window-mounted-apps';
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
import {
  COMPARE_MAX_SLOTS,
  COMPARE_MIN_SLOTS,
} from '../compare/types';
import { aggregateWinRates, formatCompareWinnerLabel, voteSlotRefs } from '../compare/win-rates';
import { cancelGeneration } from '../api/generations';
import { ASSISTANT_RENDER_DEBOUNCE_MS } from '../constants';
import { setAssistantBubbleContent } from '../markdown/renderer';
import { fillModelSelect, fillProviderSelect } from './settings-model-binding';
import {
  mountAuxiliaryModelSelectCombobox,
  syncAuxiliaryModelSelectCombobox,
} from './model-select-picker';

const PARALLEL_PREF_KEY = 'minnow.compare.parallel';

interface PickerSlot {
  id: number;
}

interface ColumnState {
  screenIndex: number;
  label: CompareAlias;
  generationId: string;
  text: string;
  status: 'idle' | 'streaming' | 'complete' | 'error' | 'cancelled' | 'waiting';
  error?: string;
  unsubscribe: (() => void) | null;
}

let sessionId: string | null = null;
let revealed = false;
/** Revealed slot models after voting — used for chat handoff model binding. */
let lastRevealSlots: { providerId: string; modelId: string }[] = [];
let runParallel = readParallelPref();
let pickerSlots: PickerSlot[] = [{ id: 0 }, { id: 1 }];
let nextPickerId = 2;
let columns: ColumnState[] = [];
let runAbort: AbortController | null = null;
let initialized = false;

/** Per-column debounce timers keyed by screen index. */
const columnRenderTimers = new Map<number, ReturnType<typeof setTimeout>>();
const columnStreamCursors = new Map<number, HTMLDivElement>();

function readParallelPref(): boolean {
  try {
    return localStorage.getItem(PARALLEL_PREF_KEY) !== '0';
  } catch {
    return true;
  }
}

function writeParallelPref(parallel: boolean): void {
  try {
    localStorage.setItem(PARALLEL_PREF_KEY, parallel ? '1' : '0');
  } catch {
    /* ignore */
  }
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

function ensureColumnStreamCursor(screenIndex: number): HTMLDivElement {
  let cursor = columnStreamCursors.get(screenIndex);
  if (!cursor) {
    cursor = document.createElement('div');
    cursor.className = 'cursor cursor--prose';
    cursor.setAttribute('aria-hidden', 'true');
    columnStreamCursors.set(screenIndex, cursor);
  }
  return cursor;
}

function cancelColumnRenderDebounce(screenIndex: number): void {
  const timer = columnRenderTimers.get(screenIndex);
  if (timer != null) {
    clearTimeout(timer);
    columnRenderTimers.delete(screenIndex);
  }
}

function cancelAllColumnRenderDebounces(): void {
  for (const screenIndex of columnRenderTimers.keys()) {
    cancelColumnRenderDebounce(screenIndex);
  }
}

function renderColumnBodyMarkdown(
  screenIndex: number,
  body: HTMLElement,
  markdown: string,
  streaming: boolean,
): void {
  body.classList.add('msg-bubble');
  if (streaming) {
    const cursor = ensureColumnStreamCursor(screenIndex);
    cancelColumnRenderDebounce(screenIndex);
    columnRenderTimers.set(
      screenIndex,
      setTimeout(() => {
        columnRenderTimers.delete(screenIndex);
        setAssistantBubbleContent(body, markdown, { streaming: true, streamCursor: cursor });
      }, ASSISTANT_RENDER_DEBOUNCE_MS),
    );
    return;
  }
  cancelColumnRenderDebounce(screenIndex);
  setAssistantBubbleContent(body, markdown, { streaming: false });
}

function clearColumnBody(screenIndex: number, body: HTMLElement): void {
  cancelColumnRenderDebounce(screenIndex);
  body.innerHTML = '';
  body.classList.remove('msg-bubble', 'msg-bubble--md');
}

function pickerProviderId(slotId: number): string {
  return `comparePicker${slotId}Provider`;
}

function pickerModelId(slotId: number): string {
  return `comparePicker${slotId}Model`;
}

function readPickerSelections(): {
  providerId: string;
  modelId: string;
}[] {
  return pickerSlots.map((slot) => ({
    providerId: el<HTMLSelectElement>(pickerProviderId(slot.id))?.value ?? '',
    modelId: el<HTMLSelectElement>(pickerModelId(slot.id))?.value ?? '',
  }));
}

function buildPickerRow(slot: PickerSlot, index: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'compare-picker';
  row.dataset.pickerId = String(slot.id);

  const hdr = document.createElement('div');
  hdr.className = 'compare-picker-hdr';
  const title = document.createElement('label');
  title.textContent = `Model ${index + 1}`;
  title.setAttribute('for', pickerProviderId(slot.id));
  hdr.appendChild(title);

  if (pickerSlots.length > COMPARE_MIN_SLOTS) {
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'compare-picker-remove';
    removeBtn.textContent = 'Remove';
    removeBtn.setAttribute('aria-label', `Remove model ${index + 1}`);
    removeBtn.addEventListener('click', () => removePickerSlot(slot.id));
    hdr.appendChild(removeBtn);
  }

  const providerLabel = document.createElement('label');
  providerLabel.setAttribute('for', pickerProviderId(slot.id));
  providerLabel.textContent = 'Provider';

  const provider = document.createElement('select');
  provider.id = pickerProviderId(slot.id);
  provider.className = 'settings-select';
  provider.setAttribute('aria-label', `Model ${index + 1} provider`);

  const modelLabel = document.createElement('label');
  modelLabel.setAttribute('for', pickerModelId(slot.id));
  modelLabel.textContent = 'Model';

  const model = document.createElement('select');
  model.id = pickerModelId(slot.id);
  model.setAttribute('aria-label', `Model ${index + 1}`);

  row.append(hdr, providerLabel, provider, modelLabel, model);
  return row;
}

function renderPickerGrid(): void {
  const host = el('comparePickers');
  if (!host) return;
  host.replaceChildren();
  pickerSlots.forEach((slot, index) => {
    host.appendChild(buildPickerRow(slot, index));
  });

  const addBtn = el<HTMLButtonElement>('btnCompareAddModel');
  if (addBtn) {
    addBtn.disabled = pickerSlots.length >= COMPARE_MAX_SLOTS;
  }
}

function addPickerSlot(): void {
  if (pickerSlots.length >= COMPARE_MAX_SLOTS) return;
  pickerSlots.push({ id: nextPickerId });
  nextPickerId += 1;
  renderPickerGrid();
  void refreshModelPickers();
}

function removePickerSlot(slotId: number): void {
  if (pickerSlots.length <= COMPARE_MIN_SLOTS) return;
  pickerSlots = pickerSlots.filter((slot) => slot.id !== slotId);
  renderPickerGrid();
  void refreshModelPickers();
}

async function wirePickerRow(provider: HTMLSelectElement, model: HTMLSelectElement): Promise<void> {
  mountAuxiliaryModelSelectCombobox(model);
  const refresh = async () => {
    await fillModelSelect(model, provider.value, model.value, {
      includeEmptyOption: false,
    });
    syncAuxiliaryModelSelectCombobox(model);
  };
  provider.onchange = () => void refresh();
  await refresh();
}

async function refreshModelPickers(): Promise<void> {
  renderPickerGrid();
  for (const slot of pickerSlots) {
    const provider = el<HTMLSelectElement>(pickerProviderId(slot.id));
    const model = el<HTMLSelectElement>(pickerModelId(slot.id));
    if (!provider || !model) continue;
    await fillProviderSelect(provider, provider.value, { includeEmptyOption: false });
    await wirePickerRow(provider, model);
  }
}

function buildColumnShell(screenIndex: number): HTMLElement {
  const pane = document.createElement('section');
  pane.className = 'compare-column';
  pane.dataset.screenIndex = String(screenIndex);
  pane.setAttribute('aria-label', `Response column ${screenIndex + 1}`);

  const hdr = document.createElement('div');
  hdr.className = 'compare-column-hdr';

  const label = document.createElement('span');
  label.className = 'compare-column-label';
  label.id = `compareColumnLabel${screenIndex}`;

  const status = document.createElement('span');
  status.className = 'compare-column-status';
  status.id = `compareColumnStatus${screenIndex}`;

  hdr.append(label, status);

  const body = document.createElement('div');
  body.className = 'compare-column-body';
  body.id = `compareColumnBody${screenIndex}`;

  const reveal = document.createElement('div');
  reveal.className = 'compare-column-reveal';
  reveal.id = `compareColumnReveal${screenIndex}`;
  reveal.setAttribute('aria-live', 'polite');

  const actions = document.createElement('div');
  actions.className = 'compare-column-actions';
  actions.id = `compareColumnActions${screenIndex}`;

  pane.append(hdr, body, reveal, actions);
  return pane;
}

function renderColumnGrid(slotCount: number): void {
  const host = el('compareColumns');
  if (!host) return;
  host.replaceChildren();
  for (let i = 0; i < slotCount; i += 1) {
    host.appendChild(buildColumnShell(i));
  }
}

function resetColumnByIndex(screenIndex: number): void {
  const label = el(`compareColumnLabel${screenIndex}`);
  const body = el(`compareColumnBody${screenIndex}`);
  const status = el(`compareColumnStatus${screenIndex}`);
  const reveal = el(`compareColumnReveal${screenIndex}`);
  const actions = el(`compareColumnActions${screenIndex}`);
  const pane = document.querySelector(
    `.compare-column[data-screen-index="${screenIndex}"]`,
  );
  if (label) label.textContent = '—';
  if (body) clearColumnBody(screenIndex, body);
  if (status) status.textContent = 'Waiting…';
  if (reveal) reveal.textContent = '';
  if (actions) actions.replaceChildren();
  pane?.classList.remove('is-dimmed');
}

function renderColumn(col: ColumnState): void {
  const label = el(`compareColumnLabel${col.screenIndex}`);
  const body = el(`compareColumnBody${col.screenIndex}`);
  const status = el(`compareColumnStatus${col.screenIndex}`);
  if (!label || !body || !status) return;

  label.textContent = col.label;
  const streaming = col.status === 'streaming';
  renderColumnBodyMarkdown(col.screenIndex, body, col.text, streaming);

  if (col.status === 'streaming') {
    status.textContent = 'Streaming…';
  } else if (col.status === 'complete') {
    status.textContent = 'Complete';
  } else if (col.status === 'error') {
    status.textContent = col.error ?? 'Error';
  } else if (col.status === 'cancelled') {
    status.textContent = 'Stopped';
  } else if (col.status === 'waiting') {
    status.textContent = 'Queued…';
  } else {
    status.textContent = 'Waiting…';
  }
}

function formatModelRef(providerId: string, modelId: string): string {
  const slug = slugFromModelId(modelId);
  const name = humanizeModelSlug(slug);
  return `${name} (${providerId})`;
}

function showReveal(slots: { providerId: string; modelId: string }[]): void {
  slots.forEach((slot, index) => {
    const reveal = el(`compareColumnReveal${index}`);
    if (reveal) {
      reveal.textContent =
        slot.providerId && slot.modelId
          ? formatModelRef(slot.providerId, slot.modelId)
          : '';
    }
  });
}

function allColumnsSettled(): boolean {
  if (columns.length === 0) return false;
  return columns.every(
    (col) =>
      col.status === 'complete' ||
      col.status === 'error' ||
      col.status === 'cancelled',
  );
}

function renderColumnContinueButtons(): void {
  const models = revealed ? lastRevealSlots : readPickerSelections();
  const handoffReady = allColumnsSettled();

  for (const col of columns) {
    const host = el(`compareColumnActions${col.screenIndex}`);
    if (!host) continue;
    host.replaceChildren();

    const model = models[col.screenIndex];
    const canContinue =
      handoffReady &&
      col.status === 'complete' &&
      col.text.trim() &&
      Boolean(model?.providerId && model?.modelId);

    if (!canContinue) continue;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'compare-continue-chat';
    btn.textContent = 'Continue in chat';
    btn.setAttribute('aria-label', `Continue response ${col.label} in chat`);
    btn.addEventListener('click', () => void handleContinueInChat(col.screenIndex));
    host.appendChild(btn);
  }
}

async function handleContinueInChat(screenIndex: number): Promise<void> {
  const prompt = el<HTMLTextAreaElement>('comparePrompt')?.value.trim() ?? '';
  if (!prompt) {
    setStatus('Enter a prompt before continuing in chat.');
    return;
  }

  const models = revealed ? lastRevealSlots : readPickerSelections();
  const handoffColumns = columns.map((col, index) => ({
    label: col.label,
    text: col.text,
    providerId: models[index]?.providerId ?? '',
    modelId: models[index]?.modelId ?? '',
  }));

  try {
    const { continueCompareInChat } = await import('../compare/continue-in-chat');
    await continueCompareInChat({
      prompt,
      columns: handoffColumns,
      selectedIndex: screenIndex,
    });
    setStatus('');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  }
}

function renderVoteBar(): void {
  const bar = el('compareVoteBar');
  if (!bar) return;
  bar.replaceChildren();

  const enabled = !revealed && allColumnsSettled() && Boolean(sessionId);
  for (const col of columns) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.disabled = !enabled;
    btn.textContent = `${col.label} wins`;
    btn.addEventListener('click', () => void handleVote(col.screenIndex));
    bar.appendChild(btn);
  }

  const tieBtn = document.createElement('button');
  tieBtn.type = 'button';
  tieBtn.disabled = !enabled;
  tieBtn.textContent = 'Tie';
  tieBtn.addEventListener('click', () => void handleVote('tie'));
  bar.appendChild(tieBtn);

  const bothBadBtn = document.createElement('button');
  bothBadBtn.type = 'button';
  bothBadBtn.disabled = !enabled;
  bothBadBtn.textContent = columns.length > 2 ? 'All bad' : 'Both bad';
  bothBadBtn.addEventListener('click', () => void handleVote('both_bad'));
  bar.appendChild(bothBadBtn);
  renderColumnContinueButtons();
}

function updateParallelToggleUi(): void {
  const toggle = el<HTMLButtonElement>('btnCompareParallelToggle');
  if (!toggle) return;
  toggle.classList.toggle('is-active', runParallel);
  toggle.textContent = runParallel ? 'Parallel' : 'Sequential';
  toggle.title = runParallel
    ? 'All models run at once — click for one at a time'
    : 'One model at a time — click to run in parallel';
}

function setSequentialFocus(activeIndex: number | null): void {
  document.querySelectorAll('.compare-column').forEach((pane) => {
    const idx = Number((pane as HTMLElement).dataset.screenIndex);
    pane.classList.toggle('is-dimmed', activeIndex !== null && idx !== activeIndex);
  });
}

function resetRunUi(): void {
  cancelAllColumnRenderDebounces();
  for (const col of columns) {
    col.unsubscribe?.();
  }
  runAbort?.abort();
  runAbort = null;
  sessionId = null;
  revealed = false;
  lastRevealSlots = [];
  columns = [];
  renderColumnGrid(pickerSlots.length);
  for (let i = 0; i < pickerSlots.length; i += 1) {
    resetColumnByIndex(i);
  }
  showReveal([]);
  renderVoteBar();
  setSequentialFocus(null);
  const runBtn = el<HTMLButtonElement>('btnCompareRun');
  if (runBtn) runBtn.disabled = false;
}

function waitForColumnSettled(col: ColumnState, signal: AbortSignal): Promise<void> {
  if (
    col.status === 'complete' ||
    col.status === 'error' ||
    col.status === 'cancelled'
  ) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const timer = window.setInterval(() => {
      if (signal.aborted) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (
        col.status === 'complete' ||
        col.status === 'error' ||
        col.status === 'cancelled'
      ) {
        clearInterval(timer);
        resolve();
      }
    }, 120);
    signal.addEventListener(
      'abort',
      () => {
        clearInterval(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function startColumnStream(col: ColumnState, signal: AbortSignal): void {
  const acc = new BenchmarkStreamTextAccumulator();
  col.unsubscribe = subscribeToCompareStream(sessionId!, col.screenIndex, {
    signal,
    onChunk: (chunk) => {
      acc.ingestChunk(chunk);
      col.text = acc.getText();
      col.status = 'streaming';
      renderColumn(col);
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
      renderColumn(col);
      renderVoteBar();
    },
    onTransportError: (err) => {
      col.status = 'error';
      col.error = err instanceof Error ? err.message : String(err);
      renderColumn(col);
      renderVoteBar();
    },
  });
}

async function activateCompareSlot(
  id: string,
  screenIndex: number,
): Promise<{ generationId: string; label: CompareAlias }> {
  const res = await fetch(
    `/api/compare/${encodeURIComponent(id)}/activate-slot/${screenIndex}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Activate slot failed (${res.status})`);
  }
  return (await res.json()) as { generationId: string; label: CompareAlias };
}

async function runSequentialStreams(signal: AbortSignal): Promise<void> {
  for (let i = 0; i < columns.length; i += 1) {
    if (signal.aborted) return;
    const col = columns[i];
    setSequentialFocus(col.screenIndex);

    if (!col.generationId && sessionId) {
      col.status = 'waiting';
      renderColumn(col);
      try {
        const activated = await activateCompareSlot(sessionId, col.screenIndex);
        col.generationId = activated.generationId;
        col.label = activated.label;
        renderColumn(col);
      } catch (err) {
        col.status = 'error';
        col.error = err instanceof Error ? err.message : String(err);
        renderColumn(col);
        renderVoteBar();
        continue;
      }
    }

    col.status = 'streaming';
    renderColumn(col);
    startColumnStream(col, signal);
    await waitForColumnSettled(col, signal);
  }
  setSequentialFocus(null);
  renderVoteBar();
}

async function startCompareRun(): Promise<void> {
  const prompt = el<HTMLTextAreaElement>('comparePrompt')?.value.trim() ?? '';
  const models = readPickerSelections();

  if (!prompt || models.some((row) => !row.providerId || !row.modelId)) {
    setStatus('Select every model and enter a prompt.');
    return;
  }

  resetRunUi();
  renderColumnGrid(models.length);
  const runBtn = el<HTMLButtonElement>('btnCompareRun');
  if (runBtn) runBtn.disabled = true;

  try {
    const res = await fetch('/api/compare/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        models,
        parallel: runParallel,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(err || `Start failed (${res.status})`);
    }
    const payload = (await res.json()) as CompareStartResponse;
    sessionId = payload.sessionId;
    runAbort = new AbortController();

    columns = payload.slots.map((slot, screenIndex) => ({
      screenIndex,
      label: slot.label,
      generationId: slot.generationId,
      text: '',
      status: slot.generationId ? 'streaming' : 'waiting',
      unsubscribe: null,
    }));

    for (const col of columns) {
      renderColumn(col);
    }
    renderVoteBar();

    if (runParallel) {
      for (const col of columns) {
        startColumnStream(col, runAbort.signal);
      }
    } else {
      await runSequentialStreams(runAbort.signal);
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
    if (runBtn) runBtn.disabled = false;
  }
}

async function stopCompareRun(): Promise<void> {
  const ids = columns.map((col) => col.generationId).filter(Boolean);
  runAbort?.abort();
  for (const id of ids) {
    try {
      await cancelGeneration(id);
    } catch {
      /* ignore */
    }
  }
  for (const col of columns) {
    if (col.status === 'streaming' || col.status === 'waiting') {
      col.status = 'cancelled';
    }
  }
  for (const col of columns) {
    renderColumn(col);
  }
  setSequentialFocus(null);
  renderVoteBar();
  const runBtn = el<HTMLButtonElement>('btnCompareRun');
  if (runBtn) runBtn.disabled = false;
}

async function handleVote(winner: CompareWinner): Promise<void> {
  if (!sessionId || revealed) return;
  try {
    const reveal = await submitCompareVote(sessionId, winner);
    revealed = true;
    lastRevealSlots = reveal.slots.map((slot) => ({
      providerId: slot.providerId,
      modelId: slot.modelId,
    }));
    showReveal(reveal.slots);
    renderVoteBar();
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
    slots: reveal.slots,
    winner: reveal.winner,
    revealed: reveal.revealed,
    left: reveal.left,
    right: reveal.right,
    assignment: reveal.assignment,
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
      const refs = voteSlotRefs(vote);
      const row = document.createElement('article');
      row.className = 'compare-history-row';
      row.innerHTML = `
        <div class="compare-history-prompt">${escapeHtml(vote.prompt.slice(0, 120))}</div>
        <div class="compare-history-meta">
          <span>${escapeHtml(formatCompareWinnerLabel(vote))}</span>
          ${refs
            .map((ref) => `<span>${escapeHtml(formatModelRef(ref.providerId, ref.modelId))}</span>`)
            .join('<span>vs</span>')}
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

function toggleParallelMode(): void {
  runParallel = !runParallel;
  writeParallelPref(runParallel);
  updateParallelToggleUi();
}

function wireControls(): void {
  el('btnCompareRun')?.addEventListener('click', () => void startCompareRun());
  el('btnCompareStop')?.addEventListener('click', () => void stopCompareRun());
  el('btnCompareAddModel')?.addEventListener('click', () => addPickerSlot());
  el('btnCompareParallelToggle')?.addEventListener('click', () => toggleParallelMode());
}

export function initComparePage(): void {
  if (initialized) return;
  initialized = true;
  registerWindowTeardown('compare', () => closeCompare({ skipNavigate: true }));
  wireControls();
  renderPickerGrid();
  renderColumnGrid(pickerSlots.length);
  updateParallelToggleUi();
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
  if (!isOsEmbedded()) {
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
  if (!isOsEmbedded()) {
    shell.classList.remove('hidden');
    if (!options?.skipNavigate && window.location.hash.startsWith('#/compare')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    if (!requestCloseWindowApp('compare')) {
      navigateToDesktop();
    }
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
  if (isOsEmbedded() && isOsAppHash(hash)) return;
  if (isComparePageOpen()) {
    closeCompare();
  }
}

export function openCompareFromTopbar(): void {
  if (isOsEmbedded()) {
    void import('../os/router').then((m) => m.launchApp('compare'));
    return;
  }
  openCompare();
}
