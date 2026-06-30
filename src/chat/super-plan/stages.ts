/**
 * Super Plan stage runners — one function per pipeline stage.
 */

import type { AggregateResult } from '../../agents/types';
import { spawnSubAgent } from '../../agents/orchestrator';
import { fetchSkillById } from '../../skills/client';
import { findLastPlanSavePath } from '../orchestrate/plan-from-history';
import { isFirstUserMessagePending } from '../titles/schedule';
import {
  fetchResearchResult,
  fetchResearchStatus,
  startResearch,
} from '../../research/client';
import type { Chat } from '../../types';
import { detectLocalServer, executeTool } from '../../tools/client';
import { buildHistoryUserContent, runChatTurn } from '../../tools/loop';
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
  ensureSuperPlanState,
  markSuperPlanStageStatus,
  patchSuperPlanState,
  superPlanPlanPath,
} from './state';

export type SuperPlanStageOutcome =
  | { kind: 'await_stream' }
  | { kind: 'blocked_user'; artifactPath?: string }
  | { kind: 'done'; artifactPath?: string }
  | { kind: 'skipped' };

async function runChatTurnForStage(
  chat: Chat,
  userText: string,
  skillId: string | null,
  skillBody: string | null,
): Promise<void> {
  await detectLocalServer();
  const displayText = userText;
  const historyContent = buildHistoryUserContent(displayText, []);
  await runChatTurn({
    chat,
    pushUser: true,
    rawText: userText,
    userText,
    skillId,
    displayText,
    historyContent,
    validAttachments: [],
    titleSeed: userText,
    shouldScheduleTitle: isFirstUserMessagePending(chat),
    skillBody,
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    const result = await executeTool('read_file', { path });
    return Boolean(result.content?.trim());
  } catch {
    return false;
  }
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

async function waitForResearchDone(researchId: string): Promise<string> {
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i += 1) {
    const status = await fetchResearchStatus(researchId);
    if (status.status === 'done') {
      const result = await fetchResearchResult(researchId);
      return result.result?.trim() ?? '';
    }
    if (status.status === 'error' || status.status === 'cancelled') {
      throw new Error(`Research ${status.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error('Research timed out');
}

function isAggregateResult(value: unknown): value is AggregateResult {
  return (
    value != null &&
    typeof value === 'object' &&
    'runId' in value &&
    'outcome' in value
  );
}

async function runGrillStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const skill = await fetchSkillById('grilling');
  const skillBody = skill?.body ?? null;
  const userText = [
    'Super Plan pipeline — **Grill stage**.',
    'Interview me relentlessly (~20 questions) about this plan before we write anything.',
    'Use `ask_question` one card at a time with a recommended answer each time.',
    '',
    state.prompt,
  ].join('\n');
  await runChatTurnForStage(chat, userText, 'grilling', skillBody);
  return { kind: 'await_stream' };
}

async function runSpecConfirmStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const userText = [
    'Super Plan pipeline — **Build spec stage**.',
    `Write the build specification to \`${state.specPath}\` using \`save_file\`.`,
    'Include: goal, scope, MVP boundaries, constraints, key files, risks, and acceptance criteria.',
    'Do not write the full wave plan yet — only the build spec.',
    'Do not include fenced implementation code blocks in the spec.',
    '',
    `Original request: ${state.prompt}`,
  ].join('\n');
  await runChatTurnForStage(chat, userText, null, null);
  return { kind: 'await_stream' };
}

async function runResearchStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  let specContent = '';
  if (state.specPath) {
    specContent = await readFileOrEmpty(state.specPath);
  }
  const query = [
    state.prompt,
    specContent ? `\n\nBuild spec:\n${specContent.slice(0, 4000)}` : '',
  ]
    .join('')
    .trim();
  const { researchId } = await startResearch({ query, scope: 'both' });
  const report = await waitForResearchDone(researchId);
  const body = report || `# Research report\n\nNo findings for: ${state.prompt}`;
  await executeTool('save_file', {
    path: state.researchPath!,
    content: body,
  });
  const uiInvolved = planInvolvesUi(state.prompt, specContent, body);
  patchSuperPlanState(chat, { uiInvolved });
  return { kind: 'done', artifactPath: state.researchPath };
}

async function runDraftStage(chat: Chat, pass: 1 | 2): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const planPath = state.planPath ?? superPlanPlanPath(state.slug);
  const lines = [
    `Super Plan pipeline — **Draft ${pass}**.`,
    `Write the executable plan to \`${planPath}\` using \`save_file\`.`,
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
  await runChatTurnForStage(chat, lines.join('\n'), null, null);
  return { kind: 'await_stream' };
}

async function runReviewStage(chat: Chat, pass: 1 | 2): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const planPath =
    findLastPlanSavePath(chat.history) ?? state.planPath ?? superPlanPlanPath(state.slug);
  const [spec, research, draftPlan] = await Promise.all([
    readFileOrEmpty(state.specPath),
    readFileOrEmpty(state.researchPath),
    readFileOrEmpty(planPath),
  ]);

  const task = buildPlanReviewerTask({
    pass,
    draftPlan: draftPlan || `(Plan not found at ${planPath} — read the file first.)`,
    spec,
    research,
    buildSpecPath: state.specPath,
    researchArtifactPath: state.researchPath,
    planPath,
    priorCritique: pass === 2 ? state.review1Critique : undefined,
  });

  const result = await spawnSubAgent({
    type: 'plan-reviewer',
    task,
    wait: true,
    parentChatId: chat.id,
    modeId: 'super-plan',
  });

  if (isAggregateResult(result)) {
    const critique = formatReviewCritiqueForPass2(
      result.outcome?.summary ?? result.summary,
      JSON.stringify(result.outcome?.findings ?? [], null, 2),
    );
    if (pass === 1) {
      patchSuperPlanState(chat, { review1Critique: critique });
    } else {
      patchSuperPlanState(chat, { review2Critique: critique });
    }
  }

  return { kind: 'done', artifactPath: planPath };
}

async function runImpeccableStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
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

  if (!uiInvolved) {
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
  await runChatTurnForStage(chat, userText, 'impeccable', skillBody);
  return { kind: 'await_stream' };
}

async function runFinalizeStage(chat: Chat): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);
  const planPath =
    findLastPlanSavePath(chat.history) ?? state.planPath ?? superPlanPlanPath(state.slug);
  const userText = [
    'Super Plan pipeline — **Finalize**.',
    `Ensure \`${planPath}\` is complete: front-matter todos match tasks, verification checklist present.`,
    'Save the final plan if anything is missing. Reply briefly confirming the path.',
  ].join('\n');
  await runChatTurnForStage(chat, userText, null, null);
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

export async function runSuperPlanStage(
  chat: Chat,
  stageId: import('./types').SuperPlanStageId,
): Promise<SuperPlanStageOutcome> {
  switch (stageId) {
    case 'grill':
      return runGrillStage(chat);
    case 'spec_confirm':
      return runSpecConfirmStage(chat);
    case 'research':
      return runResearchStage(chat);
    case 'draft1':
      return runDraftStage(chat, 1);
    case 'review1':
      return runReviewStage(chat, 1);
    case 'draft2':
      return runDraftStage(chat, 2);
    case 'review2':
      return runReviewStage(chat, 2);
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

export async function finalizeStreamStage(
  chat: Chat,
  stageId: import('./types').SuperPlanStageId,
): Promise<SuperPlanStageOutcome> {
  const state = ensureSuperPlanState(chat);

  switch (stageId) {
    case 'grill':
      markSuperPlanStageStatus(chat, 'grill', 'done');
      return { kind: 'done' };

    case 'spec_confirm': {
      const specPath = state.specPath!;
      const exists = await fileExists(specPath);
      if (!exists) {
        throw new Error(`Build spec was not saved to ${specPath}`);
      }
      markSuperPlanStageStatus(chat, 'spec_confirm', 'blocked_user', {
        artifactPath: specPath,
      });
      return { kind: 'blocked_user', artifactPath: specPath };
    }

    case 'draft1':
    case 'draft2': {
      const planPath =
        findLastPlanSavePath(chat.history) ??
        state.planPath ??
        superPlanPlanPath(state.slug);
      if (!(await fileExists(planPath))) {
        throw new Error(`Plan draft was not saved to ${planPath}`);
      }
      markSuperPlanStageStatus(chat, stageId, 'done', { artifactPath: planPath });
      return { kind: 'done', artifactPath: planPath };
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
