/**
 * Desktop research surface — composer-driven runs with floating progress/result cards.
 */

import { resolveResearchModelBinding } from '../research/resolve-binding';
import { pushNotification } from '../notifications/push';
import {
  cancelResearch,
  fetchResearchDetail,
  fetchResearchResult,
  normalizeResearchActivityLog,
  startResearch,
  subscribeToResearchStream,
} from '../research/client';
import { ResearchActivitySession } from '../research/research-activity-session';
import {
  closeResearchLibraryWindow,
  isResearchLibraryWindowOpen,
  openResearchLibraryWindow,
} from '../research/library-window';
import { ResearchProgressPanel } from '../research/progress-panel';
import { renderResearchResultFromMarkdown } from '../research/report-view';
import type { ResearchScope, ResearchStartRequest } from '../research/types';
import {
  readResearchWorkspaceRoot,
  syncResearchWorkspaceFieldVisibility,
  wireResearchWorkspaceScopeControls,
} from '../research/workspace-scope-ui';
import { setStatus } from '../ui/status';
import type { DesktopResearchActivateOptions } from './desktop-state';
import {
  isDesktopResearchActive,
  setDesktopResearchRunActive,
} from './desktop-state';

let progressPanel: ResearchProgressPanel | null = null;
let researchActivity = new ResearchActivitySession();
let streamUnsubscribe: (() => void) | null = null;
let runAbort: AbortController | null = null;
let activeResearchId: string | null = null;
let running = false;
let lastRunRound = 1;
let currentQuery = '';

function getProgressMount(): HTMLElement | null {
  return document.getElementById('desktopResearchProgressBody');
}

function getResultMount(): HTMLElement | null {
  return document.getElementById('desktopResearchResultBody');
}

function syncResearchResultChrome(): void {
  const closeBtn = document.getElementById('btnDesktopResearchClose');
  const body = getResultMount();
  const hasContent = Boolean(body?.childElementCount);
  closeBtn?.toggleAttribute('hidden', !hasContent);
}

function dismissDesktopResearchResult(): void {
  resetRunUi();
  setDesktopResearchRunActive(false);
  getComposerInput()?.focus();
}

function syncResearchToolbar(): void {
  const cancelBtn = document.getElementById('btnDesktopResearchCancel');
  cancelBtn?.toggleAttribute('hidden', !running);
  const roundsSelect = document.getElementById(
    'desktopResearchMaxRounds',
  ) as HTMLSelectElement | null;
  const scopeSelect = document.getElementById('desktopResearchScope') as HTMLSelectElement | null;
  const workspaceSelect = document.getElementById(
    'desktopResearchWorkspace',
  ) as HTMLSelectElement | null;
  const workspaceLabel = document.getElementById('desktopResearchWorkspaceLabel');
  if (roundsSelect) {
    roundsSelect.disabled = running;
  }
  if (scopeSelect) {
    scopeSelect.disabled = running;
    syncResearchWorkspaceFieldVisibility(
      (scopeSelect.value ?? 'web') as ResearchScope,
      workspaceLabel,
    );
  }
  if (workspaceSelect) {
    workspaceSelect.disabled = running;
  }
  const workspaceBrowse = document.getElementById(
    'btnDesktopResearchWorkspaceBrowse',
  ) as HTMLButtonElement | null;
  if (workspaceBrowse) {
    workspaceBrowse.disabled = running;
  }
}

function getComposerInput(): HTMLTextAreaElement | null {
  return document.getElementById('desktopInput') as HTMLTextAreaElement | null;
}

function readDefaultStartOptions(): Omit<ResearchStartRequest, 'query' | 'continueFrom'> {
  const maxRoundsRaw = (
    document.getElementById('desktopResearchMaxRounds') as HTMLSelectElement | null
  )?.value;
  const maxRounds = maxRoundsRaw === 'auto' ? 0 : Number(maxRoundsRaw);
  const scope = (
    (document.getElementById('desktopResearchScope') as HTMLSelectElement | null)?.value ?? 'web'
  ) as ResearchScope;
  const workspaceRoot = readResearchWorkspaceRoot(
    document.getElementById('desktopResearchWorkspace') as HTMLSelectElement | null,
    scope,
  );
  return {
    maxRounds: Number.isFinite(maxRounds) ? maxRounds : 0,
    category: '',
    scope,
    ...(workspaceRoot ? { workspaceRoot } : {}),
  };
}

function teardownStream(): void {
  streamUnsubscribe?.();
  streamUnsubscribe = null;
  runAbort?.abort();
  runAbort = null;
}

function clearProgressUi(): void {
  progressPanel?.destroy();
  progressPanel = null;
  const progressMount = getProgressMount();
  if (progressMount) {
    progressMount.innerHTML = '';
  }
  researchActivity.destroy();
  researchActivity = new ResearchActivitySession();
}

function resetRunUi(): void {
  clearProgressUi();
  const resultMount = getResultMount();
  if (resultMount) {
    resultMount.innerHTML = '';
  }
  activeResearchId = null;
  closeResearchLibraryWindow();
  syncResearchToolbar();
  syncResearchResultChrome();
}

async function showResultForId(researchId: string): Promise<void> {
  const mount = getResultMount();
  if (!mount) {
    return;
  }
  mount.innerHTML = '<p class="dr-rep-stats research-mono">Loading result…</p>';
  closeResearchLibraryWindow();
  clearProgressUi();
  activeResearchId = researchId;
  syncResearchResultChrome();
  // Library opens stay in researchIdle unless we promote to researchActive (hides hero, stage layout).
  setDesktopResearchRunActive(true);
  syncResearchToolbar();
  try {
    const data = await fetchResearchDetail(researchId);
    const activityLog = normalizeResearchActivityLog(data);
    if (activityLog.length) {
      researchActivity.configure({});
      researchActivity.hydrate(activityLog);
      researchActivity.setRunning(data.status === 'running');
      researchActivity.mountDesktopChromeButton();
    }
    if (data.query?.trim()) {
      currentQuery = data.query.trim();
    }
    if (data.stats?.rounds != null) {
      lastRunRound = data.stats.rounds;
    }
    renderResearchResultFromMarkdown(
      mount,
      data.result,
      data.sources ?? [],
      currentQuery,
      data.stats,
      lastRunRound,
      {
        onExport: () => {
          void import('../research/panel').then((m) => m.openResearchReport(researchId));
        },
        onRunAgain: () => {
          dismissDesktopResearchResult();
          const input = getComposerInput();
          if (input && currentQuery) {
            input.value = currentQuery;
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
          }
          input?.focus();
        },
        onDiscuss: () => {
          void import('../research/panel').then((m) => m.discussResearchReport(researchId));
        },
        onRefine: () => {
          void startDesktopResearchRun({ continueFrom: researchId });
        },
        onFollowUp: (q) => {
          const input = getComposerInput();
          if (input) {
            input.value = q;
          }
          void startDesktopResearchRun({ continueFrom: researchId });
        },
        onViewLibrary: () => {
          void showDesktopResearchLibrary();
        },
        onAddToBrain: () => {
          void import('../ui/chat-brain-capture').then((m) =>
            m.runResearchBrainCapture(researchId),
          );
        },
      },
      { savedToLibrary: true },
    );
    syncResearchResultChrome();
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not load result';
    mount.innerHTML = `<p class="dr-rep-stats">${msg}</p>`;
    syncResearchResultChrome();
  }
}

async function showDesktopResearchLibrary(): Promise<void> {
  await openResearchLibraryWindow({
    onNewResearch: () => {
      resetRunUi();
      setDesktopResearchRunActive(false);
      getComposerInput()?.focus();
    },
    onOpenDetail: (id) => {
      void showResultForId(id);
    },
    onOpenReport: (id) => {
      void import('../research/panel').then((m) => m.openResearchReport(id));
    },
    onDiscuss: (id) => {
      void import('../research/panel').then((m) => m.discussResearchReport(id));
    },
    onRefine: (id, query) => {
      const input = getComposerInput();
      if (input && query.trim()) {
        input.value = query;
      }
      void startDesktopResearchRun({ continueFrom: id });
    },
  });
}

/** Start or continue a desktop research run from the composer query. */
export async function startDesktopResearchRun(
  extra: { continueFrom?: string; query?: string } = {},
): Promise<void> {
  if (running) {
    return;
  }
  const query = (extra.query ?? getComposerInput()?.value ?? currentQuery ?? '').trim();
  if (!query) {
    setStatus('err', 'Enter a research question');
    return;
  }

  currentQuery = query;
  teardownStream();
  running = true;
  activeResearchId = null;
  setDesktopResearchRunActive(true);
  closeResearchLibraryWindow();
  syncResearchToolbar();

  const progressMount = getProgressMount();
  if (progressMount) {
    progressPanel?.destroy();
    progressPanel = new ResearchProgressPanel(progressMount);
    progressPanel.reset();
  }
  researchActivity.configure({});
  researchActivity.reset();
  researchActivity.mountDesktopChromeButton();
  const resultMount = getResultMount();
  if (resultMount) {
    resultMount.innerHTML = '';
  }
  syncResearchResultChrome();

  try {
    const binding = await resolveResearchModelBinding();
    const body: ResearchStartRequest = {
      query,
      ...readDefaultStartOptions(),
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
        running = false;
        researchActivity.setRunning(false);
        const status = endEvent?.status ?? 'done';
        if (status === 'cancelled') {
          activeResearchId = null;
          clearProgressUi();
          syncResearchToolbar();
          setStatus('ok', 'Research cancelled');
          setDesktopResearchRunActive(false);
          teardownStream();
          return;
        }
        progressPanel?.complete(status, endEvent?.message);
        syncResearchToolbar();
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
        } else {
          setStatus('err', endEvent?.message ?? 'Research failed');
        }
        teardownStream();
      },
      onTransportError: (err) => {
        running = false;
        researchActivity.setRunning(false);
        syncResearchToolbar();
        const msg = err instanceof Error ? err.message : 'Stream error';
        progressPanel?.complete('error', msg);
        setStatus('err', msg);
        teardownStream();
      },
    });
  } catch (err) {
    running = false;
    syncResearchToolbar();
    const msg = err instanceof Error ? err.message : 'Could not start research';
    progressPanel?.complete('error', msg);
    setStatus('err', msg);
    teardownStream();
  }
}

/** Cancel the active desktop research run. */
export async function cancelDesktopResearchRun(): Promise<void> {
  if (!activeResearchId) {
    return;
  }
  try {
    await cancelResearch(activeResearchId);
  } catch {
    /* best-effort */
  }
  teardownStream();
  running = false;
  activeResearchId = null;
  clearProgressUi();
  syncResearchToolbar();
  setDesktopResearchRunActive(false);
  setStatus('ok', 'Research cancelled');
}

function applyDesktopSeed(seed?: string): void {
  if (!seed?.trim()) {
    return;
  }
  const input = getComposerInput();
  if (!input || input.value.trim()) {
    return;
  }
  input.value = seed.trim();
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** Activate desktop research mode with optional seed / auto-run. */
export async function bootstrapDesktopResearch(
  options?: DesktopResearchActivateOptions,
): Promise<void> {
  applyDesktopSeed(options?.seed);
  if (options?.autoRun) {
    const query = (options.seed ?? getComposerInput()?.value ?? '').trim();
    if (query) {
      await startDesktopResearchRun({ query });
      return;
    }
  }
  getComposerInput()?.focus();
}

/** Tear down streams and overlay content when leaving research mode. */
export function teardownDesktopResearch(): void {
  void cancelDesktopResearchRun();
  resetRunUi();
  running = false;
  currentQuery = '';
  closeResearchLibraryWindow();
  syncResearchToolbar();
}

/** Submit handler wired from the desktop concierge composer. */
export async function handleDesktopResearchSubmit(prefill?: string): Promise<void> {
  if (!isDesktopResearchActive()) {
    return;
  }
  const input = getComposerInput();
  if (prefill?.trim() && input && !input.value.trim()) {
    input.value = prefill.trim();
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  const query = input?.value.trim() ?? '';
  if (!query) {
    setStatus('err', 'Enter a research question');
    return;
  }
  if (running) {
    await cancelDesktopResearchRun();
    return;
  }
  input!.value = '';
  input?.dispatchEvent(new window.Event('input', { bubbles: true }));
  await startDesktopResearchRun({ query });
}

let controlsBound = false;

/** Wire cancel + library controls on the desktop research overlay. */
export function wireDesktopResearchControls(): void {
  if (controlsBound) {
    return;
  }
  controlsBound = true;

  document.getElementById('btnDesktopResearchCancel')?.addEventListener('click', () => {
    void cancelDesktopResearchRun();
  });
  document.getElementById('btnDesktopResearchClose')?.addEventListener('click', () => {
    dismissDesktopResearchResult();
  });
  document.getElementById('btnDesktopResearchLibrary')?.addEventListener('click', () => {
    void showDesktopResearchLibrary();
  });

  const scopeSelect = document.getElementById('desktopResearchScope') as HTMLSelectElement | null;
  const workspaceSelect = document.getElementById(
    'desktopResearchWorkspace',
  ) as HTMLSelectElement | null;
  const workspaceLabel = document.getElementById('desktopResearchWorkspaceLabel');
  const workspaceBrowse = document.getElementById(
    'btnDesktopResearchWorkspaceBrowse',
  ) as HTMLButtonElement | null;
  if (scopeSelect && workspaceSelect && workspaceLabel) {
    wireResearchWorkspaceScopeControls({
      scopeSelect,
      workspaceField: workspaceLabel,
      workspaceSelect,
      browseBtn: workspaceBrowse,
    });
  }
}

/** Whether a desktop research run is in progress. */
export function isDesktopResearchRunning(): boolean {
  return running;
}

/** Test hook: whether library window is open. */
export function isDesktopResearchLibraryOpenForTests(): boolean {
  return isResearchLibraryWindowOpen();
}
