/**
 * Super Plan stage runners — one function per pipeline stage.
 */

import type { AggregateResult } from '../../agents/types';
import { spawnSubAgent, waitForSubAgent } from '../../agents/orchestrator';
import {
  getSuperPlanConfigSync,
  loadSuperPlanConfig,
  resolveSuperPlanResearchMaxRounds,
  type SuperPlanStageModelBinding,
} from '../../config/super-plan-meta';
import { fetchSkillById } from '../../skills/client';
import { findLastPlanSavePath } from '../orchestrate/plan-from-history';
import { isSuperPlanReferenceArtifactPath } from '../modes/plan-write-guard';
import { isFirstUserMessagePending } from '../titles/schedule';
import {
  cancelResearch,
  fetchResearchResult,
  fetchResearchStatus,
  startResearch,
} from '../../research/client';
import type { Chat } from '../../types';
import { isServerEngineEnabled } from '../../state/server-engine-flag.ts';
import { dispatchSendMessageAndAwaitIdle } from '../../state/session-commands.ts';
import { detectLocalServer, executeTool } from '../../tools/client';
import { buildHistoryUserContent, runChatTurn } from '../../tools/loop';
import { newestRun } from '../../state/runs-store';
import {
  adaptGrillingSkillForSuperPlan,
  buildSuperPlanGrillStageUserText,
} from './grill-prompt';
import {
  composeSuperPlanImpeccableStage,
  shouldRunImpeccableStage,
} from './impeccable-stage';
import {
  buildPlanReviewerTask,
  formatReviewCritiqueForPass2,
  planInvolvesUi,
} from './review-helpers';
import {
  shouldRunSuperPlanImpeccable,
  superPlanDraftPassForStage,
  superPlanReviewPassForStage,
} from './pipeline';
import {
  ensureSuperPlanState,
  markSuperPlanStageStatus,
  patchSuperPlanState,
  superPlanPlanPath,
} from './state';
import type { SuperPlanStageId } from './types';

export type SuperPlanStageOutcome =
  | { kind: 'await_stream' }
  | { kind: 'blocked_user'; artifactPath?: string }
  | { kind: 'done'; artifactPath?: string }
  | { kind: 'skipped' }
  /** Stage bowed out because the user paused the pipeline (stage reruns on resume). */
  | { kind: 'paused' };

export interface SuperPlanStageRunHooks {
  /** Fires after Deep Research starts so the progress UI can subscribe to the stream. */
  onResearchStarted?: (researchId: string) => void;
}

async function runChatTurnForStage(
  chat: Chat,
  stageId: SuperPlanStageId,
  userText: string,
  skillId: string | null,
  skillBody: string | null,
  modelOverride?: SuperPlanStageModelBinding,
): Promise<'engine' | 'renderer'> {
  const savedProvider = chat.providerId;
  const savedModel = chat.modelId;
  if (modelOverride?.providerId?.trim()) {
    chat.providerId = modelOverride.providerId.trim();
  }
  if (modelOverride?.modelId?.trim()) {
    chat.modelId = modelOverride.modelId.trim();
  }
  try {
    // Engine default-on: dispatch + await idle (no renderer runChatTurn / double-drive).
    // skillBody + superPlanStage tagging stay renderer-only until the engine ports them.
    if (isServerEngineEnabled()) {
      const text = skillId ? `/${skillId} ${userText}` : userText;
      await dispatchSendMessageAndAwaitIdle({
        chatId: chat.id,
        text,
        historyContent: buildHistoryUserContent(userText, []),
        skillId,
        modelId: chat.modelId,
        providerId: chat.providerId,
      });
      return 'engine';
    }

    await detectLocalServer();
    const displayText = userText;
    const historyContent = buildHistoryUserContent(displayText, []);
    const titleSeed = chat.superPlan?.prompt?.trim() || userText;
    await runChatTurn({
      chat,
      pushUser: true,
      rawText: userText,
      userText,
      skillId,
      displayText,
      historyContent,
      validAttachments: [],
      titleSeed,
      shouldScheduleTitle: isFirstUserMessagePending(chat),
      skillBody,
      superPlanStage: stageId,
    });
    return 'renderer';
  } finally {
    chat.providerId = savedProvider;
    chat.modelId = savedModel;
  }
}

/** Classify one get_file_metadata probe for {@link fileExists}. */
async function probeFileMetadata(path: string): Promise<'exists' | 'missing' | 'error'> {
  let result: { content?: string };
  try {
    result = await executeTool('get_file_metadata', { path });
  } catch {
    return 'error';
  }
  const content = result.content ?? '';
  if (!content.trimStart().startsWith('Error:')) return 'exists';
  if (/enoent|no such file/i.test(content)) return 'missing';
  return 'error';
}

/**
 * True when `path` exists in the workspace, false when it genuinely doesn't.
 * A transient tools-server error is retried once, then throws a distinct
 * error instead of reporting `false` — a hiccup here must not read as
 * "the plan wasn't saved".
 */
async function fileExists(path: string): Promise<boolean> {
  const first = await probeFileMetadata(path);
  if (first !== 'error') return first === 'exists';

  await new Promise((resolve) => setTimeout(resolve, 1000));
  const retry = await probeFileMetadata(path);
  if (retry !== 'error') return retry === 'exists';
  throw new Error(`Could not verify the save (tools server error): ${path}`);
}

async function readFileOrEmpty(path: string | undefined): Promise<string> {
  if (!path) return '';
  try {
    const result = await executeTool('read_file', { path });
    return result.content?.trim() ?? '';
  } catch {
    return '';
  }
}

const RESEARCH_POLL_INTERVAL_MS = 3000;
const RESEARCH_TIMEOUT_MS = 30 * 60 * 1000;
const RESEARCH_MAX_CONSECUTIVE_POLL_FAILURES = 5;
const REVIEW_SUB_AGENT_TIMEOUT_MS = 20 * 60 * 1000;

type ResearchWaitResult = { kind: 'done'; report: string } | { kind: 'paused' };

/**
 * Poll a Deep Research run until it finishes. Tolerates transient status-poll
 * failures, honors pipeline pause/cancel, and times out after 30 minutes with
 * an actionable error (the stage can be retried from the plan screen).
 */
async function waitForResearchDone(
  chat: Chat,
  researchId: string,
): Promise<ResearchWaitResult> {
  const deadline = Date.now() + RESEARCH_TIMEOUT_MS;
  let consecutiveFailures = 0;
  for (;;) {
    if (chat.superPlan?.cancelled) {
      void cancelResearch(researchId).catch(() => undefined);
      throw new Error('Super Plan cancelled');
    }
    if (chat.superPlan?.paused) {
      return { kind: 'paused' };
    }
    let status;
    try {
      status = await fetchResearchStatus(researchId);
      consecutiveFailures = 0;
    } catch (err) {
      consecutiveFailures += 1;
      if (consecutiveFailures >= RESEARCH_MAX_CONSECUTIVE_POLL_FAILURES) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Research status unavailable after ${consecutiveFailures} attempts (${message}). ` +
            'Retry the stage to reattach or start a new research run.',
        );
      }
      await new Promise((resolve) => setTimeout(resolve, RESEARCH_POLL_INTERVAL_MS));
      continue;
    }
    if (status.status === 'done') {
      const result = await fetchResearchResult(researchId);
      return { kind: 'done', report: result.result?.trim() ?? '' };
    }
    if (status.status === 'error' || status.status === 'cancelled') {
      throw new Error(
        `Research ${status.status}${status.status === 'error' ? ' — retry the stage to run it again' : ''}`,
      );
    }
    if (Date.now() >= deadline) {
      throw new Error(
        'Research timed out after 30 minutes. Retry the stage to reattach or start a new run.',
      );
    }
    await new Promise((resolve) => setTimeout(resolve, RESEARCH_POLL_INTERVAL_MS));
  }
}

function isAggregateResult(value: unknown): value is AggregateResult {
  return (
    value != null &&
    typeof value === 'object' &&
    'runId' in value &&
    'outcome' in value
  );
}

/** Friendly message shared by both timeout detection paths (abort + type-level timer). */
function reviewTimeoutError(pass: number): Error {
  return new Error(
    `Plan review (pass ${pass}) timed out after ${REVIEW_SUB_AGENT_TIMEOUT_MS / 60000} minutes — ` +
      'retry the stage, or lower review rounds in Super Plan settings.',
  );
}

/** Reject empty or placeholder plan-reviewer handoffs so the stage can retry. */
export function assertPlanReviewerAggregate(
  result: unknown,
  pass: number,
): AggregateResult {
  if (!isAggregateResult(result)) {
    throw new Error(`Plan review (pass ${pass}) did not return a sub-agent result.`);
  }
  if (result.status === 'cancelled' && result.error === 'timeout') {
    // The sub-agent type's own wall-clock timer fired (possibly racing the
    // stage's AbortSignal.timeout below) — report it the same way either way.
    throw reviewTimeoutError(pass);
  }
  const summary = (result.outcome?.summary ?? result.summary ?? '').trim();
  const placeholder = 'Sub-agent completed with no text output.';
  if (result.status !== 'completed' || !summary || summary === placeholder) {
    const detail = result.error?.trim() || summary || result.status;
    throw new Error(
      `Plan review (pass ${pass}) failed (${detail}). ` +
        'Retry the stage or check the reviewer model in Super Plan settings.',
    );
  }
  return result;
}

async function runGrillStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const config = getSuperPlanConfigSync();
  const skill = await fetchSkillById('grilling');
  const skillBody = adaptGrillingSkillForSuperPlan(skill?.body ?? null);
  const userText = buildSuperPlanGrillStageUserText(config.grillQuestionBudget, state.prompt);
  const driver = await runChatTurnForStage(
    chat,
    'grill',
    userText,
    'grilling',
    skillBody,
    config.plannerModel,
  );
  // Engine turns do not record chat.runs — finalize here instead of await_stream.
  return driver === 'engine' ? finalizeStreamStage(chat, 'grill') : { kind: 'await_stream' };
}

async function runSpecConfirmStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const userText = [
    'Super Plan pipeline — **Build spec stage**.',
    `Write the build specification to exactly \`${state.specPath}\` using \`save_file\` (overwrite if it exists — never pick a different filename).`,
    'Include: goal, scope, MVP boundaries, constraints, key files, risks, and acceptance criteria.',
    'Do not write the full wave plan yet — only the build spec.',
    'Do not include fenced implementation code blocks in the spec.',
    '',
    `Original request: ${state.prompt}`,
  ].join('\n');
  const driver = await runChatTurnForStage(
    chat,
    'spec_confirm',
    userText,
    null,
    null,
    getSuperPlanConfigSync().plannerModel,
  );
  return driver === 'engine'
    ? finalizeStreamStage(chat, 'spec_confirm')
    : { kind: 'await_stream' };
}

/** Reuse an in-flight or finished research run instead of starting a duplicate. */
async function resolveReattachableResearchId(state: {
  researchId?: string;
}): Promise<string | null> {
  const existing = state.researchId?.trim();
  if (!existing) return null;
  try {
    const status = await fetchResearchStatus(existing);
    if (status.status === 'done' || status.status === 'running') {
      return existing;
    }
  } catch {
    /* stale id — start fresh */
  }
  return null;
}

async function runResearchStage(
  chat: Chat,
  hooks?: SuperPlanStageRunHooks,
): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const config = getSuperPlanConfigSync();
  let specContent = '';
  if (state.specPath) {
    specContent = await readFileOrEmpty(state.specPath);
  }

  let researchId = await resolveReattachableResearchId(state);
  if (!researchId) {
    const query = [
      state.prompt,
      specContent ? `\n\nBuild spec:\n${specContent.slice(0, 4000)}` : '',
    ]
      .join('')
      .trim();
    const started = await startResearch({
      query,
      scope: config.researchScope,
      maxRounds: resolveSuperPlanResearchMaxRounds(config),
      ...(config.researchModel.providerId?.trim()
        ? { providerId: config.researchModel.providerId.trim() }
        : {}),
      ...(config.researchModel.modelId?.trim()
        ? { model: config.researchModel.modelId.trim() }
        : {}),
    });
    researchId = started.researchId;
  }
  patchSuperPlanState(chat, { researchId });
  hooks?.onResearchStarted?.(researchId);
  const wait = await waitForResearchDone(chat, researchId);
  if (wait.kind === 'paused') {
    return { kind: 'paused' };
  }
  const body = wait.report || `# Research report\n\nNo findings for: ${state.prompt}`;
  await executeTool('save_file', {
    path: state.researchPath!,
    content: body,
  });
  const uiInvolved = planInvolvesUi(state.prompt, specContent, body);
  patchSuperPlanState(chat, { uiInvolved });
  return { kind: 'done', artifactPath: state.researchPath };
}

async function runDraftStage(
  chat: Chat,
  stageId: 'draft1' | 'draft2',
): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const config = getSuperPlanConfigSync();
  const pass = superPlanDraftPassForStage(stageId) ?? 1;
  const planPath = state.planPath ?? superPlanPlanPath(state.slug);
  const lines = [
    `Super Plan pipeline — **Draft ${pass}**.`,
    `Write the executable plan to exactly \`${planPath}\` using \`save_file\` (overwrite if it exists — never pick a different filename).`,
    'Follow the Super Plan markdown structure (front-matter todos, waves, Build/Test per task).',
    'Use real file paths from the codebase. No fenced implementation code — prose and inline identifiers only.',
    `Read \`${state.specPath}\` and \`${state.researchPath}\` first.`,
  ];
  if (pass === 2) {
    lines.push(
      'Incorporate plan-reviewer feedback from the prior review stage.',
      state.review1Critique ? `\nPass 1 review:\n${state.review1Critique}` : '',
    );
  }
  lines.push('', `Original request: ${state.prompt}`);
  const driver = await runChatTurnForStage(
    chat,
    stageId,
    lines.join('\n'),
    null,
    null,
    config.plannerModel,
  );
  if (driver === 'engine') {
    return finalizeStreamStage(chat, stageId);
  }
  return { kind: 'await_stream' };
}

async function runReviewStage(
  chat: Chat,
  stageId: 'review1' | 'review2',
): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const config = getSuperPlanConfigSync();
  const pass = superPlanReviewPassForStage(stageId) ?? 1;
  const planPath =
    findLastPlanSavePath(chat.history) ?? state.planPath ?? superPlanPlanPath(state.slug);
  const [spec, research, draftPlan] = await Promise.all([
    readFileOrEmpty(state.specPath),
    readFileOrEmpty(state.researchPath),
    readFileOrEmpty(planPath),
  ]);

  const task = buildPlanReviewerTask({
    pass,
    reviewRounds: config.reviewRounds,
    draftPlan: draftPlan || `(Plan not found at ${planPath} — read the file first.)`,
    spec,
    research,
    buildSpecPath: state.specPath,
    researchArtifactPath: state.researchPath,
    planPath,
    priorCritique: pass === 2 ? state.review1Critique : undefined,
  });

  const spawned = await spawnSubAgent({
    type: 'plan-reviewer',
    task,
    wait: false,
    parentChatId: chat.id,
    modeId: 'super-plan',
    timeoutMs: REVIEW_SUB_AGENT_TIMEOUT_MS,
    ...(config.reviewerModel.providerId?.trim()
      ? { providerId: config.reviewerModel.providerId.trim() }
      : {}),
    ...(config.reviewerModel.modelId?.trim()
      ? { modelId: config.reviewerModel.modelId.trim() }
      : {}),
  });
  // Let pauseSuperPlan/cancelSuperPlan reach this run while it's in flight.
  patchSuperPlanState(chat, { reviewRunId: spawned.runId });

  // Bound the wait so a hung reviewer cannot stall the pipeline forever;
  // aborting the wait also cancels the sub-agent run.
  let result: unknown;
  try {
    result = await waitForSubAgent(
      spawned.runId,
      AbortSignal.timeout(REVIEW_SUB_AGENT_TIMEOUT_MS),
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw reviewTimeoutError(pass);
    }
    throw err;
  } finally {
    if (chat.superPlan?.reviewRunId === spawned.runId) {
      patchSuperPlanState(chat, { reviewRunId: undefined });
    }
  }

  if (chat.superPlan?.cancelled) {
    throw new Error('Super Plan cancelled');
  }
  if (chat.superPlan?.paused) {
    return { kind: 'paused' };
  }

  const aggregate = assertPlanReviewerAggregate(result, pass);
  const critique = formatReviewCritiqueForPass2(
    aggregate.outcome?.summary ?? aggregate.summary,
    JSON.stringify(aggregate.outcome?.findings ?? [], null, 2),
  );
  if (pass === 1) {
    patchSuperPlanState(chat, { review1Critique: critique });
  } else {
    patchSuperPlanState(chat, { review2Critique: critique });
  }

  return { kind: 'done', artifactPath: planPath };
}

async function runImpeccableStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const config = getSuperPlanConfigSync();
  const planPath =
    findLastPlanSavePath(chat.history) ?? state.planPath ?? superPlanPlanPath(state.slug);
  const [spec, research, draftPlan] = await Promise.all([
    readFileOrEmpty(state.specPath),
    readFileOrEmpty(state.researchPath),
    readFileOrEmpty(planPath),
  ]);

  const uiInvolved =
    state.uiInvolved ??
    shouldRunImpeccableStage({
      spec,
      research,
      draftPlan,
      planPath,
      buildSpecPath: state.specPath,
      researchArtifactPath: state.researchPath,
    });
  patchSuperPlanState(chat, { uiInvolved });

  if (!shouldRunSuperPlanImpeccable(config, uiInvolved)) {
    return { kind: 'skipped' };
  }

  const skill = await fetchSkillById('impeccable');
  const baseBody = skill?.body ?? '';
  const skillBody =
    (await composeSuperPlanImpeccableStage('shape', {
      spec,
      research,
      draftPlan,
      planPath,
      buildSpecPath: state.specPath,
      researchArtifactPath: state.researchPath,
    }, baseBody)) ??
    (await composeSuperPlanImpeccableStage('critique', {
      spec,
      research,
      draftPlan,
      planPath,
      buildSpecPath: state.specPath,
      researchArtifactPath: state.researchPath,
    }, baseBody));

  if (!skillBody) {
    return { kind: 'skipped' };
  }

  const userText = [
    'Super Plan pipeline — **Impeccable UI pass**.',
    `Refine UI-related sections of the plan at \`${planPath}\` using the injected Impeccable \`shape\` workflow.`,
    'Update the plan file in place with improved UX clarity — still no implementation code fences.',
  ].join('\n');
  const driver = await runChatTurnForStage(
    chat,
    'impeccable',
    userText,
    'impeccable',
    skillBody,
    config.plannerModel,
  );
  return driver === 'engine'
    ? finalizeStreamStage(chat, 'impeccable')
    : { kind: 'await_stream' };
}

async function runFinalizeStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const config = getSuperPlanConfigSync();
  const planPath =
    findLastPlanSavePath(chat.history) ?? state.planPath ?? superPlanPlanPath(state.slug);
  const userText = [
    'Super Plan pipeline — **Finalize**.',
    `Ensure \`${planPath}\` is complete: front-matter todos match tasks, verification checklist present.`,
    'Save the final plan if anything is missing. Reply briefly confirming the path.',
  ].join('\n');
  const driver = await runChatTurnForStage(
    chat,
    'finalize',
    userText,
    null,
    null,
    config.plannerModel,
  );
  return driver === 'engine'
    ? finalizeStreamStage(chat, 'finalize')
    : { kind: 'await_stream' };
}

async function runPresentStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const planPath =
    findLastPlanSavePath(chat.history) ?? state.planPath ?? superPlanPlanPath(state.slug);
  const exists = await fileExists(planPath);
  if (!exists) {
    throw new Error(`Final plan not found at ${planPath}`);
  }
  markSuperPlanStageStatus(chat, 'present', 'blocked_user', { artifactPath: planPath });
  return { kind: 'blocked_user', artifactPath: planPath };
}

export async function runSuperPlanStage(
  chat: Chat,
  stageId: import('./types').SuperPlanStageId,
  hooks?: SuperPlanStageRunHooks,
): Promise<SuperPlanStageOutcome> {
  await loadSuperPlanConfig();
  switch (stageId) {
    case 'grill':
      return runGrillStage(chat);
    case 'spec_confirm':
      return runSpecConfirmStage(chat);
    case 'research':
      return runResearchStage(chat, hooks);
    case 'draft1':
      return runDraftStage(chat, 'draft1');
    case 'review1':
      return runReviewStage(chat, 'review1');
    case 'draft2':
      return runDraftStage(chat, 'draft2');
    case 'review2':
      return runReviewStage(chat, 'review2');
    case 'impeccable':
      return runImpeccableStage(chat);
    case 'finalize':
      return runFinalizeStage(chat);
    case 'present':
      return runPresentStage(chat);
    default:
      throw new Error(`Unknown Super Plan stage: ${stageId satisfies never}`);
  }
}

/** Path filter for {@link findLastPlanSavePath}: Super Plan spec/research reference artifacts. */
function normalizeSuperPlanReferencePath(raw: string): string | undefined {
  const trimmed = raw.trim().replace(/\\/g, '/');
  return isSuperPlanReferenceArtifactPath(trimmed) ? trimmed : undefined;
}

export async function finalizeStreamStage(
  chat: Chat,
  stageId: import('./types').SuperPlanStageId,
): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  // Scope history scans to this stage's own turn so an older artifact from a
  // prior draft/spec attempt can't be mistaken for this run's output.
  const run = newestRun(chat);
  const runRange = { startIndex: run?.outputHistoryStart, endIndex: run?.outputHistoryEnd };

  switch (stageId) {
    case 'grill':
      markSuperPlanStageStatus(chat, 'grill', 'done');
      return { kind: 'done' };

    case 'spec_confirm': {
      // The model may save the spec under a near-miss filename (still a valid
      // reference artifact) — adopt whatever it actually saved this turn.
      // Scoped to this run's window: an older spec save must not mask this
      // attempt failing to save (same hazard as the draft case below).
      const savedSpecPath = findLastPlanSavePath(chat.history, {
        ...runRange,
        normalizePath: normalizeSuperPlanReferencePath,
      });
      if (!savedSpecPath || !(await fileExists(savedSpecPath))) {
        const expected = savedSpecPath ?? state.specPath!;
        throw new Error(
          `Build spec was not saved to ${expected}. Retry the stage to regenerate it.`,
        );
      }
      if (savedSpecPath !== state.specPath) {
        patchSuperPlanState(chat, { specPath: savedSpecPath });
      }
      markSuperPlanStageStatus(chat, 'spec_confirm', 'blocked_user', {
        artifactPath: savedSpecPath,
      });
      return { kind: 'blocked_user', artifactPath: savedSpecPath };
    }

    case 'draft1':
    case 'draft2': {
      const savedPlanPath = findLastPlanSavePath(chat.history, runRange);
      if (!savedPlanPath || !(await fileExists(savedPlanPath))) {
        const expected = savedPlanPath ?? state.planPath ?? superPlanPlanPath(state.slug);
        throw new Error(
          `Plan draft was not saved to ${expected}. Retry the stage to draft it again.`,
        );
      }
      // Persist the actual save location so later stages and previews agree on one file.
      patchSuperPlanState(chat, { planPath: savedPlanPath });
      markSuperPlanStageStatus(chat, stageId, 'done', { artifactPath: savedPlanPath });
      return { kind: 'done', artifactPath: savedPlanPath };
    }

    case 'impeccable':
    case 'finalize':
      markSuperPlanStageStatus(chat, stageId, 'done');
      return { kind: 'done' };

    default:
      markSuperPlanStageStatus(chat, stageId, 'done');
      return { kind: 'done' };
  }
}

// Re-export review helpers for tests and callers.
export {
  buildPlanReviewerTask,
  planInvolvesUi,
  SUPER_PLAN_REVIEW_PASSES,
} from './review-helpers';
