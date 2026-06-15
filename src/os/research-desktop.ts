/**
 * Desktop research surface — composer-driven runs with floating progress/result cards.
 */

import { decodeModelSelectKey } from '../lib/model-select-key';
import { getActiveModelIdFromDom } from '../benchmark/resolve-binding';
import { loadResearchConfig } from '../config/research-config';
import { pushNotification } from '../notifications/push';
import {
  cancelResearch,
  fetchResearchResult,
  startResearch,
  subscribeToResearchStream,
} from '../research/client';
import { renderResearchLibrary } from '../research/library';
import { ResearchProgressPanel } from '../research/progress-panel';
import { renderResearchResultFromMarkdown } from '../research/report-view';
import type { ResearchStartRequest } from '../research/types';
import { getActiveChat } from '../state/sessions';
import { setStatus } from '../ui/status';
import type { DesktopResearchActivateOptions } from './desktop-state';
import {
  isDesktopResearchActive,
  setDesktopResearchRunActive,
} from './desktop-state';

let progressPanel: ResearchProgressPanel | null = null;
let streamUnsubscribe: (() => void) | null = null;
let runAbort: AbortController | null = null;
let activeResearchId: string | null = null;
let running = false;
let lastRunRound = 1;
let currentQuery = '';
let showingLibrary = false;

function getProgressMount(): HTMLElement | null {
  return document.getElementById('desktopResearchProgressMount');
}

function getResultMount(): HTMLElement | null {
  return document.getElementById('desktopResearchResultMount');
}

function getLibraryMount(): HTMLElement | null {
  return document.getElementById('desktopResearchLibraryMount');
}

function getResearchOverlay(): HTMLElement | null {
  return document.querySelector('.mn-os-desktop-research');
}

function syncResearchToolbar(): void {
  const cancelBtn = document.getElementById('btnDesktopResearchCancel');
  cancelBtn?.toggleAttribute('hidden', !running);
}

function getComposerInput(): HTMLTextAreaElement | null {
  return document.getElementById('desktopInput') as HTMLTextAreaElement | null;
}

function setLibraryVisible(visible: boolean): void {
  showingLibrary = visible;
  const lib = getLibraryMount();
  const progress = getProgressMount();
  const result = getResultMount();
  lib?.classList.toggle('hidden', !visible);
  if (visible) {
    progress?.classList.add('hidden');
    result?.classList.add('hidden');
  } else {
    progress?.classList.remove('hidden');
    result?.classList.remove('hidden');
  }
  getResearchOverlay()?.classList.toggle('is-library', visible);
}

async function resolveResearchBinding(): Promise<{ providerId: string; model: string }> {
  const config = await loadResearchConfig();
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

function readDefaultStartOptions(): Omit<ResearchStartRequest, 'query' | 'continueFrom'> {
  return {
    maxRounds: 0,
    category: '',
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
  setLibraryVisible(false);
  syncResearchToolbar();
}

async function showResultForId(researchId: string): Promise<void> {
  const mount = getResultMount();
  if (!mount) {
    return;
  }
  mount.innerHTML = '<p class="dr-rep-stats research-mono">Loading result…</p>';
  setLibraryVisible(false);
  syncResearchToolbar();
  try {
    const data = await fetchResearchResult(researchId);
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
          resetRunUi();
          setDesktopResearchRunActive(false);
          getComposerInput()?.focus();
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
      },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Could not load result';
    mount.innerHTML = `<p class="dr-rep-stats">${msg}</p>`;
  }
}

async function showDesktopResearchLibrary(): Promise<void> {
  const mount = getLibraryMount();
  if (!mount) {
    return;
  }
  setLibraryVisible(true);
  await renderResearchLibrary({
    mount,
    onNewResearch: () => {
      setLibraryVisible(false);
  syncResearchToolbar();
      resetRunUi();
      setDesktopResearchRunActive(false);
      getComposerInput()?.focus();
    },
    onOpenDetail: (id) => {
      setLibraryVisible(false);
  syncResearchToolbar();
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
      setLibraryVisible(false);
  syncResearchToolbar();
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
  const query = (extra.query ?? getComposerInput()?.value ?? '').trim();
  if (!query) {
    setStatus('err', 'Enter a research question');
    return;
  }

  currentQuery = query;
  teardownStream();
  running = true;
  activeResearchId = null;
  setDesktopResearchRunActive(true);
  setLibraryVisible(false);
  syncResearchToolbar();

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
        if (event.phase === 'searching' && event.round) {
          lastRunRound = event.round;
        }
      },
      onEnd: (endEvent) => {
        running = false;
        const status = endEvent?.status ?? 'done';
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
        } else if (status === 'cancelled') {
          setStatus('ok', 'Research cancelled');
          setDesktopResearchRunActive(false);
        } else {
          setStatus('err', endEvent?.message ?? 'Research failed');
        }
        teardownStream();
      },
      onTransportError: (err) => {
        running = false;
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
  progressPanel?.complete('cancelled');
  syncResearchToolbar();
  setDesktopResearchRunActive(false);
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
  showingLibrary = false;
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
  document.getElementById('btnDesktopResearchLibrary')?.addEventListener('click', () => {
    void showDesktopResearchLibrary();
  });
}

/** Whether a desktop research run is in progress. */
export function isDesktopResearchRunning(): boolean {
  return running;
}

/** Test hook: whether library panel is visible. */
export function isDesktopResearchLibraryOpenForTests(): boolean {
  return showingLibrary;
}
