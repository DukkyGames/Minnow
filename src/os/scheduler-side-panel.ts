/**
 * Scheduler side panel — fixed right rail on the OS desktop (list + stats only).
 */

import { createAppIcon } from './icons';
import {
  closeInstance,
  ensureBackgroundInstance,
  getInstanceSnapshot,
  subscribeInstances,
} from './instances';
import type { ScheduledJob } from '../scheduler/client';

let panelRoot: HTMLElement | null = null;
let mountEl: HTMLElement | null = null;
let statusEl: HTMLElement | null = null;
let statusTimer: number | undefined;
let bound = false;

function getLayer(): HTMLElement | null {
  return document.getElementById('osSidePanelsLayer');
}

function setPanelStatus(state: 'ok' | 'err', message: string): void {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle('is-err', state === 'err');
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    if (statusEl) {
      statusEl.textContent = '';
      statusEl.classList.remove('is-err');
    }
  }, 4000);
}

async function refreshPanelList(): Promise<void> {
  if (!mountEl) return;
  const [{ renderSchedulerPanel }, { openJobEditorWindow }] = await Promise.all([
    import('../ui/scheduler/scheduler-panel'),
    import('../ui/scheduler/job-editor-window'),
  ]);
  await renderSchedulerPanel(mountEl, {
    onStatus: setPanelStatus,
    onAddTask: () => {
      openJobEditorWindow({
        onSaved: () => {
          void refreshPanelList();
        },
        onStatus: setPanelStatus,
      });
    },
    onEditJob: (job: ScheduledJob) => {
      openJobEditorWindow({
        jobId: job.id,
        initialJob: {
          label: job.label,
          enabled: job.enabled,
          schedule: { ...job.schedule },
          prompt: job.prompt,
          modeId: job.modeId,
          providerId: job.providerId,
          modelId: job.modelId,
          workspacePath: job.workspacePath,
          channels: [...job.channels],
        },
        onSaved: () => {
          void refreshPanelList();
        },
        onStatus: setPanelStatus,
      });
    },
  });
}

function ensurePanelDom(): HTMLElement {
  if (panelRoot?.isConnected) return panelRoot;

  const layer = getLayer();
  panelRoot = document.createElement('aside');
  panelRoot.id = 'schedulerSidePanel';
  panelRoot.className = 'mn-os-scheduler-side-panel';
  panelRoot.setAttribute('aria-label', 'Scheduler');
  panelRoot.hidden = true;

  const header = document.createElement('header');
  header.className = 'mn-os-scheduler-side-panel__hdr';

  const iconSlot = document.createElement('span');
  iconSlot.className = 'mn-os-scheduler-side-panel__ico';
  iconSlot.setAttribute('aria-hidden', 'true');
  iconSlot.appendChild(createAppIcon('scheduler', { size: 20 }));

  const titleWrap = document.createElement('div');
  titleWrap.className = 'mn-os-scheduler-side-panel__title-wrap';
  const title = document.createElement('h2');
  title.className = 'mn-os-scheduler-side-panel__title';
  title.textContent = 'Scheduler';
  const subtitle = document.createElement('p');
  subtitle.className = 'mn-os-scheduler-side-panel__subtitle';
  subtitle.textContent = 'Recurring jobs while Minnow is open';
  titleWrap.append(title, subtitle);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'mn-os-scheduler-side-panel__close';
  closeBtn.setAttribute('aria-label', 'Close scheduler panel');
  closeBtn.title = 'Close';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', () => {
    const snap = getInstanceSnapshot();
    const inst = snap.instances.find((i) => i.appId === 'scheduler');
    if (inst) closeInstance(inst.id);
  });

  header.append(iconSlot, titleWrap, closeBtn);

  const body = document.createElement('div');
  body.className = 'mn-os-scheduler-side-panel__body';

  statusEl = document.createElement('p');
  statusEl.className = 'scheduler-status mn-os-scheduler-side-panel__status';
  statusEl.setAttribute('role', 'status');
  statusEl.setAttribute('aria-live', 'polite');

  mountEl = document.createElement('div');
  mountEl.id = 'schedulerSidePanelMount';
  mountEl.className = 'scheduler-panel-mount scheduler-panel-mount--side';

  body.append(statusEl, mountEl);
  panelRoot.append(header, body);
  layer?.appendChild(panelRoot);
  return panelRoot;
}

/** Whether the scheduler side panel is visible. */
export function isSchedulerSidePanelOpen(): boolean {
  return Boolean(panelRoot?.isConnected && !panelRoot.hidden);
}

/** Open the scheduler side panel and render the job list. */
export async function openSchedulerSidePanel(): Promise<void> {
  const root = ensurePanelDom();
  root.hidden = false;
  document.documentElement.classList.add('is-scheduler-side-panel-open');
  await refreshPanelList();
}

/** Hide the scheduler side panel without closing the app instance. */
export function closeSchedulerSidePanel(): void {
  if (!panelRoot) return;
  panelRoot.hidden = true;
  document.documentElement.classList.remove('is-scheduler-side-panel-open');
}

/** Whether the scheduler side panel should stay visible for the current shell state. */
function shouldShowSchedulerSidePanel(): boolean {
  const snap = getInstanceSnapshot();
  return snap.instances.some((i) => i.appId === 'scheduler');
}

/** Open or close the scheduler rail without leaving the current foreground app. */
export async function toggleSchedulerOverlay(): Promise<void> {
  const snap = getInstanceSnapshot();
  const existing = snap.instances.find((i) => i.appId === 'scheduler');

  if (existing && isSchedulerSidePanelOpen()) {
    closeInstance(existing.id);
    return;
  }

  if (!existing) {
    ensureBackgroundInstance('scheduler');
  }

  await openSchedulerSidePanel();
}

/** Show or hide the panel based on scheduler instance + foreground app (hide only for Code). */
export function syncSchedulerSidePanel(): void {
  if (shouldShowSchedulerSidePanel()) {
    void openSchedulerSidePanel();
    return;
  }
  closeSchedulerSidePanel();
}

/** Wire instance subscription so the panel tracks scheduler open state and Code foreground. */
export function initSchedulerSidePanel(): void {
  if (bound) return;
  bound = true;
  subscribeInstances(() => {
    syncSchedulerSidePanel();
  });
  syncSchedulerSidePanel();
}

/** Reset module state (tests). */
export function resetSchedulerSidePanelForTests(): void {
  bound = false;
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = undefined;
  panelRoot?.remove();
  panelRoot = null;
  mountEl = null;
  statusEl = null;
  document.documentElement.classList.remove('is-scheduler-side-panel-open');
}
