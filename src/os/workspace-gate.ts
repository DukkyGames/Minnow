/**
 * Workspace gate — full-stage picker until a workspace is chosen (workspace-first shell).
 */

import '../styles/workspace-gate.css';

import { isDefaultWorkspace, loadWorkspaceFromServer } from '../state/workspace';
import { isOsShellEnabled } from './page-bridge';
import { getOsView, subscribeInstances } from './instances';
import { launchApp } from './router';

let gateMounted = false;
let gateOpen = false;
let bootGatePromise: Promise<void> | null = null;
let resolveBootGate: (() => void) | null = null;

function getGateRoot(): HTMLElement | null {
  return document.getElementById('osWorkspaceGate');
}

function getWelcomeRoot(): HTMLElement | null {
  return document.getElementById('welcomeView');
}

/** Whether the boot gate is blocking initApp (default workspace, shell on). */
export function isWorkspaceGateBlockingBoot(): boolean {
  return Boolean(bootGatePromise);
}

/** True when the workspace gate surface is visible. */
export function isWorkspaceGateOpen(): boolean {
  return gateOpen;
}

function setGateOpening(opening: boolean): void {
  getGateRoot()?.classList.toggle('workspace-gate--opening', opening);
}

/** Mount #welcomeView inside #osWorkspaceGate and wire welcome module once. */
export function mountWorkspaceGateDom(): void {
  if (!isOsShellEnabled()) return;

  const gate = getGateRoot();
  const welcome = getWelcomeRoot();
  if (!gate || !welcome) return;

  if (welcome.parentElement !== gate) {
    gate.appendChild(welcome);
  }

  if (!gateMounted) {
    gateMounted = true;
    void import('../ui/welcome-page').then((m) => m.initWelcomePage());
  }
}

function showGateElement(): void {
  const gate = getGateRoot();
  const welcome = getWelcomeRoot();
  if (!gate || !welcome) return;

  gate.hidden = false;
  welcome.hidden = false;
  welcome.classList.add('is-open');
  welcome.classList.add('welcome-page--os-overlay');
  gateOpen = true;
  document.documentElement.classList.add('os-workspace-gate-open');
}

function hideGateElement(): void {
  const gate = getGateRoot();
  const welcome = getWelcomeRoot();
  gateOpen = false;
  setGateOpening(false);
  if (gate) gate.hidden = true;
  welcome?.classList.remove('is-open', 'welcome-page--os-overlay');
  if (welcome) welcome.hidden = true;
  document.documentElement.classList.remove('os-workspace-gate-open');
}

/**
 * Open the workspace picker (boot or menubar switch).
 * Reuses welcome-page UI inside #osWorkspaceGate.
 */
export function openWorkspaceGate(options?: { switch?: boolean }): void {
  if (!isOsShellEnabled()) return;
  mountWorkspaceGateDom();
  showGateElement();
  void import('../ui/welcome-page').then((m) => {
    if (options?.switch) {
      m.onWorkspaceGateOpenedForSwitch();
    } else {
      m.resetWorkspaceGateSwitchMode();
    }
    m.refreshWorkspaceGateUi();
  });
}

/** Close the gate without changing workspace. */
export function closeWorkspaceGate(): void {
  if (!gateOpen) return;
  hideGateElement();
}

/** Called after PUT /api/workspace succeeds — enter Code and release boot gate. */
export async function onWorkspaceGateChosen(): Promise<void> {
  setGateOpening(false);
  closeWorkspaceGate();
  resolveBootGate?.();
  resolveBootGate = null;
  bootGatePromise = null;

  if (getOsView() === 'workspaces' || window.location.hash.startsWith('#/workspaces')) {
    launchApp('code');
  }
}

/** Hold opening UI until the workspace PUT finishes. */
export function markWorkspaceGateOpening(opening: boolean): void {
  if (!gateOpen && opening) return;
  setGateOpening(opening);
}

/** Sync gate visibility with router + workspace state. */
export function syncWorkspaceGateFromRoute(): void {
  if (!isOsShellEnabled()) return;
  if (getOsView() !== 'workspaces') {
    if (gateOpen) closeWorkspaceGate();
    return;
  }
  if (isDefaultWorkspace()) {
    openWorkspaceGate();
  } else {
    closeWorkspaceGate();
  }
}

function ensureBootGatePromise(): void {
  if (!isOsShellEnabled() || !isDefaultWorkspace()) return;
  if (bootGatePromise) return;
  bootGatePromise = new Promise<void>((resolve) => {
    resolveBootGate = resolve;
  });
}

/**
 * Block initApp until the user picks a workspace (or continues in the default folder).
 */
export async function awaitWorkspaceGateBeforeAppInit(): Promise<void> {
  if (!isOsShellEnabled()) return;

  await loadWorkspaceFromServer();

  if (!isDefaultWorkspace()) {
    const hash = window.location.hash;
    if (
      hash === '#/workspaces' ||
      hash === '#/desktop' ||
      hash === '' ||
      hash === '#/' ||
      hash === '#'
    ) {
      if (window.location.hash !== '#/app/code/chat') {
        window.location.replace('#/app/code/chat');
      }
    }
    return;
  }

  ensureBootGatePromise();
  mountWorkspaceGateDom();
  openWorkspaceGate();
  await bootGatePromise;
}

/** Subscribe gate to shell view changes. */
export function initWorkspaceGate(): void {
  if (!isOsShellEnabled()) return;
  mountWorkspaceGateDom();
  subscribeInstances(() => {
    syncWorkspaceGateFromRoute();
  });
}

/** Reset module state (tests). */
export function resetWorkspaceGateForTests(): void {
  gateOpen = false;
  gateMounted = false;
  bootGatePromise = null;
  resolveBootGate = null;
  setGateOpening(false);
  document.documentElement.classList.remove('os-workspace-gate-open');
}
