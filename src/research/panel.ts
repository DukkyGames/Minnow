/**
 * Deep Research full-page panel (#/research) — query, run, synapse, result, library.
 */

import '../styles/research-page.css';

import { decodeModelSelectKey } from '../lib/model-select-key';
import { getActiveModelIdFromDom } from '../benchmark/resolve-binding';
import { loadResearchConfig } from '../config/research-config';
import {
  cancelResearch,
  fetchResearchResult,
  researchReportUrl,
  startResearch,
  subscribeToResearchStream,
} from './client';
import { renderResearchLibrary } from './library';
import { ResearchSynapse } from './synapse';
import type { ResearchCategory, ResearchStartRequest } from './types';
import { closeBenchmark } from '../ui/benchmark-page';
import { closeGlobalBugs } from '../ui/global-bugs-page';
import { renderChatFromHistory } from '../ui/messages';
import { closeSettings } from '../ui/settings-page';
import { renderSidebar } from '../ui/sidebar';
import { setStatus } from '../ui/status';
import {
  createAndActivateChat,
  getActiveChat,
  scheduleSaveSessions,
} from '../state/sessions';

type ResearchPanelTab = 'run' | 'library';

let synapse: ResearchSynapse | null = null;
let streamUnsubscribe: (() => void) | null = null;
let runAbort: AbortController | null = null;
let activeResearchId: string | null = null;
let running = false;
let currentTab: ResearchPanelTab = 'run';

function getRoot(): HTMLElement | null {
  return document.getElementById('researchView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Open visual report in Electron preview or a new browser tab. */
export function openResearchReport(researchId: string): void {
  const path = researchReportUrl(researchId);
  const url =
    path.startsWith('/') && !path.startsWith('//')
      ? `${window.location.origin}${path}`
      : path;
  void import('../ui/preview-panel').then((m) => {
    if (typeof window.minnow?.preview !== 'undefined') {
      void m.openUrlInPreviewPanel(url);
      return;
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  });
}

function setRunningState(isRunning: boolean): void {
  running = isRunning;
  const root = getRoot();
  root?.classList.toggle('is-running', isRunning);
  const startBtn = document.getElementById('btnResearchStart') as HTMLButtonElement | null;
  const cancelBtn = document.getElementById('btnResearchCancel') as HTMLButtonElement | null;
  const queryInput = document.getElementById('researchQuery') as HTMLTextAreaElement | null;
  if (startBtn) {
    startBtn.disabled = isRunning;
    startBtn.textContent = isRunning ? 'Running…' : 'Start research';
  }
  if (cancelBtn) {
    cancelBtn.hidden = !isRunning;
    cancelBtn.disabled = !isRunning;
  }
  if (queryInput) queryInput.disabled = isRunning;
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    '#researchView .research-run-options input, #researchView .research-run-options select',
  )) {
    el.disabled = isRunning;
  }
}

function getSynapseMount(): HTMLElement | null {
  return document.getElementById('researchSynapseMount');
}

function getResultMount(): HTMLElement | null {
  return document.getElementById('researchResultMount');
}

function setPanelTab(tab: ResearchPanelTab): void {
  currentTab = tab;
  document.getElementById('researchTabRun')?.setAttribute('aria-selected', tab === 'run' ? 'true' : 'false');
  document
    .getElementById('researchTabLibrary')
    ?.setAttribute('aria-selected', tab === 'library' ? 'true' : 'false');
  document.getElementById('researchPanelRun')?.classList.toggle('hidden', tab !== 'run');
  document.getElementById('researchPanelLibrary')?.classList.toggle('hidden', tab !== 'library');
  if (tab === 'library') {
    void refreshLibraryPanel();
  }
}

async function refreshLibraryPanel(): Promise<void> {
  const mount = document.getElementById('researchLibraryMount');
  if (!mount) return;
  await renderResearchLibrary({
    mount,
    onOpenDetail: (id) => {
      setPanelTab('run');
      void showResultForId(id);
    },
    onOpenReport: openResearchReport,
    onDiscuss: (id) => {
      void discussResearchReport(id);
    },
    onRefine: (id, query) => {
      setPanelTab('run');
      const queryInput = document.getElementById('researchQuery') as HTMLTextAreaElement | null;
      if (queryInput && query.trim()) queryInput.value = query;
      void startResearchRun({ continueFrom: id });
    },
  });
}

async function resolveResearchBinding(): Promise<{ providerId: string; model: string }> {
  const config = await loadResearchConfig();
  const overrideProvider = (
    document.getElementById('researchProviderOverride') as HTMLSelectElement | null
  )?.value?.trim();
  const overrideModel = (
    document.getElementById('researchModelOverride') as HTMLInputElement | null
  )?.value?.trim();

  if (overrideProvider && overrideModel) {
    return { providerId: overrideProvider, model: overrideModel };
  }

  const fromConfig = config.model;
  if (fromConfig.providerId?.trim() && fromConfig.model?.trim()) {
    return {
      providerId: fromConfig.providerId.trim(),
      model: fromConfig.model.trim(),
    };
  }

  const raw = getActiveModelIdFromDom();
  const parsed = decodeModelSelectKey(raw);
  const model = parsed?.modelId ?? raw;
  const providerId = parsed?.providerId ?? getActiveChat().providerId?.trim() ?? '';
  return { providerId, model };
}

function readStartOptions(): Omit<ResearchStartRequest, 'query' | 'continueFrom'> {
  const maxRoundsRaw = (
    document.getElementById('researchMaxRounds') as HTMLSelectElement | null
  )?.value;
  const maxRounds = maxRoundsRaw === 'auto' ? 0 : Number(maxRoundsRaw);
  const category = (
    (document.getElementById('researchCategory') as HTMLSelectElement | null)?.value ?? ''
  ) as ResearchCategory;
  const searchProvider = (
    document.getElementById('researchSearchProvider') as HTMLSelectElement | null
  )?.value?.trim();
  return {
    maxRounds: Number.isFinite(maxRounds) ? maxRounds : 0,
    category,
    ...(searchProvider ? { searchProvider } : {}),
  };
}

function teardownStream(): void {
  streamUnsubscribe?.();
  streamUnsubscribe = null;
  runAbort?.abort();
  runAbort = null;
}

async function showResultForId(researchId: string): Promise<void> {
  const mount = getResultMount();
  if (!mount) return;
  mount.innerHTML = '<p class="research-result-loading">Loading result…</p>';
  try {
    const data = await fetchResearchResult(researchId);
    renderResult(mount, researchId, data.result, data.sources ?? [], data.category);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not load result';
    mount.innerHTML = `<p class="research-result-error">${escapeHtml(msg)}</p>`;
  }
}

function renderResult(
  mount: HTMLElement,
  researchId: string,
  markdown: string,
  sources: { url: string; title?: string }[],
  category?: string,
): void {
  const summary = markdown.trim().slice(0, 1200);
  const sourcesHtml = sources.length
    ? `<ul class="research-sources">${sources
        .slice(0, 24)
        .map(
          (s) =>
            `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(s.title?.trim() || s.url)}</a></li>`,
        )
        .join('')}</ul>`
    : '<p class="research-sources-empty">No sources recorded.</p>';

  mount.innerHTML = `
    <section class="research-result" aria-label="Research result">
      ${category ? `<p class="research-result-cat">${escapeHtml(category)}</p>` : ''}
      <div class="research-result-body">${escapeHtml(summary)}${markdown.length > summary.length ? '…' : ''}</div>
      <h3 class="research-result-sources-title">Sources</h3>
      ${sourcesHtml}
      <div class="research-result-actions">
        <button type="button" class="research-btn research-btn--primary" id="btnResearchOpenReport">Open visual report</button>
        <button type="button" class="research-btn" id="btnResearchDiscuss">Discuss</button>
        <button type="button" class="research-btn" id="btnResearchRefine">Refine</button>
      </div>
    </section>
  `;

  document.getElementById('btnResearchOpenReport')?.addEventListener('click', () => {
    openResearchReport(researchId);
  });
  document.getElementById('btnResearchDiscuss')?.addEventListener('click', () => {
    void discussResearchReport(researchId);
  });
  document.getElementById('btnResearchRefine')?.addEventListener('click', () => {
    void startResearchRun({ continueFrom: researchId });
  });
}

/** Client spinoff: new chat seeded with the report (user message; history has no system role). */
export async function discussResearchReport(researchId: string): Promise<void> {
  try {
    const data = await fetchResearchResult(researchId);
    const binding = await resolveResearchBinding();
    const modelKey = binding.model;
    const chat = createAndActivateChat(modelKey);
    if (binding.providerId) {
      chat.providerId = binding.providerId;
    }
    const report = data.result?.trim() ?? '';
    const spinoffBody =
      'The following is a Deep Research report. Use it as context when answering my questions.\n\n' +
      report;
    chat.history.push({ role: 'user', content: spinoffBody });
    chat.name = 'Research discussion';
    scheduleSaveSessions();
    closeResearch();
    renderSidebar();
    renderChatFromHistory(chat);
    setStatus('ok', 'New chat started with research report');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Discuss failed';
    setStatus('err', msg);
  }
}

async function startResearchRun(extra: { continueFrom?: string } = {}): Promise<void> {
  if (running) return;
  const query = (
    document.getElementById('researchQuery') as HTMLTextAreaElement | null
  )?.value?.trim();
  if (!query) {
    setStatus('err', 'Enter a research question');
    return;
  }

  teardownStream();
  setRunningState(true);
  activeResearchId = null;

  const synapseMount = getSynapseMount();
  if (synapseMount) {
    synapse?.destroy();
    synapse = new ResearchSynapse(synapseMount);
    synapse.reset();
  }
  const resultMount = getResultMount();
  if (resultMount) {
    resultMount.innerHTML = '';
  }

  try {
    const binding = await resolveResearchBinding();
    const body: ResearchStartRequest = {
      query,
      ...readStartOptions(),
      providerId: binding.providerId || undefined,
      model: binding.model || undefined,
      ...extra,
    };
    const { researchId } = await startResearch(body);
    activeResearchId = researchId;
    runAbort = new AbortController();

    streamUnsubscribe = subscribeToResearchStream(researchId, {
      signal: runAbort.signal,
      onProgress: (event) => {
        synapse?.applyProgress(event);
      },
      onEnd: (endEvent) => {
        setRunningState(false);
        const status = endEvent?.status ?? 'done';
        synapse?.complete(status, endEvent?.message);
        if (status === 'done') {
          void showResultForId(researchId);
          setStatus('ok', 'Research complete');
        } else if (status === 'cancelled') {
          setStatus('ok', 'Research cancelled');
        } else {
          setStatus('err', endEvent?.message ?? 'Research failed');
        }
        teardownStream();
      },
      onTransportError: (err) => {
        setRunningState(false);
        const msg = err instanceof Error ? err.message : 'Stream error';
        synapse?.complete('error', msg);
        setStatus('err', msg);
        teardownStream();
      },
    });
  } catch (err) {
    setRunningState(false);
    const msg = err instanceof Error ? err.message : 'Could not start research';
    synapse?.complete('error', msg);
    setStatus('err', msg);
    teardownStream();
  }
}

async function cancelActiveRun(): Promise<void> {
  if (!activeResearchId) return;
  try {
    await cancelResearch(activeResearchId);
  } catch {
    /* best-effort */
  }
  teardownStream();
  setRunningState(false);
  synapse?.complete('cancelled');
}

function closeOtherOverlays(): void {
  closeSettings();
  closeGlobalBugs();
  closeBenchmark();
  void import('../ui/welcome-page').then((m) => {
    if (m.isWelcomePageOpen()) m.closeWelcome({ skipHash: true });
  });
  void import('../ui/experts/experts-hub').then((m) => {
    if (m.isExpertsPageOpen()) m.closeExpertsHub();
  });
}

/** Whether the Deep Research page is open. */
export function isResearchPageOpen(): boolean {
  return getRoot()?.classList.contains('is-open') ?? false;
}

/** Close Deep Research and return to chat. */
export function closeResearch(): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) return;
  void cancelActiveRun();
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  if (window.location.hash.startsWith('#/research')) {
    window.location.hash = '#/';
  }
  void import('../ui/preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
}

/** Open Deep Research (`#/research`). */
export function openResearch(): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) return;
  if (window.location.hash.startsWith('#/settings')) return;

  closeOtherOverlays();
  root.classList.add('is-open');
  shell.classList.add('hidden');
  window.location.hash = '#/research';
  void import('../ui/preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
  setPanelTab(currentTab);
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/settings')) return;
  if (hash === '#/research' || hash.startsWith('#/research/')) {
    openResearch();
    return;
  }
  if (isResearchPageOpen()) {
    closeResearch();
  }
}

function bindStaticControls(): void {
  document.getElementById('btnResearchPageBack')?.addEventListener('click', () => closeResearch());
  document.getElementById('btnResearchStart')?.addEventListener('click', () => {
    void startResearchRun();
  });
  document.getElementById('btnResearchCancel')?.addEventListener('click', () => {
    void cancelActiveRun();
  });
  document.getElementById('researchTabRun')?.addEventListener('click', () => setPanelTab('run'));
  document.getElementById('researchTabLibrary')?.addEventListener('click', () =>
    setPanelTab('library'),
  );
  document.getElementById('btnResearchSettingsLink')?.addEventListener('click', () => {
    void import('../ui/settings-page').then((m) => m.openSettings('deep-research'));
  });
}

/** Wire hash routing and controls (call once from main). */
export function initResearchPage(): void {
  bindStaticControls();
  window.addEventListener('hashchange', onHashChange);
  if (window.location.hash === '#/research' || window.location.hash.startsWith('#/research/')) {
    openResearch();
  }
}

export function openResearchFromTopbar(): void {
  openResearch();
}

/** Test hook: whether Start is disabled during a run. */
export function isResearchStartDisabledForTests(): boolean {
  const btn = document.getElementById('btnResearchStart') as HTMLButtonElement | null;
  return btn?.disabled === true;
}

/** Test hook: toggle running UI without calling the server. */
export function setResearchRunningForTests(isRunning: boolean): void {
  setRunningState(isRunning);
}

/** Test hook: apply mock progress to synapse without a server. */
export function applySynapseProgressForTests(
  mount: HTMLElement,
  event: Parameters<ResearchSynapse['applyProgress']>[0],
): void {
  const syn = new ResearchSynapse(mount);
  syn.reset();
  syn.applyProgress(event);
}
