/**
 * Code app Super Plan surface — intake + pipeline inside the Code chat column.
 */

import '../styles/superplan.css';

import { SuperPlanSession } from '../superplan/run-session';
import { getActiveComposerSurface } from '../ui/composer-surface';

const CODE_SUPER_PLAN_PLACEHOLDER = 'Describe what you want to plan…';
const DEFAULT_COMPOSER_PLACEHOLDER = 'Type a message…';

const codeSession = new SuperPlanSession(
  {
    progressBodyId: 'codeSuperPlanProgressBody',
    resultBodyId: 'codeSuperPlanResultBody',
    cancelBtnId: 'btnCodeSuperPlanCancel',
    closeBtnId: 'btnCodeSuperPlanClose',
  },
  {
    onRunActiveChange: (active) => {
      syncCodeSuperPlanChrome(active || codeSession.isAwaitingPrompt());
    },
    onDeactivate: () => {
      deactivateCodeSuperPlan();
    },
  },
);

let viewEnsured = false;

function getSuperPlanView(): HTMLElement | null {
  return document.getElementById('superPlanView');
}

function getChatViewport(): HTMLElement | null {
  return document.querySelector('.chat-viewport');
}

/** Build the Code Super Plan overlay once (progress + result shells). */
function ensureSuperPlanView(): HTMLElement | null {
  let root = getSuperPlanView();
  if (root) {
    viewEnsured = true;
    return root;
  }

  const viewport = getChatViewport();
  if (!viewport) {
    return null;
  }

  root = document.createElement('div');
  root.id = 'superPlanView';
  root.className = 'superplan-code-view sp hidden';
  root.setAttribute('aria-hidden', 'true');

  const progress = document.createElement('div');
  progress.id = 'codeSuperPlanProgressMount';
  progress.className = 'mn-os-superplan-card mn-os-superplan-progress';
  progress.setAttribute('aria-live', 'polite');

  const progressChrome = document.createElement('div');
  progressChrome.className = 'mn-os-superplan-progress-chrome';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.id = 'btnCodeSuperPlanCancel';
  cancelBtn.className = 'mn-os-superplan-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.hidden = true;

  progressChrome.appendChild(cancelBtn);

  const progressBody = document.createElement('div');
  progressBody.id = 'codeSuperPlanProgressBody';
  progressBody.className = 'mn-os-superplan-progress-body';

  progress.append(progressChrome, progressBody);

  const result = document.createElement('div');
  result.id = 'codeSuperPlanResultMount';
  result.className = 'mn-os-superplan-card mn-os-superplan-result';

  const resultChrome = document.createElement('div');
  resultChrome.className = 'mn-os-superplan-result-chrome';

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.id = 'btnCodeSuperPlanClose';
  closeBtn.className = 'mn-os-superplan-cancel';
  closeBtn.textContent = 'Close';
  closeBtn.hidden = true;

  resultChrome.appendChild(closeBtn);

  const resultBody = document.createElement('div');
  resultBody.id = 'codeSuperPlanResultBody';
  resultBody.className = 'mn-os-superplan-result-body';

  result.append(resultChrome, resultBody);
  root.append(progress, result);

  viewport.insertBefore(root, viewport.firstChild);
  viewEnsured = true;
  codeSession.wireControls();
  return root;
}

function syncComposerPlaceholder(active: boolean): void {
  const input = getActiveComposerSurface().inputEl;
  if (!input) {
    return;
  }
  input.placeholder = active ? CODE_SUPER_PLAN_PLACEHOLDER : DEFAULT_COMPOSER_PLACEHOLDER;
}

function syncCodeSuperPlanChrome(active: boolean): void {
  const view = ensureSuperPlanView();
  const viewport = getChatViewport();
  view?.classList.toggle('hidden', !active);
  view?.toggleAttribute('hidden', !active);
  view?.setAttribute('aria-hidden', active ? 'false' : 'true');
  viewport?.classList.toggle('is-superplan-active', active);
  syncComposerPlaceholder(active);
}

/** Whether Super Plan UI is open in the Code app (idle or running). */
export function isCodeSuperPlanActive(): boolean {
  return codeSession.isEngaged() || Boolean(getSuperPlanView() && !getSuperPlanView()?.hidden);
}

/** Whether Super Plan is waiting for the first composer prompt. */
export function isCodeSuperPlanAwaitingPrompt(): boolean {
  return codeSession.isAwaitingPrompt();
}

/** Open Super Plan inside the Code app. */
export async function openCodeSuperPlan(prompt?: string): Promise<void> {
  const welcome = await import('../ui/welcome-page');
  if (welcome.isWelcomePageOpen()) {
    welcome.closeWelcome({ skipHash: true });
  }

  ensureSuperPlanView();
  syncCodeSuperPlanChrome(true);
  codeSession.wireControls();

  const seed = prompt?.trim();
  if (seed) {
    const input = getActiveComposerSurface().inputEl;
    if (input && !input.value.trim()) {
      input.value = seed;
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    }
    await codeSession.open(seed);
    return;
  }

  await codeSession.open(undefined, { allowIdleWithoutPrompt: true });
}

/** Leave Code Super Plan mode and restore the chat column. */
export function deactivateCodeSuperPlan(): void {
  codeSession.teardown();
  syncCodeSuperPlanChrome(false);
}

/** Cancel the active Code Super Plan run. */
export async function cancelCodeSuperPlan(): Promise<void> {
  await codeSession.cancel();
}

/**
 * Intercept Code composer sends while Super Plan is waiting for the initial prompt.
 * Returns true when the send was consumed.
 */
export function trySubmitCodeSuperPlanFromComposer(text: string): boolean {
  if (!codeSession.trySubmitPrompt(text)) {
    return false;
  }
  const input = getActiveComposerSurface().inputEl;
  if (input) {
    input.value = '';
    input.dispatchEvent(new window.Event('input', { bubbles: true }));
  }
  return true;
}

/** Test hook: current run state snapshot. */
export function getCodeSuperPlanRunStateForTests() {
  return codeSession.getRunState();
}

/** Test hook: reset Code Super Plan module state. */
export function resetCodeSuperPlanForTests(): void {
  deactivateCodeSuperPlan();
}
