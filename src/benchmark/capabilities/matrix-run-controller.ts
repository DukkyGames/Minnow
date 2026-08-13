/**
 * Singleton capability-matrix run orchestration (survives Settings navigation).
 */

import {
  clearActiveBenchmarkSession,
  loadActiveBenchmarkSession,
  saveActiveBenchmarkSession,
  type ActiveCapabilityMatrixRunPayload,
} from '../active-run-session.ts';
import type { TestResult } from '../types.ts';
import {
  extractAutoVerdictsFromProbeResults,
  parseCapabilityIdFromTestId,
  parseCapabilityProbeKey,
  type AutoCapabilityVerdict,
} from './merge.ts';
import {
  capabilityProbeLookupFromTest,
  type CapabilityProbeLookup,
} from './cell-transcript.ts';
import { isAbortError } from '../abort.ts';
import { runBenchmarkCampaign } from '../campaign-runner.ts';
import type {
  BenchmarkTarget,
  CampaignProgressEvent,
} from '../campaign-types.ts';
import { targetKeyFromTarget, targetLabel } from '../model-key.ts';
import type { CapabilityMatrixRunOptions } from '../types.ts';
import { CAPABILITY_CATALOG } from './catalog.ts';
import {
  allCapabilityGroupIds,
  capabilityIdsFromProbeKeys,
  type CapabilityMatrixProbeWave,
  resolveMatrixRunFilterSkip,
} from './matrix-run-filters.ts';
import type { CapabilityMatrixRosterEntry } from './roster-store.ts';
import type { CapabilityGroupId } from './types.ts';
import type { CapabilityMatrixViewModel } from './view-model.ts';
import {
  buildResumePayloadFromCampaign,
} from './resume-from-campaign.ts';
import type { BenchmarkCampaign } from '../campaign-types.ts';

export type MatrixTargetChipState = 'pending' | 'running' | 'done' | 'skipped';

export interface MatrixTargetChip {
  targetKey: string;
  label: string;
  state: MatrixTargetChipState;
  detail?: string;
}

export interface MatrixRunUiState {
  running: boolean;
  phaseLabel: string;
  progressPct: number;
  progressDetail: string;
  targets: MatrixTargetChip[];
  campaignId: string | null;
}

export interface StartCapabilityMatrixRunParams {
  roster: CapabilityMatrixRosterEntry[];
  viewModel: CapabilityMatrixViewModel;
  allowSideEffects: boolean;
  skipScored: boolean;
  groupIds: CapabilityGroupId[];
  probeWaves: CapabilityMatrixProbeWave[];
  /** Default false — auto load/unload local models when true (smoke toggle in UI). */
  manageModelLifecycle: boolean;
  /** Resume remaining targets after a full page reload. */
  resumePayload?: ActiveCapabilityMatrixRunPayload;
  onSettled?: () => void;
}

type Listener = (state: MatrixRunUiState) => void;
type ProbeListener = () => void;

const listeners = new Set<Listener>();
const probeListeners = new Set<ProbeListener>();

interface CompletedProbeRecord {
  targetKey: string;
  result: TestResult;
}

let abortController: AbortController | null = null;
let runGeneration = 0;
let uiState: MatrixRunUiState = emptyUiState();

let activeRunPayload: ActiveCapabilityMatrixRunPayload | null = null;
let sessionCompletedTests: TestResult[] = [];
let sessionCompletedProbes: CompletedProbeRecord[] = [];
let testsDone = 0;
let testsTotal = 0;

function newCapabilityMatrixCampaignId(): string {
  return `campaign-${new Date().toISOString().replace(/[:.]/g, '-')}`;
}

function emptyUiState(): MatrixRunUiState {
  return {
    running: false,
    phaseLabel: '',
    progressPct: 0,
    progressDetail: '',
    targets: [],
    campaignId: null,
  };
}

function emit(): void {
  for (const listener of listeners) {
    listener(uiState);
  }
}

function emitProbeUpdate(): void {
  for (const listener of probeListeners) {
    listener();
  }
}

function rebuildCompletedProbesFromSession(
  tests: TestResult[],
  probeKeys: string[] | undefined,
): CompletedProbeRecord[] {
  if (!tests.length || !probeKeys?.length) return [];
  const out: CompletedProbeRecord[] = [];
  const usedTestIdx = new Set<number>();
  for (const probeKey of probeKeys) {
    const parsed = parseCapabilityProbeKey(probeKey);
    if (!parsed) continue;
    const idx = tests.findIndex(
      (test, i) =>
        !usedTestIdx.has(i) &&
        test.suite === 'capability-matrix' &&
        parseCapabilityIdFromTestId(test.testId) === parsed.capabilityId,
    );
    if (idx === -1) continue;
    usedTestIdx.add(idx);
    out.push({ targetKey: parsed.targetKey, result: tests[idx]! });
  }
  return out;
}

function clearSessionProbeState(): void {
  sessionCompletedTests = [];
  sessionCompletedProbes = [];
  emitProbeUpdate();
}

function setUiState(patch: Partial<MatrixRunUiState>): void {
  uiState = { ...uiState, ...patch };
  emit();
}

function enabledTargets(roster: CapabilityMatrixRosterEntry[]): BenchmarkTarget[] {
  return roster.filter((row) => row.enabled !== false);
}

function scoredCapabilityIdsForTarget(
  viewModel: CapabilityMatrixViewModel,
  targetKey: string,
): string[] {
  const ids: string[] = [];
  for (const row of viewModel.rows) {
    const cell = row.cells.find((c) => c.targetKey === targetKey);
    if (!cell) continue;
    if (cell.verdict === 'pass' || cell.verdict === 'partial' || cell.verdict === 'fail') {
      ids.push(row.capabilityId);
    }
  }
  return ids;
}

function mergeSkipCapabilityIds(
  viewModel: CapabilityMatrixViewModel,
  targetKey: string,
  skipScored: boolean,
  extraFromSession: string[],
): string[] | undefined {
  const fromGrid = skipScored ? scoredCapabilityIdsForTarget(viewModel, targetKey) : [];
  const merged = new Set([...fromGrid, ...extraFromSession]);
  return merged.size ? [...merged] : undefined;
}

function countRunnableTests(
  groupIds: CapabilityGroupId[],
  probeWaves: CapabilityMatrixProbeWave[],
  skipScored: boolean,
  viewModel: CapabilityMatrixViewModel,
  targetKey: string,
): number {
  const skipIds = skipScored ? new Set(scoredCapabilityIdsForTarget(viewModel, targetKey)) : null;
  const options: CapabilityMatrixRunOptions = {
    groupIds,
    probeWaves,
    skipScored,
    skipCapabilityIds: skipIds ? [...skipIds] : undefined,
  };
  let count = 0;
  for (const cap of CAPABILITY_CATALOG) {
    if (resolveMatrixRunFilterSkip(cap, options)) continue;
    if (cap.scoreMode === 'manual') continue;
    count += 1;
  }
  return count;
}

function buildCapabilityMatrixOptions(
  params: StartCapabilityMatrixRunParams,
  target: BenchmarkTarget,
  sessionSkips: string[],
): CapabilityMatrixRunOptions {
  const targetKey = targetKeyFromTarget(target);
  const skipCapabilityIds = mergeSkipCapabilityIds(
    params.viewModel,
    targetKey,
    params.skipScored,
    sessionSkips,
  );
  return {
    allowSideEffects: params.allowSideEffects,
    groupIds: params.groupIds,
    probeWaves: params.probeWaves,
    skipScored: params.skipScored,
    skipCapabilityIds,
  };
}

function initTargetChips(targets: BenchmarkTarget[]): MatrixTargetChip[] {
  return targets.map((target) => ({
    targetKey: targetKeyFromTarget(target),
    label: targetLabel(target),
    state: 'pending',
  }));
}

function updateChip(
  chips: MatrixTargetChip[],
  targetKey: string,
  patch: Partial<MatrixTargetChip>,
): MatrixTargetChip[] {
  return chips.map((chip) =>
    chip.targetKey === targetKey ? { ...chip, ...patch } : chip,
  );
}

function persistActiveMatrixSession(
  campaignId: string,
  payload: ActiveCapabilityMatrixRunPayload,
  completedTests: TestResult[],
): void {
  saveActiveBenchmarkSession({
    version: 1,
    runId: campaignId,
    startedAt: new Date().toISOString(),
    preset: 'custom',
    startMode: 'selected',
    campaignKind: 'capability-matrix',
    capabilityMatrixRun: payload,
    suiteIds: ['capability-matrix'],
    modelId: payload.targets[0]?.modelId ?? 'unknown',
    completedSuites: [],
    completedTests,
    status: 'running',
  });
}

function clearActiveMatrixSession(): void {
  clearActiveBenchmarkSession();
  activeRunPayload = null;
}

/** Subscribe to run UI state; dispose only removes the listener (run keeps going). */
export function subscribeCapabilityMatrixRun(listener: Listener): () => void {
  listeners.add(listener);
  listener(uiState);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe to per-probe grid updates while a run is active. */
export function subscribeCapabilityMatrixProbeUpdates(listener: ProbeListener): () => void {
  probeListeners.add(listener);
  listener();
  return () => {
    probeListeners.delete(listener);
  };
}

/** Auto verdicts from probes finished in the current (or resuming) run. */
export function getCapabilityMatrixInFlightAutos(): AutoCapabilityVerdict[] {
  if (!sessionCompletedProbes.length) return [];
  const campaignId = uiState.campaignId ?? 'in-flight';
  return extractAutoVerdictsFromProbeResults(
    sessionCompletedProbes.map((probe) => ({
      targetKey: probe.targetKey,
      result: probe.result,
      campaignId,
    })),
  );
}

/** Latest in-flight probe result for transcript drill-down during an active sweep. */
export function findInFlightCapabilityProbeLookup(
  targetKey: string,
  capabilityId: string,
): CapabilityProbeLookup | null {
  for (let i = sessionCompletedProbes.length - 1; i >= 0; i--) {
    const probe = sessionCompletedProbes[i]!;
    if (probe.targetKey !== targetKey) continue;
    const capId = parseCapabilityIdFromTestId(probe.result.testId);
    if (capId !== capabilityId) continue;
    const campaignId = uiState.campaignId ?? 'in-flight';
    return capabilityProbeLookupFromTest(probe.result, campaignId);
  }
  return null;
}

export function getCapabilityMatrixRunState(): MatrixRunUiState {
  return uiState;
}

export function isCapabilityMatrixRunActive(): boolean {
  return uiState.running;
}

/** Detach all view listeners when leaving Settings (does not abort the run). */
export function disposeCapabilityMatrixRunView(): void {
  listeners.clear();
  probeListeners.clear();
}

export function abortCapabilityMatrixRun(): void {
  runGeneration += 1;
  abortController?.abort();
  abortController = null;
  clearActiveMatrixSession();
  // Keep completed probes on the grid until the user starts a new run.
  setUiState({
    running: false,
    phaseLabel: 'Cancelled',
    progressPct: uiState.progressPct,
  });
  emitProbeUpdate();
}

function handleCampaignProgress(
  event: CampaignProgressEvent,
  chips: MatrixTargetChip[],
): MatrixTargetChip[] {
  switch (event.type) {
    case 'phase':
      setUiState({ phaseLabel: event.label });
      return chips;
    case 'target-start':
      return updateChip(chips, event.targetKey, { state: 'running' });
    case 'target-load-skipped':
      return updateChip(chips, event.targetKey, {
        state: 'skipped',
        detail: event.skipReason,
      });
    case 'target-done':
      return updateChip(chips, event.targetKey, { state: 'done' });
    case 'integration-progress': {
      if (event.event.type === 'test-done') {
        const result = event.event.result;
        if (!result.skipped) {
          testsDone += 1;
          const pct =
            testsTotal > 0 ? Math.round((testsDone / testsTotal) * 100) : 0;
          setUiState({
            progressPct: pct,
            progressDetail: `${testsDone} / ${testsTotal} probes`,
          });
        }
        if (activeRunPayload && result.suite === 'capability-matrix') {
          sessionCompletedTests = [...sessionCompletedTests, result];
          sessionCompletedProbes = [
            ...sessionCompletedProbes,
            { targetKey: event.targetKey, result },
          ];
          emitProbeUpdate();
          const capId = parseCapabilityIdFromTestId(result.testId);
          if (capId) {
            const probeKey = `${event.targetKey}::${capId}`;
            const keys = new Set(activeRunPayload.completedProbeKeys ?? []);
            keys.add(probeKey);
            activeRunPayload = {
              ...activeRunPayload,
              completedProbeKeys: [...keys],
            };
          }
          persistActiveMatrixSession(
            activeRunPayload.campaignId,
            activeRunPayload,
            sessionCompletedTests,
          );
        }
      }
      return chips;
    }
    default:
      return chips;
  }
}

/** Start or resume a capability-matrix campaign for the roster. */
export async function startCapabilityMatrixRun(
  params: StartCapabilityMatrixRunParams,
): Promise<void> {
  const resume = params.resumePayload;
  const rosterTargets = resume
    ? resume.targets.filter(
        (t) => !resume.completedTargetKeys.includes(targetKeyFromTarget(t)),
      )
    : enabledTargets(params.roster);

  if (!rosterTargets.length) {
    return;
  }

  abortController?.abort();
  const generation = ++runGeneration;
  abortController = new AbortController();
  const signal = abortController.signal;

  const groupIds =
    resume?.groupIds?.length
      ? (resume.groupIds as CapabilityGroupId[])
      : params.groupIds.length
        ? params.groupIds
        : allCapabilityGroupIds();
  const probeWaves =
    resume?.probeWaves?.length
      ? (resume.probeWaves as CapabilityMatrixProbeWave[])
      : params.probeWaves;
  const allowSideEffects = resume?.allowSideEffects ?? params.allowSideEffects;
  const skipScored = resume?.skipScored ?? params.skipScored;
  const manageModelLifecycle =
    resume?.manageModelLifecycle ?? params.manageModelLifecycle;

  testsTotal = rosterTargets.reduce(
    (sum, target) =>
      sum +
      countRunnableTests(
        groupIds,
        probeWaves,
        skipScored,
        params.viewModel,
        targetKeyFromTarget(target),
      ),
    0,
  );
  testsDone = 0;

  let chips = initTargetChips(rosterTargets);
  const campaignId = resume?.campaignId ?? newCapabilityMatrixCampaignId();

  const resumeSession = loadActiveBenchmarkSession();
  if (resume && resumeSession?.capabilityMatrixRun?.campaignId === campaignId) {
    sessionCompletedTests = [...(resumeSession.completedTests ?? [])];
    sessionCompletedProbes = rebuildCompletedProbesFromSession(
      sessionCompletedTests,
      resume.completedProbeKeys,
    );
  } else {
    sessionCompletedTests = [];
    sessionCompletedProbes = [];
  }
  emitProbeUpdate();

  activeRunPayload = {
    campaignId,
    targets: resume?.targets ?? enabledTargets(params.roster),
    completedTargetKeys: resume?.completedTargetKeys ?? [],
    allowSideEffects,
    skipScored,
    groupIds,
    probeWaves,
    manageModelLifecycle,
    completedProbeKeys: resume?.completedProbeKeys ?? [],
  };

  setUiState({
    running: true,
    phaseLabel: resume ? 'Resuming capability matrix…' : 'Starting capability matrix…',
    progressPct: 0,
    progressDetail: testsTotal ? `0 / ${testsTotal} probes` : '',
    targets: chips,
    campaignId,
  });

  persistActiveMatrixSession(campaignId, activeRunPayload, sessionCompletedTests);

  const runParams: StartCapabilityMatrixRunParams = {
    ...params,
    allowSideEffects,
    skipScored,
    groupIds,
    probeWaves,
    manageModelLifecycle,
  };

  try {
    await runBenchmarkCampaign({
      campaignId,
      targets: rosterTargets,
      integrationSuites: ['capability-matrix'],
      preset: 'custom',
      signal,
      manageModelLifecycle,
      capabilityMatrix: { allowSideEffects },
      resolveCapabilityMatrixForTarget: (target) => {
        const targetKey = targetKeyFromTarget(target);
        const sessionSkips = runParams.skipScored
          ? capabilityIdsFromProbeKeys(activeRunPayload?.completedProbeKeys, targetKey)
          : [];
        return buildCapabilityMatrixOptions(runParams, target, sessionSkips);
      },
      persistPartialOnCancel: true,
      onProgress: (event) => {
        if (generation !== runGeneration) return;
        chips = handleCampaignProgress(event, chips);
        setUiState({ targets: chips });

        if (event.type === 'target-done' || event.type === 'target-load-skipped') {
          if (activeRunPayload) {
            activeRunPayload = {
              ...activeRunPayload,
              completedTargetKeys: [
                ...activeRunPayload.completedTargetKeys,
                event.targetKey,
              ],
            };
            persistActiveMatrixSession(
              campaignId,
              activeRunPayload,
              sessionCompletedTests,
            );
          }
        }

        if (event.type === 'campaign-done' || event.type === 'campaign-cancelled') {
          clearActiveMatrixSession();
          setUiState({
            running: false,
            phaseLabel:
              event.type === 'campaign-done'
                ? 'Capability matrix complete'
                : 'Run cancelled',
            progressPct: event.type === 'campaign-done' ? 100 : uiState.progressPct,
          });
        }
      },
    });
  } catch (err) {
    if (generation !== runGeneration) return;
    if (!isAbortError(err) && !signal.aborted) {
      setUiState({
        running: false,
        phaseLabel: err instanceof Error ? err.message : String(err),
      });
    }
    clearActiveMatrixSession();
  } finally {
    if (generation !== runGeneration) return;
    abortController = null;
    await Promise.resolve(params.onSettled?.());
  }
}

export interface CapabilityMatrixResumeSummary {
  campaignId: string;
  remainingTargetCount: number;
  completedProbeCount: number;
  payload: ActiveCapabilityMatrixRunPayload;
}

/** Pending capability-matrix sweep in sessionStorage (user must confirm resume). */
export function getCapabilityMatrixResumeSummary(): CapabilityMatrixResumeSummary | null {
  if (isCapabilityMatrixRunActive()) return null;
  const session = loadActiveBenchmarkSession();
  if (!session || session.campaignKind !== 'capability-matrix') return null;
  if (!session.capabilityMatrixRun) return null;
  const remaining = session.capabilityMatrixRun.targets.filter(
    (t) =>
      !session.capabilityMatrixRun!.completedTargetKeys.includes(
        targetKeyFromTarget(t),
      ),
  );
  if (!remaining.length) {
    clearActiveBenchmarkSession();
    return null;
  }
  return {
    campaignId: session.capabilityMatrixRun.campaignId,
    remainingTargetCount: remaining.length,
    completedProbeCount: session.completedTests?.length ?? 0,
    payload: session.capabilityMatrixRun,
  };
}

/** Discard a stale capability-matrix resume session. */
export function dismissCapabilityMatrixResumeSession(): void {
  clearActiveBenchmarkSession();
}

/** Resume an in-flight capability-matrix session (explicit user action). */
export function resumeCapabilityMatrixRunFromSession(
  params: Omit<StartCapabilityMatrixRunParams, 'resumePayload'>,
): void {
  const summary = getCapabilityMatrixResumeSummary();
  if (!summary) return;
  void startCapabilityMatrixRun({
    ...params,
    resumePayload: summary.payload,
  });
}

/** Resume a cancelled capability-matrix campaign from run history. */
export function resumeCapabilityMatrixRunFromCampaign(
  campaign: BenchmarkCampaign,
  params: Omit<StartCapabilityMatrixRunParams, 'resumePayload'>,
): boolean {
  const payload = buildResumePayloadFromCampaign(campaign);
  if (!payload) return false;
  void startCapabilityMatrixRun({
    ...params,
    resumePayload: payload,
  });
  return true;
}

/** @deprecated Auto-resume removed — use resume UI + {@link resumeCapabilityMatrixRunFromSession}. */
export function tryResumeCapabilityMatrixRunFromSession(
  _params: Omit<StartCapabilityMatrixRunParams, 'resumePayload'>,
): void {
  /* no-op: Phase 7 resume banner handles continuation */
}

/** Test hook: replace the in-flight abort controller. */
export function setCapabilityMatrixAbortControllerForTests(
  controller: AbortController | null,
): void {
  abortController = controller;
}

/** Test hook: reset singleton run state between cases. */
export function resetCapabilityMatrixRunControllerForTests(): void {
  runGeneration = 0;
  abortController = null;
  uiState = emptyUiState();
  activeRunPayload = null;
  testsDone = 0;
  testsTotal = 0;
  clearSessionProbeState();
  listeners.clear();
  probeListeners.clear();
}

/** Test hook: seed in-flight probe results without running a campaign. */
export function seedCapabilityMatrixSessionProbesForTests(
  probes: CompletedProbeRecord[],
): void {
  sessionCompletedProbes = [...probes];
  sessionCompletedTests = probes.map((probe) => probe.result);
  emitProbeUpdate();
}
