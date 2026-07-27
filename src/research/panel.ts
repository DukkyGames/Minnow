/**
 * Deep Research full-page panel — query, progress stepper, structured brief, library.
 */

import '../styles/research-page.css';

import { wrapUntrusted } from '../lib/untrusted.mjs';
import { resolveResearchModelBinding } from './resolve-binding';
import { pushNotification } from '../notifications/push';
import { iconHtml } from '../ui/icon';
import {
  cancelResearch,
  fetchResearchDetail,
  fetchResearchResult,
  normalizeResearchActivityLog,
  researchReportUrl,
  startResearch,
  subscribeToResearchStream,
} from './client';
import { ResearchActivitySession } from './research-activity-session';
import { renderResearchLibrary } from './library';
import { ResearchProgressPanel } from './progress-panel';
import { renderResearchResultFromMarkdown } from './report-view';
import type { ResearchCategory, ResearchScope, ResearchStartRequest } from './types';
import {
  readResearchWorkspaceRoot,
  wireResearchWorkspaceScopeControls,
} from './workspace-scope-ui';
import { closeBenchmark } from '../ui/benchmark-page';
import { closeCompare } from '../ui/compare-page';
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
import {
  deactivateDesktopResearch,
  isDesktopResearchActive,
} from '../os/desktop-state';

type ResearchPanelTab = 'run' | 'library';

let progressPanel: ResearchProgressPanel | null = null;
let researchActivity = new ResearchActivitySession();
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

function resolveResearchReportUrl(researchId: string): string {
  const path = researchReportUrl(researchId);
  if (!path.startsWith('/') || path.startsWith('//')) {
    return path;
  }
  const origin = window.location?.origin;
  if (!origin || origin === 'null') {
    return path;
  }
  return `${origin}${path}`;
}

/**
 * Open the visual report outside the hidden workspace preview pane.
 * Electron uses the system browser so toolbar export (PDF/HTML) works reliably.
 */
function openResearchReportInNewSurface(url: string): void {
  if (window.minnow?.app.openExternal) {
    void window.minnow.app.openExternal(url);
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

/** Open visual report in Electron preview or a new browser tab. */
export function openResearchReport(researchId: string): void {
  const url = resolveResearchReportUrl(researchId);
  // Preview lives under #appBody, which research full-page / desktop overlay hides.
  if (isResearchPageOpen()) {
    openResearchReportInNewSurface(url);
    return;
  }
  void import('../ui/preview-panel').then((m) => {
    if (typeof window.minnow?.preview !== 'undefined') {
      void m.openUrlInPreviewPanel(url);
      return;
    }
    openResearchReportInNewSurface(url);
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
      startBtn.innerHTML = `${iconHtml('search', { size: 16, className: 'dr-run-icon' })} Research`;
    }
  }
  if (cancelBtn) {
    cancelBtn.hidden = !isRunning;
    cancelBtn.disabled = !isRunning;
  }
  if (queryInput) {
    queryInput.disabled = isRunning;
  }
  for (const el of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLButtonElement
  >(
    '#researchView .dr-controls input, #researchView .dr-controls select, #researchView .dr-controls button:not(#btnResearchStart):not(#btnResearchCancel)',
  )) {
    el.disabled = isRunning;
  }
}

function getProgressMount(): HTMLElement | null {
  return document.getElementById('researchProgressMount');
}

function getActivityButtonMount(): HTMLElement | null {
  return getProgressMount()?.parentElement ?? null;
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
  const overrideProvider = (
    document.getElementById('researchProviderOverride') as HTMLSelectElement | null
  )?.value?.trim();
  const overrideModel = (
    document.getElementById('researchModelOverride') as HTMLInputElement | null
  )?.value?.trim();

  return resolveResearchModelBinding({ overrideProvider, overrideModel });
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
  const scope = (
    (document.getElementById('researchScope') as HTMLSelectElement | null)?.value ?? 'web'
  ) as ResearchScope;
  const workspaceRoot = readResearchWorkspaceRoot(
    document.getElementById('researchWorkspace') as HTMLSelectElement | null,
    scope,
  );
  return {
    maxRounds: Number.isFinite(maxRounds) ? maxRounds : 0,
    category,
    scope,
    ...(workspaceRoot ? { workspaceRoot } : {}),
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
  researchActivity.destroy();
  researchActivity = new ResearchActivitySession();
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
    const data = await fetchResearchDetail(researchId);
    const activityLog = normalizeResearchActivityLog(data);
    if (activityLog.length) {
      researchActivity.configure({});
      researchActivity.hydrate(activityLog);
      researchActivity.setRunning(data.status === 'running');
      researchActivity.mountButton(getActivityButtonMount());
    }
    const queryInput = document.getElementById('researchQuery') as HTMLTextAreaElement | null;
    const storedQuery = data.query?.trim() ?? '';
    if (queryInput && storedQuery && !queryInput.value.trim()) {
      queryInput.value = storedQuery;
    }
    const query = queryInput?.value?.trim() || storedQuery;
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
          if (queryInput && query) {
            queryInput.value = query;
          }
          queryInput?.focus();
        },
        onDiscuss: () => {
          void discussResearchReport(researchId);
        },
        onRefine: () => {
          if (queryInput && query && !queryInput.value.trim()) {
            queryInput.value = query;
          }
          void startResearchRun({ continueFrom: researchId });
        },
        onFollowUp: (q) => {
          if (queryInput) {
            queryInput.value = q;
          }
          void startResearchRun({ continueFrom: researchId });
        },
        onViewLibrary: () => setPanelTab('library'),
        onAddToBrain: () => {
          void import('../ui/chat-brain-capture').then((m) =>
            m.runResearchBrainCapture(researchId),
          );
        },
      },
      { savedToLibrary: true },
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

    if (isOsShellEnabled()) {
      const { activateDesktopChat } = await import('../os/desktop-state');
      await activateDesktopChat({ chatId: chat.id });
    } else {
      closeResearch();
      renderChatFromHistory(chat);
    }

    renderSidebar();
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
  researchActivity.configure({ buttonInsert: 'prepend' });
  researchActivity.reset();
  researchActivity.mountButton(getActivityButtonMount());
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
        researchActivity.appendProgress(event);
        if (event.phase === 'searching' && event.round) {
          lastRunRound = event.round;
        }
      },
      onEnd: (endEvent) => {
        setRunningState(false);
        researchActivity.setRunning(false);
        const status = endEvent?.status ?? 'done';
        progressPanel?.complete(status, endEvent?.message);
        if (status === 'done') {
          void showResultForId(researchId);
          const scanned = progressPanel?.getScanned() ?? 0;
          void fetchResearchResult(researchId).then((data) => {
            const sources = data.sources?.length ?? scanned;
            const title = query.slice(0, 60);
            pushNotification({
              kind: 'research',
              title: 'Research',
              preview: `Your research brief on ${title}${query.length > 60 ? '…' : ''} is ready — ${sources} sources.`,
              appId: 'research',
              dedupeKey: `research:${researchId}`,
            });
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
        researchActivity.setRunning(false);
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
  researchActivity.setRunning(false);
  progressPanel?.complete('cancelled');
}

function closeOtherOverlays(): void {
  closeSettings({ skipNavigate: true });
  closeBenchmark({ skipNavigate: true });
  closeCompare({ skipNavigate: true });
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
  if (isOsShellEnabled() && isDesktopResearchActive()) {
    return true;
  }
  return getRoot()?.classList.contains('is-open') ?? false;
}

/** Close Deep Research and return to chat or desktop. */
export function closeResearch(options?: { skipNavigate?: boolean }): void {
  if (isOsShellEnabled()) {
    deactivateDesktopResearch();
    if (!options?.skipNavigate) {
      navigateToDesktop();
    }
    return;
  }

  const root = getRoot();
  const shell = getChatShell();
  if (!root || !shell) {
    return;
  }
  void cancelActiveRun();
  root.classList.remove('is-open');
  shell.classList.remove('hidden');
  if (!options?.skipNavigate && window.location.hash.startsWith('#/research')) {
    window.location.hash = '#/';
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
  if (isOsShellEnabled()) {
    void import('../os/router').then(({ launchApp }) => {
      launchApp('research', {
        seed: options?.seed,
        autoRun: options?.autoRun || pendingAutoRun,
      });
    });
    pendingAutoRun = false;
    return;
  }

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

  const scopeSelect = document.getElementById('researchScope') as HTMLSelectElement | null;
  const workspaceSelect = document.getElementById('researchWorkspace') as HTMLSelectElement | null;
  const workspaceField = document.getElementById('researchWorkspaceField');
  const workspaceBrowse = document.getElementById(
    'btnResearchWorkspaceBrowse',
  ) as HTMLButtonElement | null;
  if (scopeSelect && workspaceSelect && workspaceField) {
    wireResearchWorkspaceScopeControls({
      scopeSelect,
      workspaceField,
      workspaceSelect,
      browseBtn: workspaceBrowse,
    });
  }
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
