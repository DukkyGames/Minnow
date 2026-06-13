/**
 * Multi-model campaign UI: per-target live state, progress cards, and selection.
 */

import type { BenchmarkTarget, ModelAggregate } from '../../benchmark/campaign-types.ts';
import { buildTargetKey, targetKeyFromTarget, targetLabel } from '../../benchmark/model-key.ts';
import type { BenchmarkPreset, BenchmarkRun, SuiteId, TestResult } from '../../benchmark/types.ts';
import type { BenchmarkTranscriptRunMeta } from '../benchmark-transcript-drawer.ts';

export type TargetRunStatus = 'queued' | 'running' | 'done' | 'stopped';

/** Live progress for one model in a multi-target campaign. */
export interface TargetLiveSession {
  targetKey: string;
  label: string;
  status: TargetRunStatus;
  progressPct: number;
  progressLabel: string;
  suiteIds: SuiteId[];
  testResults: Map<string, TestResult>;
  currentTestId: string | null;
  currentTestMeta: { testId: string; suite: SuiteId; label: string } | null;
  suiteIndex: number;
  testsDone: number;
  testsInSuite: number;
  completedRun: BenchmarkRun | null;
  drawerMeta: BenchmarkTranscriptRunMeta | null;
  aggregate: ModelAggregate | null;
}

let sessions = new Map<string, TargetLiveSession>();
let selectedTargetKey: string | null = null;
let campaignActive = false;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatScore(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function isMultiModelCampaignActive(): boolean {
  return campaignActive && sessions.size > 1;
}

export function getSelectedTargetKey(): string | null {
  return selectedTargetKey;
}

export function getTargetSession(targetKey: string): TargetLiveSession | undefined {
  return sessions.get(targetKey);
}

export function getAllTargetSessions(): TargetLiveSession[] {
  return [...sessions.values()];
}

export function findSessionByTestId(testId: string): TargetLiveSession | null {
  for (const session of sessions.values()) {
    if (session.testResults.has(testId)) return session;
    if (session.currentTestId === testId) return session;
  }
  return null;
}

/** Read parallel vs sequential from Run tab toggles. */
export function getCampaignMaxConcurrency(targetCount: number): number {
  if (targetCount <= 1) return 1;
  const group = document.getElementById('benchmarkScheduleToggles');
  const sequential = group?.querySelector<HTMLButtonElement>(
    '[data-schedule="sequential"][aria-pressed="true"]',
  );
  if (sequential) return 1;
  return Math.min(8, targetCount);
}

/** Show schedule controls when roster has more than one model. */
export function syncScheduleSectionVisibility(rosterCount: number): void {
  const section = document.getElementById('benchmarkScheduleSection');
  if (!(section instanceof HTMLElement)) return;
  section.hidden = rosterCount <= 1;
}

export function initMultiModelCampaign(options: {
  targets: BenchmarkTarget[];
  suiteIds: SuiteId[];
  preset: BenchmarkPreset;
  startedAt: string;
}): void {
  sessions = new Map();
  campaignActive = options.targets.length > 1;
  selectedTargetKey = null;

  for (const target of options.targets) {
    const targetKey = targetKeyFromTarget(target);
    sessions.set(targetKey, {
      targetKey,
      label: targetLabel(target),
      status: 'queued',
      progressPct: 0,
      progressLabel: 'Waiting…',
      suiteIds: [...options.suiteIds],
      testResults: new Map(),
      currentTestId: null,
      currentTestMeta: null,
      suiteIndex: 0,
      testsDone: 0,
      testsInSuite: 0,
      completedRun: null,
      drawerMeta: {
        preset: options.preset,
        modelId: target.modelId,
        startedAt: options.startedAt,
      },
      aggregate: null,
    });
  }

  if (campaignActive) {
    selectedTargetKey = options.targets[0] ? targetKeyFromTarget(options.targets[0]) : null;
  }

  renderModelCards();
  setModelCardsVisible(campaignActive);
}

export function clearMultiModelCampaign(): void {
  sessions = new Map();
  selectedTargetKey = null;
  campaignActive = false;
  setModelCardsVisible(false);
  const mount = document.getElementById('benchmarkModelCards');
  if (mount) mount.innerHTML = '';
}

function setModelCardsVisible(visible: boolean): void {
  const mount = document.getElementById('benchmarkModelCards');
  if (mount instanceof HTMLElement) {
    mount.hidden = !visible;
  }
}

export function markTargetRunning(targetKey: string): void {
  const session = sessions.get(targetKey);
  if (!session) return;
  session.status = 'running';
  session.progressLabel = 'Starting tests…';
  if (!selectedTargetKey) selectedTargetKey = targetKey;
  renderModelCards();
}

export function markTargetDone(targetKey: string, aggregate: ModelAggregate): void {
  const session = sessions.get(targetKey);
  if (!session) return;
  session.status = 'done';
  session.progressPct = 100;
  session.progressLabel = 'Finished';
  session.aggregate = aggregate;
  renderModelCards();
}

export function markTargetStopped(targetKey: string): void {
  const session = sessions.get(targetKey);
  if (!session) return;
  if (session.status === 'done') return;
  session.status = 'stopped';
  session.progressLabel = 'Stopped';
  renderModelCards();
}

export function attachCompletedRun(targetKey: string, run: BenchmarkRun): void {
  const session = sessions.get(targetKey);
  if (!session) return;
  session.completedRun = run;
}

export function updateTargetProgress(
  targetKey: string,
  progressPct: number,
  progressLabel: string,
): void {
  const session = sessions.get(targetKey);
  if (!session) return;
  session.progressPct = progressPct;
  session.progressLabel = progressLabel;
  renderModelCards();
}

export function selectTargetCard(
  targetKey: string,
  onSelect: (session: TargetLiveSession) => void,
): void {
  const session = sessions.get(targetKey);
  if (!session) return;
  selectedTargetKey = targetKey;
  renderModelCards();
  onSelect(session);
}

function statusLabel(status: TargetRunStatus): string {
  if (status === 'queued') return 'Waiting';
  if (status === 'running') return 'Running';
  if (status === 'done') return 'Finished';
  return 'Stopped';
}

function cardScoreLine(session: TargetLiveSession): string {
  if (session.aggregate) return formatScore(session.aggregate.totalScore);
  if (session.completedRun) return formatScore(session.completedRun.totalScore);
  if (session.testsDone > 0) {
    const passed = [...session.testResults.values()].filter((t) => t.passed && !t.skipped).length;
    return `${passed}/${session.testsDone} tests`;
  }
  return '—';
}

export function renderModelCards(): void {
  const mount = document.getElementById('benchmarkModelCards');
  if (!mount || !campaignActive) return;

  const cards = [...sessions.values()]
    .map((session) => {
      const isSelected = session.targetKey === selectedTargetKey;
      const pct = Math.max(0, Math.min(100, Math.round(session.progressPct)));
      return `<button type="button" class="benchmark-model-card${isSelected ? ' is-selected' : ''}${session.status === 'running' ? ' is-running' : ''}" data-target-key="${escapeHtml(session.targetKey)}" aria-pressed="${isSelected ? 'true' : 'false'}" aria-label="${escapeHtml(session.label)}, ${statusLabel(session.status)}, ${pct}%">
        <span class="benchmark-model-card-head">
          <span class="benchmark-model-card-title">${escapeHtml(session.label)}</span>
          <span class="benchmark-model-card-score benchmark-mono">${escapeHtml(cardScoreLine(session))}</span>
        </span>
        <span class="benchmark-model-card-status">${escapeHtml(session.progressLabel)}</span>
        <span class="benchmark-model-card-track" aria-hidden="true"><span class="benchmark-model-card-fill" style="width:${pct}%"></span></span>
      </button>`;
    })
    .join('');

  mount.innerHTML = cards;
  mount.setAttribute('role', 'list');
}

export function initModelRunCards(onSelect: (session: TargetLiveSession) => void): void {
  const mount = document.getElementById('benchmarkModelCards');
  if (!mount) return;

  mount.addEventListener('click', (ev) => {
    const card = (ev.target as HTMLElement).closest<HTMLElement>('.benchmark-model-card');
    const key = card?.dataset.targetKey;
    if (!key) return;
    selectTargetCard(key, onSelect);
  });

  for (const btn of document.querySelectorAll<HTMLButtonElement>('.benchmark-schedule-toggle')) {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      const group = document.getElementById('benchmarkScheduleToggles');
      if (!group) return;
      for (const peer of group.querySelectorAll<HTMLButtonElement>('.benchmark-schedule-toggle')) {
        const on = peer === btn;
        peer.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    });
  }
}

export function setScheduleTogglesDisabled(disabled: boolean): void {
  for (const btn of document.querySelectorAll<HTMLButtonElement>('.benchmark-schedule-toggle')) {
    btn.toggleAttribute('disabled', disabled);
  }
}

/** Match a saved run to a roster target key. */
export function targetKeyForRun(run: BenchmarkRun): string {
  return buildTargetKey(run.provider.id, run.model.id);
}
