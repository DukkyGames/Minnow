/**
 * Desktop Super Plan surface — intake questionnaire + staged controller pipeline.
 */

import '../styles/superplan.css';

import { SuperPlanSession } from '../superplan/run-session';
import type { SuperPlanProgress, SuperPlanRunState } from '../superplan/types';
import {
  activateDesktopSuperPlan,
  deactivateDesktopSuperPlan,
  isDesktopSuperPlanActive,
  setDesktopSuperPlanRunActive,
} from './desktop-state';

const desktopSession = new SuperPlanSession(
  {
    progressBodyId: 'desktopSuperPlanProgressBody',
    resultBodyId: 'desktopSuperPlanResultBody',
    cancelBtnId: 'btnDesktopSuperPlanCancel',
    closeBtnId: 'btnDesktopSuperPlanClose',
  },
  {
    onRunActiveChange: (active) => {
      setDesktopSuperPlanRunActive(active);
    },
    onDeactivate: () => {
      deactivateDesktopSuperPlan();
    },
  },
);

function applyDesktopSeed(seed?: string): void {
  if (!seed?.trim()) {
    return;
  }
  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  if (!input || input.value.trim()) {
    return;
  }
  input.value = seed.trim();
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

/** Open Super Plan on the desktop overlay (optional seed prompt). */
export async function openSuperPlan(prompt?: string): Promise<void> {
  if (isSuperPlanActive() && desktopSession.isRunning()) {
    return;
  }

  let userPrompt = prompt?.trim() ?? '';
  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  if (!userPrompt && input?.value.trim()) {
    userPrompt = input.value.trim();
  }

  if (!isDesktopSuperPlanActive()) {
    await activateDesktopSuperPlan({ seed: userPrompt || undefined });
  }
  applyDesktopSeed(userPrompt);

  if (!userPrompt) {
    await desktopSession.open(undefined, { allowIdleWithoutPrompt: true });
    input?.focus();
    return;
  }

  await desktopSession.open(userPrompt);
  input?.focus();
}

/** Submit a prompt from the desktop composer while Super Plan is idle. */
export function trySubmitDesktopSuperPlanFromComposer(text: string): boolean {
  if (!isDesktopSuperPlanActive() || !desktopSession.isAwaitingPrompt()) {
    return false;
  }
  if (!desktopSession.trySubmitPrompt(text)) {
    return false;
  }
  const input = document.getElementById('desktopInput') as HTMLTextAreaElement | null;
  if (input) {
    input.value = '';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  return true;
}

/** Cancel the active Super Plan session. */
export async function cancelSuperPlan(): Promise<void> {
  await desktopSession.cancel();
}

/** Whether Super Plan mode is active on the desktop. */
export function isSuperPlanActive(): boolean {
  return isDesktopSuperPlanActive();
}

/** Apply a progress event from the controller (test hook). */
export function applySuperPlanProgress(event: SuperPlanProgress): void {
  desktopSession.applyProgress(event);
}

/** Tear down overlay content when leaving Super Plan mode. */
export function teardownDesktopSuperPlan(): void {
  desktopSession.teardown();
}

let controlsBound = false;

/** Wire cancel + close controls on the desktop Super Plan overlay. */
export function wireDesktopSuperPlanControls(): void {
  if (controlsBound) {
    return;
  }
  controlsBound = true;
  desktopSession.wireControls();
}

/** Bootstrap Super Plan desktop mode. */
export async function bootstrapDesktopSuperPlan(options?: { seed?: string }): Promise<void> {
  await openSuperPlan(options?.seed);
}

/** Whether a Super Plan run UI is showing (intake or progress). */
export function isDesktopSuperPlanRunning(): boolean {
  return desktopSession.isRunning();
}

/** Test hook: current run state snapshot. */
export function getSuperPlanRunStateForTests(): SuperPlanRunState | null {
  return desktopSession.getRunState();
}
