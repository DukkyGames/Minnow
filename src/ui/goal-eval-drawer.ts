/**
 * Goal evaluator overlay — inset sheet over the chat column (read-only, sub-agent family).
 */

import {
  getGoalEvalSession,
  subscribeGoalEvalSessions,
  type GoalEvalSession,
} from '../chat/goal/eval-session';
import { findChatById } from '../state/sessions';
import { humanizeToolName } from './tool-messages';
import { renderTranscriptView } from './transcript-view.ts';

type StatusTone = 'working' | 'done' | 'failed';

interface OverlayState {
  root: HTMLElement;
  sheet: HTMLElement;
  chatId: string;
  returnFocus: HTMLElement | null;
  onKey: (e: KeyboardEvent) => void;
  headingType: HTMLElement;
  statusDot: HTMLElement;
  statusText: HTMLElement;
  startedEl: HTMLElement;
  endedEl: HTMLElement;
  promptText: HTMLElement;
  promptToggle: HTMLButtonElement;
  summaryRoot: HTMLElement;
  scroll: HTMLElement;
  transcriptDetails: HTMLDetailsElement;
  transcriptBody: HTMLElement;
  footer: HTMLElement;
}

let overlay: OverlayState | null = null;
let subscriptionBound = false;

function statusMeta(session: GoalEvalSession): { label: string; tone: StatusTone } {
  if (session.status === 'failed') return { label: 'Failed', tone: 'failed' };
  if (session.status === 'completed') {
    return session.met ? { label: 'Passed', tone: 'done' } : { label: 'Not yet', tone: 'working' };
  }
  return { label: 'Evaluating', tone: 'working' };
}

function formatTimestamp(ms: number | undefined): string | null {
  if (ms == null || !Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleString();
}

function liveStatusLine(session: GoalEvalSession): string {
  const toolName = session.liveCurrentToolName?.trim();
  if (toolName) return `Calling ${humanizeToolName(toolName)}…`;
  if (session.status === 'running') return 'Verifying goal completion…';
  return '';
}

function renderSummary(root: HTMLElement, session: GoalEvalSession): void {
  root.replaceChildren();
  if (session.status === 'running') {
    const line = liveStatusLine(session);
    if (line) {
      const p = document.createElement('p');
      p.className = 'sub-agent-overlay__summary';
      p.textContent = line;
      root.appendChild(p);
    }
    return;
  }

  if (session.reason?.trim()) {
    const p = document.createElement('p');
    p.className = 'sub-agent-overlay__summary';
    p.textContent = session.reason.trim();
    root.appendChild(p);
  }

  if (session.rawVerdict?.trim()) {
    const pre = document.createElement('pre');
    pre.className = 'sub-agent-overlay__summary sub-agent-overlay__summary--raw';
    pre.textContent = session.rawVerdict.trim();
    root.appendChild(pre);
  }
}

function renderSession(state: OverlayState, opts: { scroll: 'end' | 'sticky' }): void {
  const session = getGoalEvalSession(state.chatId);
  if (!session) {
    closeGoalEvalDrawer();
    return;
  }

  const { label, tone } = statusMeta(session);
  const wasNearBottom =
    state.scroll.scrollHeight - state.scroll.scrollTop - state.scroll.clientHeight < 48;

  state.sheet.setAttribute('aria-label', `Goal evaluator, ${label}`);
  state.headingType.textContent = 'Goal evaluator';
  state.statusText.textContent = label;
  state.statusDot.className = `sub-agent-overlay__dot sub-agent-overlay__dot--${tone}`;

  const started = formatTimestamp(session.startedAt);
  state.startedEl.textContent = started ? `Started ${started}` : '';

  const ended = formatTimestamp(session.endedAt);
  state.endedEl.textContent = ended ? `Ended ${ended}` : '';
  state.endedEl.hidden = !ended;

  const condition =
    session.conditionText.trim() ||
    findChatById(state.chatId)?.activeGoal?.conditionText?.trim() ||
    '(no condition)';
  state.promptText.textContent = condition;
  state.promptText.classList.add('is-clamped');
  state.promptToggle.hidden = true;
  state.promptToggle.textContent = 'Show more';
  state.promptToggle.setAttribute('aria-expanded', 'false');
  requestAnimationFrame(() => {
    if (!overlay || overlay !== state) return;
    const overflowing = state.promptText.scrollHeight - state.promptText.clientHeight > 2;
    state.promptToggle.hidden = !overflowing;
  });

  renderSummary(state.summaryRoot, session);
  state.transcriptDetails.open = session.status === 'running' || !session.reason?.trim();
  renderTranscriptView(state.transcriptBody, session.messages as unknown[]);

  state.footer.replaceChildren();
  const line = liveStatusLine(session);
  state.footer.hidden = !line;
  if (line) {
    const span = document.createElement('span');
    span.className = 'sub-agent-overlay__footer-status';
    span.textContent = line;
    state.footer.appendChild(span);
  }

  const shouldScroll = opts.scroll === 'end' || (opts.scroll === 'sticky' && wasNearBottom);
  if (shouldScroll && state.transcriptDetails.open) {
    state.scroll.scrollTop = state.scroll.scrollHeight;
  }
}

function bindSubscription(): void {
  if (subscriptionBound) return;
  subscriptionBound = true;
  subscribeGoalEvalSessions((session) => {
    if (!overlay || overlay.chatId !== session.chatId) return;
    renderSession(overlay, { scroll: 'sticky' });
  });
}

function handleKey(e: KeyboardEvent): void {
  if (!overlay) return;
  if (e.key === 'Escape') {
    e.preventDefault();
    closeGoalEvalDrawer();
    return;
  }
  if (e.key !== 'Tab') return;
  const focusables = overlay.sheet.querySelectorAll<HTMLElement>(
    'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])',
  );
  const visible = [...focusables].filter((el) => !el.hidden && el.offsetParent !== null);
  if (visible.length === 0) return;
  const first = visible[0];
  const last = visible[visible.length - 1];
  const active = document.activeElement as HTMLElement | null;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Wire overlay refresh to goal-eval session pub/sub. */
export function initGoalEvalDrawerLiveUpdates(): void {
  bindSubscription();
}

export function closeGoalEvalDrawer(): void {
  if (!overlay) return;
  const state = overlay;
  overlay = null;
  document.removeEventListener('keydown', state.onKey, true);

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cleanup = (): void => {
    state.root.remove();
    if (state.returnFocus?.isConnected) state.returnFocus.focus();
  };
  if (reduce) {
    cleanup();
    return;
  }
  state.root.classList.remove('is-open');
  state.root.classList.add('is-closing');
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    cleanup();
  };
  state.sheet.addEventListener('transitionend', finish, { once: true });
  window.setTimeout(finish, 260);
}

/** Opens the goal-evaluator overlay for the given chat. */
export function openGoalEvalDrawer(chatId: string): void {
  bindSubscription();
  const id = chatId.trim();
  if (!id || !getGoalEvalSession(id)) return;

  const returnFocus = (document.activeElement as HTMLElement | null) ?? null;
  closeGoalEvalDrawer();

  const main = document.getElementById('mainColumn');
  if (!main) return;

  const root = document.createElement('div');
  root.className = 'sub-agent-overlay sub-agent-overlay--goal-eval';

  const scrim = document.createElement('div');
  scrim.className = 'sub-agent-overlay__scrim';
  scrim.setAttribute('role', 'presentation');
  scrim.addEventListener('click', () => closeGoalEvalDrawer());

  const sheet = document.createElement('div');
  sheet.className = 'sub-agent-overlay__sheet';
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');

  const header = document.createElement('header');
  header.className = 'sub-agent-overlay__header';

  const heading = document.createElement('div');
  heading.className = 'sub-agent-overlay__heading';
  const kicker = document.createElement('span');
  kicker.className = 'sub-agent-overlay__kicker';
  kicker.textContent = 'Goal';
  const headingType = document.createElement('h2');
  headingType.className = 'sub-agent-overlay__title';
  const status = document.createElement('span');
  status.className = 'sub-agent-overlay__status';
  const statusDot = document.createElement('span');
  statusDot.className = 'sub-agent-overlay__dot';
  statusDot.setAttribute('aria-hidden', 'true');
  const statusText = document.createElement('span');
  statusText.className = 'sub-agent-overlay__status-text';
  status.appendChild(statusDot);
  status.appendChild(statusText);
  heading.appendChild(kicker);
  heading.appendChild(headingType);
  heading.appendChild(status);

  const tools = document.createElement('div');
  tools.className = 'sub-agent-overlay__tools';
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.className = 'sub-agent-overlay__icon-btn';
  closeBtn.setAttribute('aria-label', 'Close');
  closeBtn.title = 'Close';
  closeBtn.innerHTML = closeIconSvg();
  closeBtn.addEventListener('click', () => closeGoalEvalDrawer());
  tools.appendChild(closeBtn);
  header.appendChild(heading);
  header.appendChild(tools);

  const meta = document.createElement('div');
  meta.className = 'sub-agent-overlay__meta';
  const startedEl = document.createElement('span');
  startedEl.className = 'sub-agent-overlay__run-id';
  const endedEl = document.createElement('span');
  endedEl.className = 'sub-agent-overlay__ended';
  endedEl.hidden = true;
  meta.appendChild(startedEl);
  meta.appendChild(endedEl);

  const promptWrap = document.createElement('section');
  promptWrap.className = 'sub-agent-overlay__prompt';
  const promptLabel = document.createElement('span');
  promptLabel.className = 'sub-agent-overlay__prompt-label';
  promptLabel.textContent = 'Completion condition';
  const promptText = document.createElement('p');
  promptText.className = 'sub-agent-overlay__prompt-text is-clamped';
  const promptToggle = document.createElement('button');
  promptToggle.type = 'button';
  promptToggle.className = 'sub-agent-overlay__prompt-toggle';
  promptToggle.hidden = true;
  promptToggle.textContent = 'Show more';
  promptToggle.setAttribute('aria-expanded', 'false');
  promptToggle.addEventListener('click', () => {
    const clamped = promptText.classList.toggle('is-clamped');
    promptToggle.textContent = clamped ? 'Show more' : 'Show less';
    promptToggle.setAttribute('aria-expanded', String(!clamped));
  });
  promptWrap.appendChild(promptLabel);
  promptWrap.appendChild(promptText);
  promptWrap.appendChild(promptToggle);

  const scroll = document.createElement('div');
  scroll.className = 'sub-agent-overlay__scroll';
  const summaryRoot = document.createElement('div');
  summaryRoot.className = 'sub-agent-overlay__structured';
  const transcriptDetails = document.createElement('details');
  transcriptDetails.className = 'sub-agent-overlay__activity';
  transcriptDetails.open = true;
  const transcriptSummary = document.createElement('summary');
  transcriptSummary.textContent = 'Activity';
  const transcriptBody = document.createElement('div');
  transcriptBody.className = 'sub-agent-overlay__body';
  transcriptDetails.appendChild(transcriptSummary);
  transcriptDetails.appendChild(transcriptBody);
  scroll.appendChild(summaryRoot);
  scroll.appendChild(transcriptDetails);

  const footer = document.createElement('footer');
  footer.className = 'sub-agent-overlay__footer';
  footer.hidden = true;

  sheet.appendChild(header);
  sheet.appendChild(meta);
  sheet.appendChild(promptWrap);
  sheet.appendChild(scroll);
  sheet.appendChild(footer);
  root.appendChild(scrim);
  root.appendChild(sheet);
  main.appendChild(root);

  const onKey = (e: KeyboardEvent): void => handleKey(e);
  document.addEventListener('keydown', onKey, true);

  overlay = {
    root,
    sheet,
    chatId: id,
    returnFocus,
    onKey,
    headingType,
    statusDot,
    statusText,
    startedEl,
    endedEl,
    promptText,
    promptToggle,
    summaryRoot,
    scroll,
    transcriptDetails,
    transcriptBody,
    footer,
  };

  renderSession(overlay, { scroll: 'end' });
  requestAnimationFrame(() => {
    if (overlay?.root === root) root.classList.add('is-open');
  });
  closeBtn.focus();
}

function closeIconSvg(): string {
  return (
    '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" ' +
    'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
    'stroke-linejoin="round" aria-hidden="true">' +
    '<path d="M3.5 3.5L12.5 12.5"/><path d="M12.5 3.5L3.5 12.5"/></svg>'
  );
}
