/**
 * Minnow Scheduler app — recurring local agent jobs and reminders.
 */

import '../styles/scheduler-page.css';
import '../styles/scheduler-editor-window.css';
import '../styles/settings-controls.css';

import { createAppIcon } from '../os/icons';
import { isOsAppHash, isOsShellEnabled } from '../os/page-bridge';
import { navigateToDesktop } from '../os/router';
import { renderSchedulerPanel } from './scheduler/scheduler-panel';
import { openJobEditorWindow } from './scheduler/job-editor-overlay';
import type { ScheduledJob } from '../scheduler/client';

let initialized = false;
let statusTimer: number | undefined;

function getRoot(): HTMLElement | null {
  return document.getElementById('schedulerView');
}

function getBody(): HTMLElement | null {
  return document.getElementById('schedulerPanelMount');
}

function getStatusEl(): HTMLElement | null {
  return document.getElementById('schedulerStatus');
}

function setPanelStatus(state: 'ok' | 'err', message: string): void {
  const el = getStatusEl();
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-err', state === 'err');
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    el.textContent = '';
    el.classList.remove('is-err');
  }, 4000);
}

function panelEditorCallbacks() {
  return {
    onStatus: setPanelStatus,
    onAddTask: () => {
      openJobEditorWindow({
        onSaved: () => {
          void refreshPanel();
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
          void refreshPanel();
        },
        onStatus: setPanelStatus,
      });
    },
  };
}

async function refreshPanel(): Promise<void> {
  const body = getBody();
  if (!body) return;
  await renderSchedulerPanel(body, panelEditorCallbacks());
}

function mountHeaderIcon(): void {
  const slot = document.getElementById('schedulerPageIcon');
  if (!slot || slot.childElementCount > 0) return;
  slot.appendChild(createAppIcon('scheduler'));
}

export function initSchedulerPage(): void {
  if (initialized) return;
  initialized = true;
  mountHeaderIcon();
  if (!isOsShellEnabled()) {
    window.addEventListener('hashchange', onHashChange);
    if (
      window.location.hash === '#/scheduler' ||
      window.location.hash.startsWith('#/app/scheduler')
    ) {
      void openScheduler();
    }
  }
}

export async function openScheduler(): Promise<void> {
  const root = getRoot();
  if (!root) return;

  root.classList.add('is-open');
  mountHeaderIcon();
  await refreshPanel();
}

export function closeScheduler(options?: { skipNavigate?: boolean }): void {
  const root = getRoot();
  if (!root) return;
  root.classList.remove('is-open');
  if (!isOsShellEnabled()) {
    if (!options?.skipNavigate && window.location.hash.startsWith('#/scheduler')) {
      window.location.hash = '#/';
    }
  } else if (!options?.skipNavigate) {
    navigateToDesktop();
  }
}

export function isSchedulerPageOpen(): boolean {
  return getRoot()?.classList.contains('is-open') ?? false;
}

function onHashChange(): void {
  const hash = window.location.hash;
  if (hash === '#/scheduler' || hash.startsWith('#/app/scheduler')) {
    void openScheduler();
    return;
  }
  if (isOsShellEnabled() && isOsAppHash(hash)) return;
  if (isSchedulerPageOpen()) {
    closeScheduler();
  }
}

/** Menubar shortcut — opens Scheduler as a main-view app. */
export function openSchedulerFromMenubar(): void {
  void import('../os/router').then((m) => m.launchApp('scheduler'));
}
