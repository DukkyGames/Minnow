/**
 * Brain app — Lint section: AI wiki cleanup planner (plan → confirm → execute).
 */

import { executeBrainWikiCleanup, planBrainWikiCleanup } from '../../brain/client';
import type {
  BrainCleanupExecuteLogEntry,
  BrainCleanupPlanResponse,
  BrainCleanupPlanSummaryCounts,
} from '../../brain/types';
import { isLocalServerAvailable } from '../../tools/config';
import { appConfirm } from '../app-dialog';
import {
  preflightBrainCleanupModel,
  resolveBrainCleanupModelBinding,
} from './cleanup-model-binding';
import { renderBrainEmptyState, renderBrainLoading } from './empty-state';
import { navigateBrainGraphPage, renderGraphSection } from './graph-section';
import { renderBrainMarkdown } from './wikilink-markdown';

type LintUiState =
  | { kind: 'empty' }
  | { kind: 'analyzing'; stage: string }
  | {
      kind: 'planReady';
      plan: BrainCleanupPlanResponse;
      binding: { providerId: string; modelId: string };
    }
  | { kind: 'executing'; log: BrainCleanupExecuteLogEntry[] }
  | { kind: 'done'; plan: BrainCleanupPlanResponse; resultText: string; binding: { providerId: string; modelId: string } }
  | { kind: 'error'; message: string };

const ANALYZE_STAGES = [
  'Collecting wiki diagnostics…',
  'Reviewing pages and links…',
  'Drafting cleanup plan…',
] as const;

let sessionState: LintUiState = { kind: 'empty' };
let analyzeStageTimer: ReturnType<typeof setInterval> | null = null;
let lintToolbarBound = false;

function getLintMount(): HTMLElement | null {
  return document.getElementById('brainLintBody');
}

function setOfflineVisible(visible: boolean): void {
  const offlineEl = document.getElementById('brainLintOffline');
  offlineEl?.classList.toggle('hidden', !visible);
}

function syncPlanIdDataset(mount: HTMLElement, planId: string | undefined): void {
  if (planId?.trim()) {
    mount.dataset.planId = planId.trim();
  } else {
    delete mount.dataset.planId;
  }
}

function stopAnalyzeStageTimer(): void {
  if (analyzeStageTimer) {
    clearInterval(analyzeStageTimer);
    analyzeStageTimer = null;
  }
}

function startAnalyzeStageTimer(onStage: (message: string) => void): void {
  stopAnalyzeStageTimer();
  let index = 0;
  onStage(ANALYZE_STAGES[0]);
  analyzeStageTimer = setInterval(() => {
    index = Math.min(index + 1, ANALYZE_STAGES.length - 1);
    onStage(ANALYZE_STAGES[index]);
  }, 2200);
}

function renderAnalyzing(mount: HTMLElement, stage: string): void {
  renderBrainLoading(mount, stage);
}

function formatSummaryChipLabel(key: keyof BrainCleanupPlanSummaryCounts): string {
  switch (key) {
    case 'deletes':
      return 'Deletes';
    case 'merges':
      return 'Merges';
    case 'linkFixes':
      return 'Link fixes';
    case 'staleActions':
      return 'Stale actions';
    case 'anchorDrift':
      return 'Anchor drift';
    case 'risks':
      return 'Risks';
    default:
      return key;
  }
}

function renderSummaryChips(summary: BrainCleanupPlanSummaryCounts): HTMLElement {
  const row = document.createElement('div');
  row.className = 'brain-cleanup-summary';
  row.setAttribute('role', 'list');
  const keys: Array<keyof BrainCleanupPlanSummaryCounts> = [
    'deletes',
    'merges',
    'linkFixes',
    'staleActions',
    'anchorDrift',
    'risks',
  ];
  for (const key of keys) {
    const value = summary[key] ?? 0;
    if (value <= 0) continue;
    const chip = document.createElement('span');
    chip.className = 'brain-cleanup-summary__chip';
    chip.setAttribute('role', 'listitem');
    chip.textContent = `${formatSummaryChipLabel(key)}: ${value}`;
    row.append(chip);
  }
  if (!row.children.length) {
    const none = document.createElement('p');
    none.className = 'brain-muted';
    none.textContent = 'No structured actions — review the plan below.';
    row.append(none);
  }
  return row;
}

function renderPlanActions(
  mount: HTMLElement,
  plan: BrainCleanupPlanResponse,
  binding: { providerId: string; modelId: string },
  options?: { showDoneHint?: boolean },
): void {
  const actions = document.createElement('div');
  actions.className = 'brain-cleanup-actions';

  const runBtn = document.createElement('button');
  runBtn.type = 'button';
  runBtn.className = 'brain-action-btn is-primary';
  runBtn.textContent = 'Run cleanup';
  runBtn.addEventListener('click', () => {
    void runCleanupExecute(plan, binding);
  });

  const regenBtn = document.createElement('button');
  regenBtn.type = 'button';
  regenBtn.className = 'brain-action-btn';
  regenBtn.textContent = 'Regenerate plan';
  regenBtn.addEventListener('click', () => {
    void generateCleanupPlan();
  });

  actions.append(runBtn, regenBtn);

  if (options?.showDoneHint) {
    const graphBtn = document.createElement('button');
    graphBtn.type = 'button';
    graphBtn.className = 'brain-action-btn';
    graphBtn.textContent = 'Open graph';
    graphBtn.addEventListener('click', () => {
      void import('../brain-page').then((m) => m.openBrain('graph'));
    });
    actions.append(graphBtn);
  }

  mount.append(actions);
}

function renderPlanReady(
  mount: HTMLElement,
  plan: BrainCleanupPlanResponse,
  binding: { providerId: string; modelId: string },
  options?: { showDoneHint?: boolean },
): void {
  mount.replaceChildren();
  syncPlanIdDataset(mount, plan.planId);

  mount.append(renderSummaryChips(plan.summary));

  const planMount = document.createElement('div');
  planMount.className = 'brain-cleanup-plan';
  renderBrainMarkdown(planMount, plan.planMarkdown, navigateBrainGraphPage);
  mount.append(planMount);

  renderPlanActions(mount, plan, binding, options);
}

function appendExecutionLog(container: HTMLElement, entries: BrainCleanupExecuteLogEntry[]): void {
  container.replaceChildren();
  const list = document.createElement('ul');
  list.className = 'brain-cleanup-log';
  for (const entry of entries) {
    const li = document.createElement('li');
    li.className = 'brain-cleanup-log__line';
    const parts: string[] = [];
    if (entry.tool) parts.push(`[${entry.tool}]`);
    if (entry.path) parts.push(entry.path);
    parts.push(entry.message);
    li.textContent = parts.join(' ');
    list.append(li);
  }
  container.append(list);
  container.scrollTop = container.scrollHeight;
}

function renderExecuting(mount: HTMLElement, log: BrainCleanupExecuteLogEntry[]): void {
  mount.replaceChildren();
  const heading = document.createElement('p');
  heading.className = 'brain-muted';
  heading.textContent = 'Running cleanup…';
  const logMount = document.createElement('div');
  logMount.className = 'brain-cleanup-log-mount';
  mount.append(heading, logMount);
  appendExecutionLog(logMount, log);
}

function renderDone(
  mount: HTMLElement,
  plan: BrainCleanupPlanResponse,
  resultText: string,
  binding: { providerId: string; modelId: string },
): void {
  mount.replaceChildren();
  syncPlanIdDataset(mount, plan.planId);

  const outcome = document.createElement('p');
  outcome.className = 'brain-cleanup-outcome';
  outcome.textContent = resultText || 'Cleanup finished.';

  mount.append(outcome, renderSummaryChips(plan.summary));

  const planMount = document.createElement('div');
  planMount.className = 'brain-cleanup-plan';
  renderBrainMarkdown(planMount, plan.planMarkdown, navigateBrainGraphPage);
  mount.append(planMount);

  renderPlanActions(mount, plan, binding, { showDoneHint: true });
}

function renderError(mount: HTMLElement, message: string): void {
  mount.replaceChildren();
  syncPlanIdDataset(mount, undefined);
  const err = document.createElement('p');
  err.className = 'brain-error';
  err.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'brain-action-btn is-primary';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => {
    sessionState = { kind: 'empty' };
    paintLintState();
  });
  mount.append(err, retry);
}

function renderEmpty(mount: HTMLElement): void {
  syncPlanIdDataset(mount, undefined);
  renderBrainEmptyState(mount, {
    icon: 'sparkle',
    title: 'Wiki cleanup plan',
    message:
      'Scan your wiki read-only, then draft a markdown plan with the model selected in the top bar.',
    ctaLabel: 'Generate plan',
    onCta: () => {
      void generateCleanupPlan();
    },
  });
}

function paintLintState(): void {
  const mount = getLintMount();
  if (!mount) return;

  setOfflineVisible(!isLocalServerAvailable());

  switch (sessionState.kind) {
    case 'empty':
      renderEmpty(mount);
      break;
    case 'analyzing':
      renderAnalyzing(mount, sessionState.stage);
      break;
    case 'planReady':
      renderPlanReady(mount, sessionState.plan, sessionState.binding);
      break;
    case 'executing':
      renderExecuting(mount, sessionState.log);
      break;
    case 'done':
      renderDone(mount, sessionState.plan, sessionState.resultText, sessionState.binding);
      break;
    case 'error':
      renderError(mount, sessionState.message);
      break;
    default:
      renderEmpty(mount);
  }
}

function buildExecuteConfirmMessage(summary: BrainCleanupPlanSummaryCounts): string {
  const parts: string[] = [];
  if (summary.deletes > 0) parts.push(`${summary.deletes} delete(s)`);
  if (summary.merges > 0) parts.push(`${summary.merges} merge(s)`);
  if (summary.linkFixes > 0) parts.push(`${summary.linkFixes} link fix(es)`);
  if (summary.staleActions > 0) parts.push(`${summary.staleActions} stale action(s)`);
  if (summary.anchorDrift > 0) parts.push(`${summary.anchorDrift} anchor update(s)`);
  const detail =
    parts.length > 0
      ? ` Planned changes include ${parts.join(', ')}.`
      : '';
  return `Run the cleanup agent on this plan? This may delete or rewrite wiki pages.${detail}`;
}

async function generateCleanupPlan(): Promise<void> {
  const mount = getLintMount();
  if (!mount) return;

  if (!isLocalServerAvailable()) {
    setOfflineVisible(true);
    sessionState = {
      kind: 'error',
      message: 'Start Minnow to generate a cleanup plan.',
    };
    paintLintState();
    return;
  }

  const binding = await resolveBrainCleanupModelBinding();
  const preflight = preflightBrainCleanupModel(binding);
  if (preflight) {
    sessionState = { kind: 'error', message: preflight };
    paintLintState();
    return;
  }

  sessionState = { kind: 'analyzing', stage: ANALYZE_STAGES[0] };
  paintLintState();
  startAnalyzeStageTimer((stage) => {
    if (sessionState.kind !== 'analyzing') return;
    sessionState = { kind: 'analyzing', stage };
    const analyzingMount = getLintMount();
    if (analyzingMount) renderAnalyzing(analyzingMount, stage);
  });

  const plan = await planBrainWikiCleanup(binding);
  stopAnalyzeStageTimer();

  if (!plan?.planId || !plan.planMarkdown) {
    sessionState = {
      kind: 'error',
      message: 'Plan generation failed. Check the top-bar model and try again.',
    };
    paintLintState();
    return;
  }

  sessionState = { kind: 'planReady', plan, binding };
  paintLintState();
}

async function runCleanupExecute(
  plan: BrainCleanupPlanResponse,
  binding: { providerId: string; modelId: string },
): Promise<void> {
  const preflight = preflightBrainCleanupModel(binding);
  if (preflight) {
    sessionState = { kind: 'error', message: preflight };
    paintLintState();
    return;
  }

  const ok = await appConfirm(buildExecuteConfirmMessage(plan.summary), {
    confirmLabel: 'Run cleanup',
    danger: true,
  });
  if (!ok) return;

  sessionState = { kind: 'executing', log: [] };
  paintLintState();

  const result = await executeBrainWikiCleanup({
    planId: plan.planId,
    providerId: binding.providerId,
    modelId: binding.modelId,
  });

  if (!result) {
    sessionState = {
      kind: 'error',
      message: 'Cleanup failed. Open Minnow and try again.',
    };
    paintLintState();
    return;
  }

  if (result.log.length > 0) {
    sessionState = { kind: 'executing', log: result.log };
    paintLintState();
  }

  if (!result.ok) {
    sessionState = {
      kind: 'error',
      message: result.error?.trim() || 'Cleanup did not complete successfully.',
    };
    paintLintState();
    return;
  }

  await renderGraphSection();

  const resultText =
    result.result?.trim() ||
    `Completed ${result.log.length} step(s). Review the graph for updated pages.`;
  sessionState = { kind: 'done', plan, resultText, binding };
  paintLintState();
}

function bindLintToolbar(): void {
  if (lintToolbarBound) return;
  lintToolbarBound = true;
  document.getElementById('brainLintRun')?.addEventListener('click', () => {
    void generateCleanupPlan();
  });
}

/** Mount lint / cleanup planner UI and restore in-session plan state. */
export async function renderLintSection(): Promise<void> {
  bindLintToolbar();
  paintLintState();
}
