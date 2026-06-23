/**
 * Plan mode "Grill Me" intake — structured questionnaire before the first plan draft.
 */

import { normalizeModeId } from '../chat/modes/types';
import { scheduleSaveSessions, touchChat } from '../state/sessions';
import type { Chat, PlanIntakeState } from '../types';
import { mountSuperPlanQuestionnaire } from './questionnaire';
import type { SuperPlanQuestion, SuperPlanQuestionnaireAnswers } from './types';

export const PLAN_GRILL_ME_MOUNT_ID = 'planGrillMeMount';

/** ~20 intake questions covering scope, constraints, and success criteria. */
export function buildPlanGrillMeQuestions(): SuperPlanQuestion[] {
  return [
    { id: 'goal', prompt: 'What is the primary goal of this work?', kind: 'text' },
    { id: 'problem', prompt: 'What problem or pain point are you solving?', kind: 'text' },
    {
      id: 'audience',
      prompt: 'Who is the primary audience or user?',
      kind: 'single',
      options: ['Solo developer', 'Team engineers', 'Product / stakeholders', 'End users'],
    },
    { id: 'mvp', prompt: 'What is the minimum viable outcome (MVP)?', kind: 'text' },
    { id: 'non_goals', prompt: 'What is explicitly out of scope?', kind: 'text' },
    {
      id: 'priority',
      prompt: 'What matters most for this plan?',
      kind: 'single',
      options: ['Speed to ship', 'Code quality', 'Polish / UX', 'Low risk / incremental'],
    },
    {
      id: 'timeline',
      prompt: 'What is your target timeline?',
      kind: 'single',
      options: ['Same day', 'This week', 'This month', 'No hard deadline'],
    },
    {
      id: 'constraints',
      prompt: 'Which constraints apply? (select all)',
      kind: 'multi',
      options: ['Backward compatible', 'No new dependencies', 'Offline / local-first', 'Security-sensitive'],
    },
    {
      id: 'stack',
      prompt: 'Must this stay within the existing tech stack?',
      kind: 'single',
      options: ['Yes — match repo conventions', 'Mostly — minor additions OK', 'Open to new libraries'],
    },
    {
      id: 'surfaces',
      prompt: 'Which surfaces are in scope? (select all)',
      kind: 'multi',
      options: ['UI / SPA', 'Node tool server', 'Electron shell', 'Tests only', 'Docs / plans'],
    },
    {
      id: 'data',
      prompt: 'Does this involve persistence or migrations?',
      kind: 'single',
      options: ['No data changes', 'Config / JSON only', 'New persistence', 'Migration required'],
    },
    { id: 'integrations', prompt: 'Any external integrations or APIs?', kind: 'text' },
    { id: 'risks', prompt: 'What are the biggest risks or unknowns?', kind: 'text' },
    { id: 'dependencies', prompt: 'Does this depend on other work or teams?', kind: 'text' },
    {
      id: 'testing',
      prompt: 'How should success be verified?',
      kind: 'multi',
      options: ['Unit tests', 'Integration tests', 'Manual QA', 'Benchmark / perf', 'Visual review'],
    },
    {
      id: 'granularity',
      prompt: 'Preferred plan granularity',
      kind: 'single',
      options: ['Large (feature-level tasks)', 'Medium (component-level)', 'Small (function-level)'],
    },
    {
      id: 'handoff',
      prompt: 'Who will execute the plan after it is written?',
      kind: 'single',
      options: ['Me in Build mode', 'Orchestrate / board', 'Another developer', 'Unsure'],
    },
    { id: 'references', prompt: 'Links, tickets, or reference docs (optional)', kind: 'text' },
    { id: 'style', prompt: 'Tone or conventions the plan should emphasize', kind: 'text' },
    { id: 'anything_else', prompt: 'Anything else we should capture before drafting?', kind: 'text' },
  ];
}

/** @deprecated Use {@link buildPlanGrillMeQuestions}. */
export const DEFAULT_PLAN_GRILL_ME_QUESTIONS = buildPlanGrillMeQuestions();

/** True when Plan mode needs the Grill Me questionnaire (fresh chat, intake not done). */
export function shouldShowPlanGrillMe(chat: Chat): boolean {
  if (normalizeModeId(chat.modeId) !== 'plan') {
    return false;
  }
  if (chat.planIntake?.completed) {
    return false;
  }
  const hasUserTurn = chat.history.some((m) => m.role === 'user');
  return !hasUserTurn;
}

/** Format intake answers as a user message prefix for the planner. */
export function formatPlanIntakeForPrompt(
  answers: SuperPlanQuestionnaireAnswers,
  questions: SuperPlanQuestion[] = buildPlanGrillMeQuestions(),
): string {
  const lines: string[] = ['## Plan intake (Grill Me)', ''];
  for (const q of questions) {
    const raw = answers[q.id];
    if (raw === undefined || raw === '') {
      continue;
    }
    const value = Array.isArray(raw) ? raw.join(', ') : raw;
    lines.push(`**${q.prompt}**`, value.trim(), '');
  }
  return lines.join('\n').trim();
}

/** @deprecated Use {@link formatPlanIntakeForPrompt}. */
export function formatGrillMeAnswersForPrompt(answers: SuperPlanQuestionnaireAnswers): string {
  return formatPlanIntakeForPrompt(answers);
}

let activeMount: { destroy: () => void } | null = null;
let pendingSendResolver: (() => void) | null = null;

/** Whether the Plan Grill Me questionnaire is mounted. */
export function isPlanGrillMeActive(): boolean {
  return activeMount !== null;
}

function getPlanGrillMeMount(): HTMLElement | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return document.getElementById(PLAN_GRILL_ME_MOUNT_ID);
}

function teardownPlanGrillMeMount(): void {
  activeMount?.destroy();
  activeMount = null;
  const mount = getPlanGrillMeMount();
  if (!mount) {
    return;
  }
  mount.classList.add('hidden');
  mount.setAttribute('aria-hidden', 'true');
  mount.replaceChildren();
}

function markPlanIntakeComplete(
  chat: Chat,
  answers: SuperPlanQuestionnaireAnswers,
): void {
  const state: PlanIntakeState = {
    completed: true,
    answers,
    completedAt: new Date().toISOString(),
  };
  chat.planIntake = state;
  touchChat(chat);
  scheduleSaveSessions();
}

/** @deprecated Use {@link markPlanIntakeComplete} via {@link startPlanGrillMe}. */
export function markPlanGrillMeComplete(chat: Chat, answers: SuperPlanQuestionnaireAnswers): void {
  markPlanIntakeComplete(chat, answers);
}

/**
 * Mount the Grill Me questionnaire for Plan mode.
 * Returns false when the mount element is missing.
 */
export function startPlanGrillMe(
  chat: Chat,
  onComplete: (answers: SuperPlanQuestionnaireAnswers) => void,
  onCancel?: () => void,
): boolean {
  const mount = getPlanGrillMeMount();
  if (!mount) {
    return false;
  }

  activeMount?.destroy();
  mount.classList.remove('hidden');
  mount.removeAttribute('aria-hidden');

  const questions = buildPlanGrillMeQuestions();
  activeMount = mountSuperPlanQuestionnaire(
    mount,
    questions,
    (answers) => {
      markPlanIntakeComplete(chat, answers);
      teardownPlanGrillMeMount();
      onComplete(answers);
    },
    () => {
      teardownPlanGrillMeMount();
      pendingSendResolver = null;
      onCancel?.();
    },
    {
      title: 'Grill Me',
      subtitle:
        'Answer these questions so we can shape your plan. Mid-chat sessions fall back to inline ask_question cards.',
      submitLabel: 'Start planning',
    },
  );
  return true;
}

/** Called when the user switches the active chat to Plan mode. */
export function onPlanModeActivated(chat: Chat): void {
  if (!shouldShowPlanGrillMe(chat) || isPlanGrillMeActive()) {
    return;
  }
  startPlanGrillMe(chat, () => {
    /* User can send when ready; intake is persisted on chat. */
  });
}

/**
 * Intercept the first Plan-mode send when intake is required.
 * Returns true when send should be blocked (questionnaire shown or already open).
 */
export function tryStartPlanGrillMeBeforeSend(chat: Chat, draftText: string): boolean {
  if (!shouldShowPlanGrillMe(chat)) {
    return false;
  }
  if (isPlanGrillMeActive()) {
    return true;
  }

  const started = startPlanGrillMe(
    chat,
    () => {
      const resolver = pendingSendResolver;
      pendingSendResolver = null;
      resolver?.();
    },
    () => {
      pendingSendResolver = null;
    },
  );
  if (!started) {
    return false;
  }

  pendingSendResolver = () => {
    void (async () => {
      const { getActiveComposerSurface } = await import('../ui/composer-surface');
      const input = getActiveComposerSurface().inputEl;
      if (input && draftText.trim()) {
        input.value = draftText;
        input.dispatchEvent(new window.Event('input', { bubbles: true }));
      }
      const { sendMessage } = await import('../chat/messaging');
      await sendMessage();
    })();
  };
  return true;
}

/** Test hook: reset module state. */
export function resetPlanGrillMeForTests(): void {
  teardownPlanGrillMeMount();
  pendingSendResolver = null;
}
