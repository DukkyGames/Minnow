/**
 * Deep Research full-page panel — query, progress stepper, structured brief, library.
 */

import '../styles/research-page.css';

import { decodeModelSelectKey } from '../lib/model-select-key';
import { wrapUntrusted } from '../lib/untrusted.mjs';
import { getActiveModelIdFromDom } from '../benchmark/resolve-binding';
import { loadResearchConfig } from '../config/research-config';
import { noteAgentMessage } from '../os/instances';
import {
  cancelResearch,
  fetchResearchResult,
  researchReportUrl,
  startResearch,
  subscribeToResearchStream,
} from './client';
import { renderResearchLibrary } from './library';
import { ResearchProgressPanel } from './progress-panel';
import { renderResearchResultFromMarkdown } from './report-view';
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
import { isOsAppHash, isOsShellEnabled } from '../os/page-bridge';
import { navigateToDesktop } from '../os/router';

type ResearchPanelTab = 'run' | 'library';

let progressPanel: ResearchProgressPanel | null = null;
let streamUnsubscribe: (() => void) | null = null;
let runAbort: AbortController | null = null;
let activeResearchId: string | null = null;
let running = false;
let currentTab: ResearchPanelTab = 'run';
let pendingAutoRun = false;
let lastRunRound = 1;

function getRoot(): HTMLElement | null {
  return document.getElementById('researchView');
}

function getChatShell(): HTMLElement | null {
  return document.getElementById('appBody');
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
    startBtn.classList.toggle('busy', isRunning);
    if (isRunning) {
      startBtn.innerHTML = '<span class="dr-spinner"></span> Running…';
    } else {
      startBtn.innerHTML =
        '<svg class="dr-run-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="2"/><path d="M20 20l-3.5-3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg> Research';
    }
  }
  if (cancelBtn) {
    cancelBtn.hidden = !isRunning;
    cancelBtn.disabled = !isRunning;
  }
  if (queryInput) {
    queryInput.disabled = isRunning;
  }
  for (const el of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
    '#researchView .dr-controls input, #researchView .dr-controls select',
  )) {
    el.disabled = isRunning;
  }
}

function getProgressMount(): HTMLElement | null {
  return document.getElementById('researchProgressMount');
}

function getResultMount(): HTMLElement | null {
  return document.getElementById('researchResultMount');
}

function setPanelTab(tab: ResearchPanelTab): void {
  currentTab = tab;
  const runTab = document.getElementById('researchTabRun');
  const libTab = document.getElementById('researchTabLibrary');
  runTab?.setAttribute('aria-selected', tab === 'run' ? 'true' : 'false');
  libTab?.setAttribute('aria-selected', tab === 'library' ? 'true' : 'false');
  runTab?.classList.toggle('on', tab === 'run');
  libTab?.classList.toggle('on', tab === 'library');
  document.getElementById('researchPanelRun')?.classList.toggle('hidden', tab !== 'run');
  document.getElementById('researchPanelLibrary')?.classList.toggle('hidden', tab !== 'library');
  if (tab === 'library') {
    void refreshLibraryPanel();
  }
}

async function refreshLibraryPanel(): Promise<void> {
  const mount = document.getElementById('researchLibraryMount');
  if (!mount) {
    return;
  }
  await renderResearchLibrary({
    mount,
    onNewResearch: () => setPanelTab('run'),
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
      if (queryInput && query.trim()) {
        queryInput.value = query;
      }
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

function resetRunUi(): void {
  const progressMount = getProgressMount();
  if (progressMount) {
    progressPanel?.destroy();
    progressPanel = null;
    progressMount.innerHTML = '';
  }
  const resultMount = getResultMount();
  if (resultMount) {
    resultMount.innerHTML = '';
  }
  activeResearchId = null;
}

async function showResultForId(researchId: string): Promise<void> {
  const mount = getResultMount();
  if (!mount) {
    return;
  }
  mount.innerHTML = '<p class="dr-rep-stats research-mono">Loading result…</p>';
  try {
    const data = await fetchResearchResult(researchId);
    const query =
      (document.getElementById('researchQuery') as HTMLTextAreaElement | null)?.value?.trim() ??
      '';
    renderResearchResultFromMarkdown(
      mount,
      data.result,
      data.sources ?? [],
      query,
      data.stats,
      lastRunRound,
      {
        onExport: () => openResearchReport(researchId),
        onRunAgain: () => {
          resetRunUi();
          const queryInput = document.getElementById('researchQuery') as HTMLTextAreaElement | null;
          if (queryInput) {
            queryInput.focus();
          }
        },
        onDiscuss: () => {
          void discussResearchReport(researchId);
        },
        onRefine: () => {
          void startResearchRun({ continueFrom: researchId });
        },
        onFollowUp: (q) => {
          const queryInput = document.getElementById('researchQuery') as HTMLTextAreaElement | null;
          if (queryInput) {
            queryInput.value = q;
          }
          void startResearchRun({ continueFrom: researchId });
        },
        onViewLibrary: () => setPanelTab('library'),
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not load result';
    mount.innerHTML = `<p class="dr-rep-stats">${msg}</p>`;
  }
}

/** Client spinoff: new chat seeded with the report. */
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
      wrapUntrusted(report, { source: 'research-report' });
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
  if (running) {
    return;
  }
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

  const progressMount = getProgressMount();
  if (progressMount) {
    progressPanel?.destroy();
    progressPanel = new ResearchProgressPanel(progressMount);
    progressPanel.reset();
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
        progressPanel?.apply(event);
        if (event.phase === 'searching' && event.round) {
          lastRunRound = event.round;
        }
      },
      onEnd: (endEvent) => {
        setRunningState(false);
        const status = endEvent?.status ?? 'done';
        progressPanel?.complete(status, endEvent?.message);
        if (status === 'done') {
          void showResultForId(researchId);
          const scanned = progressPanel?.getScanned() ?? 0;
          void fetchResearchResult(researchId).then((data) => {
            const sources = data.sources?.length ?? scanned;
            const title = query.slice(0, 60);
            noteAgentMessage(
              'research',
              `Your research brief on ${title}${query.length > 60 ? '…' : ''} is ready — ${sources} sources.`,
            );
          });
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
        progressPanel?.complete('error', msg);
        setStatus('err', msg);
        teardownStream();
      },
    });
  } catch (err) {
    setRunningState(false);
    const msg = err instanceof Error ? err.message : 'Could not start research';
    progressPanel?.complete('error', msg);
    setStatus('err', msg);
    teardownStream();
  }
}

async function cancelActiveRun(): Promise<void> {
  if (!activeResearchId) {
    return;
  }
  try {
    await cancelResearch(activeResearchId);
  } catch {
    /* best-effort */
  }
  teardownStream();
  setRunningState(false);
  progressPanel?.complete('cancelled');
}

function closeOtherOverlays(): void {
  closeSettings({ skipNavigate: true });
  closeGlobalBugs();
  closeBenchmark({ skipNavigate: true });
  void import('../ui/welcome-page').then((m) => {
    if (m.isWelcomePageOpen()) {
      m.closeWelcome({ skipHash: true });
    }
  });
  void import('../ui/experts/experts-hub').then((m) => {
    if (m.isExpertsPageOpen()) {
      m.closeExpertsHub({ skipNavigate: true });
    }
  });
}

/** Whether the Deep Research page is open. */
export function isResearchPageOpen(): boolean {
  return getRoot()?.classList.contains('is-open') ?? false;
}

/** Close Deep Research and return to chat or desktop. */
export function closeResearch(options?: { skipNavigate?: boolean }): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) {
    return;
  }
  void cancelActiveRun();
  root.classList.remove('is-open');
  if (!isOsShellEnabled()) {
    shell.classList.remove('hidden');
    if (!options?.skipNavigate && window.location.hash.startsWith('#/research')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    navigateToDesktop();
  }
  void import('../ui/preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
}

export interface OpenResearchOptions {
  seed?: string;
  autoRun?: boolean;
}

/** Open Deep Research (`#/research` or OS `#/app/research`). */
export function openResearch(options?: OpenResearchOptions): void {
  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) {
    return;
  }
  if (window.location.hash.startsWith('#/settings')) {
    return;
  }

  closeOtherOverlays();
  root.classList.add('is-open');
  if (!isOsShellEnabled()) {
    shell.classList.add('hidden');
    window.location.hash = '#/research';
  }
  void import('../ui/preview-electron-visibility').then((m) =>
    m.syncElectronPreviewHostVisibility(),
  );
  setPanelTab(currentTab);

  if (options?.seed) {
    const query = document.getElementById('researchQuery') as HTMLTextAreaElement | null;
    if (query) {
      query.value = options.seed;
    }
  }
  if (options?.autoRun || pendingAutoRun) {
    pendingAutoRun = false;
    void startResearchRun();
  }
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash.startsWith('#/settings')) {
    return;
  }
  if (hash === '#/research' || hash.startsWith('#/research/')) {
    openResearch();
    return;
  }
  if (isOsShellEnabled() && isOsAppHash(hash)) {
    return;
  }
  if (isResearchPageOpen()) {
    closeResearch();
  }
}

function bindStaticControls(): void {
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

/** Queue auto-run after open (concierge seed). */
export function queueResearchAutoRun(): void {
  pendingAutoRun = true;
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

/** Test hook: apply mock progress without a server. */
export function applyProgressForTests(
  mount: HTMLElement,
  event: Parameters<ResearchProgressPanel['apply']>[0],
): void {
  const panel = new ResearchProgressPanel(mount);
  panel.reset();
  panel.apply(event);
}
