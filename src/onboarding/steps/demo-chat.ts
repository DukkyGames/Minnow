/**
 * S11 — Guided demo chat: tool exercises + Brain seeding.
 */

import { saveBrainPage } from '../../brain/client';
import { newChatId } from '../../state/sessions';
import type { Chat } from '../../types';
import { runChatTurn } from '../../tools/loop';
import { getWorkspacePath } from '../../state/workspace';
import { el, renderStepHeader } from '../ui-helpers';
import type { OnboardingContext, OnboardingStep } from '../types';
import { recordStepProgress } from '../state-core';

interface DemoLesson {
  id: string;
  title: string;
  prompt: string;
  hint: string;
}

const DEMO_LESSONS: DemoLesson[] = [
  {
    id: 'datetime',
    title: 'Built-in tools',
    prompt: 'Call get_datetime and reply with today\'s date in ISO format only.',
    hint: 'Watch for an inline tool row in the transcript.',
  },
  {
    id: 'memory',
    title: 'Memory',
    prompt: 'Remember that I completed Minnow onboarding today.',
    hint: 'Facts persist under ~/.minnow for future chats.',
  },
  {
    id: 'brain',
    title: 'Brain wiki',
    prompt: 'Create a short Brain page titled "Getting started" with three bullet tips for new Minnow users.',
    hint: 'Brain is your local knowledge base in the Brain app.',
  },
];

let lessonIndex = 0;
let demoChat: Chat | null = null;
let lessonsDone = new Set<string>();
let running = false;
let brainSeeded = false;

function createDemoChat(ctx: OnboardingContext): Chat {
  const now = Date.now();
  return {
    id: `onboarding-demo-${newChatId()}`,
    name: 'Onboarding demo',
    workspacePath: getWorkspacePath() || '',
    history: [],
    modelId: ctx.modelId ?? '',
    providerId: ctx.providerId ?? '',
    modeId: 'general',
    workAgentAuto: true,
    lastStats: null,
    modelInfo: {},
    updatedAt: now,
    lastMessageAt: now,
  };
}

function renderTranscript(host: HTMLElement, chat: Chat): void {
  host.replaceChildren();
  const rows = chat.history.filter((m) => m.role === 'user' || m.role === 'assistant');
  if (!rows.length) {
    host.appendChild(el('p', 'mn-onboarding-muted', 'Send a guided prompt to start.'));
    return;
  }
  for (const msg of rows.slice(-6)) {
    const row = el('div', `mn-onboarding-demo-msg mn-onboarding-demo-msg--${msg.role}`);
    const label = msg.role === 'user' ? 'You' : 'Minnow';
    row.appendChild(el('span', 'mn-onboarding-demo-msg__label', label));
    const body = typeof msg.content === 'string' ? msg.content : '';
    row.appendChild(el('p', 'mn-onboarding-demo-msg__body', body.slice(0, 1200)));
    host.appendChild(row);
  }

  const toolRows = chat.history.filter((m) => m.role === 'tool');
  if (toolRows.length) {
    const toolsCard = el('div', 'mn-onboarding-demo-tools');
    toolsCard.appendChild(el('span', 'mn-onboarding-demo-tools__title', 'Tool activity'));
    toolRows.slice(-3).forEach((tool) => {
      const label = tool.tool_call_id ? `tool ${tool.tool_call_id.slice(0, 8)}` : 'tool';
      toolsCard.appendChild(el('span', 'mn-onboarding-chip', label));
    });
    host.appendChild(toolsCard);
  }
}

async function runLesson(
  chat: Chat,
  lesson: DemoLesson,
  transcript: HTMLElement,
  actions: { setPrimaryEnabled: (v: boolean) => void },
): Promise<void> {
  running = true;
  actions.setPrimaryEnabled(false);
  try {
    await runChatTurn({
      chat,
      pushUser: true,
      rawText: lesson.prompt,
      userText: lesson.prompt,
      displayText: lesson.prompt,
      historyContent: lesson.prompt,
      skillId: null,
      validAttachments: [],
      shouldScheduleTitle: false,
      ownsGlobalStreaming: false,
    });
    lessonsDone.add(lesson.id);
    renderTranscript(transcript, chat);
  } catch (err) {
    transcript.appendChild(
      el(
        'p',
        'mn-onboarding-notice',
        err instanceof Error ? err.message : 'Demo turn failed',
      ),
    );
  } finally {
    running = false;
    actions.setPrimaryEnabled(true);
  }
}

async function seedBrainFromDemo(): Promise<void> {
  if (brainSeeded) return;
  await saveBrainPage({
    path: 'onboarding/getting-started.md',
    title: 'Getting started with Minnow',
    body: [
      '# Getting started',
      '',
      'You completed first-run setup.',
      '',
      '- Chat uses your default model from the top bar.',
      '- Tools run inline; check Settings → Tools for permissions.',
      '- Brain and memory stay local under ~/.minnow.',
    ].join('\n'),
    tags: ['onboarding'],
    source: 'onboarding-demo',
    summary: 'First-run onboarding notes',
  });
  brainSeeded = true;
}

export const demoChatStep: OnboardingStep = {
  id: 'demo-chat',
  title: 'Try it in chat',
  canSkip: true,
  isApplicable: (ctx) => Boolean(ctx.providerId && ctx.modelId && ctx.serverAvailable),

  render(container, ctx, actions) {
    container.innerHTML = '';
    container.className = 'mn-onboarding-step mn-onboarding-step--demo';

    renderStepHeader(container, demoChatStep, actions.stepIndex, actions.totalSteps);

    if (!ctx.providerId || !ctx.modelId) {
      container.appendChild(
        el(
          'p',
          'mn-onboarding-notice',
          'Connect a model first to run the demo chat, or skip this step.',
        ),
      );
      actions.setPrimaryEnabled(true);
      return;
    }

    if (!demoChat) {
      demoChat = createDemoChat(ctx);
    }

    const lesson = DEMO_LESSONS[lessonIndex] ?? DEMO_LESSONS[0];
    container.appendChild(
      el('p', 'mn-onboarding-step-desc', `Lesson ${lessonIndex + 1} of ${DEMO_LESSONS.length}: ${lesson.title}`),
    );
    container.appendChild(el('p', 'mn-onboarding-muted', lesson.hint));

    const transcript = el('div', 'mn-onboarding-demo-transcript');
    container.appendChild(transcript);
    renderTranscript(transcript, demoChat);

    const promptBtn = el('button', 'mn-onboarding-secondary-btn', `Run: ${lesson.title}`);
    promptBtn.type = 'button';
    promptBtn.disabled = running || lessonsDone.has(lesson.id);
    promptBtn.addEventListener('click', () => {
      void runLesson(demoChat!, lesson, transcript, actions).then(() => {
        if (lessonsDone.has(lesson.id) && lessonIndex < DEMO_LESSONS.length - 1) {
          lessonIndex += 1;
          demoChatStep.render(container, ctx, actions);
        }
      });
    });
    container.appendChild(promptBtn);

    const stepDots = el('div', 'mn-onboarding-explainer-dots');
    DEMO_LESSONS.forEach((item, i) => {
      const dot = el('button', 'mn-onboarding-explainer-dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', item.title);
      if (i === lessonIndex) dot.classList.add('is-active');
      if (lessonsDone.has(item.id)) dot.classList.add('is-done');
      stepDots.appendChild(dot);
    });
    container.appendChild(stepDots);

    const allDone = DEMO_LESSONS.every((l) => lessonsDone.has(l.id));
    actions.setPrimaryLabel(allDone ? 'Continue' : 'Skip lesson');
    actions.setPrimaryEnabled(!running);
  },

  async commit(ctx) {
    await seedBrainFromDemo();
    ctx.state = recordStepProgress(ctx.state, 'demo-chat', {
      done: lessonsDone.size > 0,
      skipped: lessonsDone.size === 0,
      data: { lessons: [...lessonsDone], brainSeeded },
    });
    lessonIndex = 0;
    demoChat = null;
    lessonsDone = new Set();
  },
};

export function resetDemoChatState(): void {
  lessonIndex = 0;
  demoChat = null;
  lessonsDone = new Set();
  running = false;
  brainSeeded = false;
}
