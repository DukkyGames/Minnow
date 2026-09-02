import type { AggregateResult } from '../../agents/types';
import { spawnSubAgent, waitForSubAgent } from '../../agents/orchestrator';
import {
  DEFAULT_SUPER_PLAN_CONFIG,
  getSuperPlanConfigSync,
  loadSuperPlanConfig,
  resolveSuperPlanResearchMaxRounds,
  type SuperPlanStageModelBinding,
} from '../../config/super-plan-meta';
import { fetchSkillById } from '../../skills/client';
import { findLastPlanSavePath } from '../plans/plan-from-history';
import { isSuperPlanReferenceArtifactPath } from '../modes/plan-write-guard';
import { isFirstUserMessagePending } from '../titles/schedule';
import {
  cancelResearch,
  fetchResearchResult,
  fetchResearchStatus,
  startResearch,
} from '../../research/client';
import type { Chat } from '../../types';
import { detectLocalServer, executeTool } from '../../tools/client';
import { buildHistoryUserContent } from '../build-api-messages';
import { runChatTurn } from '../run-turn-chat';
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

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Helpers ──────────────────────────────────────────────────────────────────

async function runChatTurnForStage(
  chat: Chat,
  stageId: SuperPlanStageId,
  userText: string,
  skillId: string | null,
  skillBody: string | null,
  modelOverride?: SuperPlanStageModelBinding,
): Promise<void> {
  const savedProvider = chat.providerId;
  const savedModel = chat.modelId;
  if (modelOverride?.providerId?.trim()) {
    chat.providerId = modelOverride.providerId.trim();
  }
  if (modelOverride?.modelId?.trim()) {
    chat.modelId = modelOverride.modelId.trim();
  }
  try {
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

type ResearchWaitResult = { kind: 'done'; report: string } | { kind: 'paused' };

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
function reviewTimeoutError(pass: number, timeoutMs: number): Error {
  return new Error(
    `Plan review (pass ${pass}) timed out after ${Math.round(timeoutMs / 60000)} minutes — ` +
      'retry the stage, or raise the review timeout in Super Plan settings.',
  );
}

/** Reject empty or placeholder plan-reviewer handoffs so the stage can retry. */
export function assertPlanReviewerAggregate(
  result: unknown,
  pass: number,
  timeoutMs: number = DEFAULT_SUPER_PLAN_CONFIG.reviewTimeoutMs,
): AggregateResult {
  if (!isAggregateResult(result)) {
    throw new Error(`Plan review (pass ${pass}) did not return a sub-agent result.`);
  }
  if (result.status === 'cancelled' && result.error === 'timeout') {
    throw reviewTimeoutError(pass, timeoutMs);
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

// ── Stages ───────────────────────────────────────────────────────────────────

async function runGrillStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const config = getSuperPlanConfigSync();
  const skill = await fetchSkillById('grilling');
  const skillBody = adaptGrillingSkillForSuperPlan(skill?.body ?? null);
  const userText = buildSuperPlanGrillStageUserText(config.grillQuestionBudget, state.prompt);
  await runChatTurnForStage(chat, 'grill', userText, 'grilling', skillBody, config.plannerModel);
  return { kind: 'await_stream' };
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
  await runChatTurnForStage(chat, 'spec_confirm', userText, null, null, getSuperPlanConfigSync().plannerModel);
  return { kind: 'await_stream' };
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
  } catch {}
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
  await runChatTurnForStage(chat, stageId, lines.join('\n'), null, null, config.plannerModel);
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

  const reviewTimeoutMs = config.reviewTimeoutMs;
  const spawned = await spawnSubAgent({
    type: 'plan-reviewer',
    task,
    wait: false,
    parentChatId: chat.id,
    modeId: 'super-plan',
    timeoutMs: reviewTimeoutMs,
    ...(config.reviewerModel.providerId?.trim()
      ? { providerId: config.reviewerModel.providerId.trim() }
      : {}),
    ...(config.reviewerModel.modelId?.trim()
      ? { modelId: config.reviewerModel.modelId.trim() }
      : {}),
  });
  patchSuperPlanState(chat, { reviewRunId: spawned.runId });

  let result: unknown;
  try {
    result = await waitForSubAgent(
      spawned.runId,
      AbortSignal.timeout(reviewTimeoutMs),
    );
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw reviewTimeoutError(pass, reviewTimeoutMs);
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

  const aggregate = assertPlanReviewerAggregate(result, pass, reviewTimeoutMs);
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
  await runChatTurnForStage(chat, 'impeccable', userText, 'impeccable', skillBody, config.plannerModel);
  return { kind: 'await_stream' };
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
  await runChatTurnForStage(chat, 'finalize', userText, null, null, config.plannerModel);
  return { kind: 'await_stream' };
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

// ── Dispatch ─────────────────────────────────────────────────────────────────

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
  const run = newestRun(chat);
  const runRange = { startIndex: run?.outputHistoryStart, endIndex: run?.outputHistoryEnd };

  switch (stageId) {
    case 'grill':
      markSuperPlanStageStatus(chat, 'grill', 'done');
      return { kind: 'done' };

    case 'spec_confirm': {
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
