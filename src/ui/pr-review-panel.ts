import '../styles/pr-review.css';

import { getSubAgentRun } from '../agents/orchestrator.ts';
import { subscribeSubAgentRuns } from '../agents/sub-agent-events.ts';
import type { SubAgentFinding } from '../agents/sub-agent-structured-outcome.ts';
import type { PrReviewRecord } from '../state/pr-review-store.ts';
import { openSubAgentDrawer } from './sub-agent-drawer.ts';
import { subAgentLiveStatusLine } from './sub-agent-live-status.ts';

export type PrReviewVerdict = 'APPROVE' | 'REQUEST_CHANGES' | 'NEEDS_DISCUSSION';

export interface PrReviewPanelActions {
  /** SHA of the PR head now, for the staleness note. */
  currentHeadSha?: string;
  /** Extra commits after the reviewed SHA when the caller already counted them. */
  commitsSince?: number;
  showUpdateIssue?: boolean;
  onMerge?: () => void;
  onFix?: () => void;
  onUpdateIssue?: () => void;
  onOpenChat?: () => void;
  onRetry?: () => void;
}

const SEVERITY_ORDER: Array<NonNullable<SubAgentFinding['severity']>> = ['blocker', 'warn', 'info'];

const SEVERITY_LABEL: Record<string, string> = {
  blocker: 'Blocker',
  warn: 'Should fix',
  info: 'Nit',
};

const VERDICT_LABEL: Record<PrReviewVerdict, string> = {
  APPROVE: 'Approve',
  REQUEST_CHANGES: 'Request changes',
  NEEDS_DISCUSSION: 'Needs discussion',
};

const hostDisposers = new WeakMap<HTMLElement, () => void>();

/** Derive the work-agent verdict from finding severities. */
export function derivePrReviewVerdict(findings: readonly SubAgentFinding[]): PrReviewVerdict {
  let hasWarn = false;
  for (const finding of findings) {
    if (finding.severity === 'blocker') return 'REQUEST_CHANGES';
    if (finding.severity === 'warn') hasWarn = true;
  }
  return hasWarn ? 'NEEDS_DISCUSSION' : 'APPROVE';
}

/** Mount (or replace) the review UI in `host`. */
export function renderPrReviewPanel(
  host: HTMLElement,
  record: PrReviewRecord,
  actions: PrReviewPanelActions = {},
): void {
  hostDisposers.get(host)?.();
  host.replaceChildren();
  host.classList.add('pr-review');
  host.setAttribute('data-status', record.status);

  if (record.status === 'running') {
    hostDisposers.set(host, renderRunning(host, record, actions));
    return;
  }
  if (record.status === 'failed') {
    renderFailed(host, record, actions);
    hostDisposers.set(host, () => undefined);
    return;
  }
  renderDone(host, record, actions);
  hostDisposers.set(host, () => undefined);
}

/** Drop live subscriptions when the host is about to go away. */
export function unmountPrReviewPanel(host: HTMLElement): void {
  hostDisposers.get(host)?.();
  hostDisposers.delete(host);
  host.replaceChildren();
}

function renderRunning(
  host: HTMLElement,
  record: PrReviewRecord,
  actions: PrReviewPanelActions,
): () => void {
  const line = el('button', 'pr-review__live') as HTMLButtonElement;
  line.type = 'button';
  line.setAttribute('aria-live', 'polite');
  line.textContent = liveLine(record);
  line.addEventListener('click', () => {
    if (record.runId && record.chatId) openSubAgentDrawer(record.runId, record.chatId);
    else actions.onOpenChat?.();
  });
  host.append(el('p', 'pr-review__kicker', 'Review running'), line);

  const unsub = subscribeSubAgentRuns((run) => {
    if (run.runId !== record.runId) return;
    line.textContent = subAgentLiveStatusLine(run, true) || 'Working…';
  });
  return unsub;
}

function liveLine(record: PrReviewRecord): string {
  if (!record.runId) return 'Starting review…';
  const run = getSubAgentRun(record.runId);
  if (!run) return 'Reviewing the diff…';
  return subAgentLiveStatusLine(run, true) || 'Reviewing the diff…';
}

function renderFailed(
  host: HTMLElement,
  record: PrReviewRecord,
  actions: PrReviewPanelActions,
): void {
  host.append(el('p', 'pr-review__kicker', 'Review failed'));
  const err = el('p', 'pr-review__error');
  err.setAttribute('role', 'alert');
  err.textContent = record.error?.trim() || 'The reviewer stopped without a result.';
  host.appendChild(err);
  if (actions.onRetry) {
    const row = el('div', 'pr-review__actions');
    row.appendChild(actionButton('Retry', actions.onRetry, 'default'));
    host.appendChild(row);
  }
}

function renderDone(
  host: HTMLElement,
  record: PrReviewRecord,
  actions: PrReviewPanelActions,
): void {
  const verdict = derivePrReviewVerdict(record.findings);
  const counts = countBySeverity(record.findings);

  const head = el('div', 'pr-review__head');
  head.appendChild(verdictChip(verdict));
  const tally = el('p', 'pr-review__tally');
  tally.textContent = `${counts.blocker} blocker · ${counts.warn} should fix · ${counts.info} nit`;
  head.appendChild(tally);
  host.appendChild(head);

  const stale = stalenessNote(record, actions);
  if (stale) host.appendChild(stale);

  if (record.summary.trim()) {
    const summary = el('p', 'pr-review__summary');
    summary.textContent = record.summary.trim();
    host.appendChild(summary);
  }

  for (const severity of SEVERITY_ORDER) {
    const group = record.findings.filter((f) => (f.severity ?? 'info') === severity);
    if (!group.length) continue;
    const section = el('section', 'pr-review__group');
    section.setAttribute('aria-label', SEVERITY_LABEL[severity] ?? severity);
    const heading = el('h3', 'pr-review__group-title', `${SEVERITY_LABEL[severity]} · ${group.length}`);
    section.appendChild(heading);
    for (const finding of group) {
      section.appendChild(findingRow(finding, severity));
    }
    host.appendChild(section);
  }

  const row = el('div', 'pr-review__actions');
  if (actions.onMerge) row.appendChild(actionButton('Merge', actions.onMerge, 'primary'));
  if (actions.onFix) row.appendChild(actionButton('Fix with builder', actions.onFix, 'default'));
  if (actions.showUpdateIssue && actions.onUpdateIssue) {
    row.appendChild(actionButton('Update issue', actions.onUpdateIssue, 'ghost'));
  }
  if (actions.onOpenChat) row.appendChild(actionButton('Open review chat', actions.onOpenChat, 'ghost'));
  if (row.childElementCount) host.appendChild(row);
}

function findingRow(finding: SubAgentFinding, severity: string): HTMLElement {
  const article = el('article', 'pr-review__finding');
  const title = el('h4', 'pr-review__finding-title');
  const mark = el('span', `pr-review__sev pr-review__sev--${severity}`, SEVERITY_LABEL[severity] ?? severity);
  mark.setAttribute('aria-label', SEVERITY_LABEL[severity] ?? severity);
  title.append(mark, document.createTextNode(finding.title));
  article.appendChild(title);

  const detail = el('p', 'pr-review__finding-detail');
  detail.textContent = finding.detail;
  article.appendChild(detail);

  if (finding.paths?.length) {
    const paths = el('div', 'pr-review__paths');
    for (const path of finding.paths) {
      const chip = el('button', 'pr-review__path') as HTMLButtonElement;
      chip.type = 'button';
      chip.textContent = path;
      chip.title = `Open ${path}`;
      chip.addEventListener('click', () => {
        void import('./file-viewer.ts').then((m) => m.openFileInViewer(path));
      });
      paths.appendChild(chip);
    }
    article.appendChild(paths);
  }
  return article;
}

function verdictChip(verdict: PrReviewVerdict): HTMLElement {
  const chip = el('span', `pr-review__verdict pr-review__verdict--${verdict.toLowerCase()}`);
  chip.textContent = VERDICT_LABEL[verdict];
  chip.setAttribute('aria-label', `Verdict: ${VERDICT_LABEL[verdict]}`);
  return chip;
}

function stalenessNote(record: PrReviewRecord, actions: PrReviewPanelActions): HTMLElement | null {
  const reviewed = record.headSha.trim();
  if (!reviewed) return null;
  const short = reviewed.slice(0, 7);
  const current = actions.currentHeadSha?.trim();
  const since = actions.commitsSince;
  const note = el('p', 'pr-review__stale');
  if (typeof since === 'number' && since > 0) {
    note.textContent = `Reviewed at ${short} — ${since} commit${since === 1 ? '' : 's'} since.`;
    return note;
  }
  if (current && current !== reviewed) {
    note.textContent = `Reviewed at ${short} — newer commits landed after this review.`;
    return note;
  }
  note.textContent = `Reviewed at ${short}.`;
  return note;
}

function countBySeverity(findings: readonly SubAgentFinding[]): {
  blocker: number;
  warn: number;
  info: number;
} {
  let blocker = 0;
  let warn = 0;
  let info = 0;
  for (const finding of findings) {
    if (finding.severity === 'blocker') blocker += 1;
    else if (finding.severity === 'warn') warn += 1;
    else info += 1;
  }
  return { blocker, warn, info };
}

function actionButton(
  label: string,
  onClick: () => void,
  variant: 'primary' | 'default' | 'ghost',
): HTMLButtonElement {
  const btn = el('button', `pr-review__btn pr-review__btn--${variant}`) as HTMLButtonElement;
  btn.type = 'button';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
