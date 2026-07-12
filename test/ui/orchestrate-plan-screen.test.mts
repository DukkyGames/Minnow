import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  ORCHESTRATE_PLAN_BANNER_ID,
  ORCHESTRATE_PLAN_SCREEN_PROMPT_ID,
  ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID,
  ORCHESTRATE_PLAN_SCREEN_ROOT_ID,
  getOrchestratePlanScreenSession,
  isOrchestratePlanScreenSuppressingChatDom,
  isOrchestratePlanScreenSuspended,
  openOrchestratePlanScreen,
  renderOrchestratePlanScreen,
  resetOrchestratePlanScreenForTests,
  resolveOrchestratePlanScreenQuestionHost,
  shouldRouteComposerSendToSuperPlan,
  suspendOrchestratePlanScreenOnLeave,
} from '../../src/ui/orchestrate-plan-screen.ts';
import { showQuestionCardsModal } from '../../src/ui/question-cards-modal.ts';
import { appendStreamingAssistantRow, renderChatFromHistory } from '../../src/ui/messages.ts';
import { isStreamDomVisible } from '../../src/chat/streaming-state.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';

describe('orchestrate plan screen', () => {
  afterEach(() => {
    resetOrchestratePlanScreenForTests();
    setSessionStateForTests(null);
  });

  test('mount shows prompt and suppresses stream DOM', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = document.createElement('main');
    area.id = 'chatArea';
    document.body.appendChild(area);

    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('m1');
    chat.modeId = 'plan';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    await openOrchestratePlanScreen();

    assert.ok(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID));
    const prompt = document.getElementById(
      ORCHESTRATE_PLAN_SCREEN_PROMPT_ID,
    ) as HTMLTextAreaElement | null;
    assert.ok(prompt);
    assert.equal(prompt?.tagName, 'TEXTAREA');
    assert.equal(isOrchestratePlanScreenSuppressingChatDom(chat.id), true);
    assert.equal(isStreamDomVisible(chat.id), false);

    const row = appendStreamingAssistantRow(chat.id);
    assert.equal(row.wrap.isConnected, false, 'stream row should be stubbed');
  });

  test('view chat suspends overlay and resume remounts working phase', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = document.createElement('main');
    area.id = 'chatArea';
    document.body.appendChild(area);
    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('m1');
    chat.modeId = 'plan';
    chat.history.push({ role: 'user', content: 'Build a kanban board' });
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderOrchestratePlanScreen({
      phase: 'working',
      chatId: chat.id,
      savedPrompt: 'Build a kanban board',
    });

    suspendOrchestratePlanScreenOnLeave(chat.id);
    assert.equal(isOrchestratePlanScreenSuspended(), true);
    assert.equal(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID), null);
    assert.equal(isOrchestratePlanScreenSuppressingChatDom(chat.id), false);

    let session = getOrchestratePlanScreenSession();
    assert.equal(session?.phase, 'working');
    assert.equal(session?.chatId, chat.id);

    renderChatFromHistory(chat);
    assert.ok(document.getElementById(ORCHESTRATE_PLAN_BANNER_ID));

    session = getOrchestratePlanScreenSession();
    assert.equal(session?.phase, 'working');
    assert.equal(session?.chatId, chat.id);
  });

  test('ask_question resolves embedded host on plan screen', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.requestAnimationFrame = (cb: () => void) => {
      cb();
      return 0;
    };

    const area = document.createElement('main');
    area.id = 'chatArea';
    document.body.appendChild(area);
    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('m1');
    chat.modeId = 'plan';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderOrchestratePlanScreen({
      phase: 'working',
      chatId: chat.id,
      savedPrompt: 'Plan feature X',
    });

    const host = resolveOrchestratePlanScreenQuestionHost(chat.id);
    assert.ok(host, 'plan screen should expose questions host');
    assert.equal(host?.id, ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID);
    assert.equal(host?.hidden, false);

    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Which scope?',
            options: [{ id: 'a', label: 'Small' }],
          },
        ],
      },
      {},
      { host: host!, embedded: true, chatId: chat.id },
    );

    const panel = host?.querySelector('.question-cards-panel--embedded');
    assert.ok(panel, 'question cards should mount inside plan screen');

    const closeBtn = host?.querySelector('.question-cards-icon-btn') as HTMLButtonElement;
    closeBtn?.click();
    const result = await modalPromise;
    assert.equal(result.status, 'cancelled');
  });

  test('shouldRouteComposerSendToSuperPlan routes first super-plan composer send', () => {
    const chat = createEmptyChatObject('sp1');
    chat.modeId = 'super-plan';
    assert.equal(
      shouldRouteComposerSendToSuperPlan(chat, {
        userText: 'Add OAuth login',
        skillId: null,
        attachmentCount: 0,
      }),
      true,
    );
  });

  test('shouldRouteComposerSendToSuperPlan skips when pipeline already active', () => {
    const chat = createEmptyChatObject('sp2');
    chat.modeId = 'super-plan';
    chat.superPlan = {
      slug: 'oauth',
      prompt: 'Add OAuth login',
      activeStage: 'grill',
      stages: {} as never,
      specPath: 'documentation/plans/references/oauth-spec.md',
      researchPath: 'documentation/plans/references/oauth-research.md',
      planPath: 'documentation/plans/oauth.md',
      uiInvolved: false,
    };
    assert.equal(
      shouldRouteComposerSendToSuperPlan(chat, {
        userText: 'Add OAuth login',
        skillId: null,
        attachmentCount: 0,
      }),
      false,
    );
  });

  test('shouldRouteComposerSendToSuperPlan skips non-super-plan modes', () => {
    const chat = createEmptyChatObject('sp3');
    chat.modeId = 'plan';
    assert.equal(
      shouldRouteComposerSendToSuperPlan(chat, {
        userText: 'Plan feature X',
        skillId: null,
        attachmentCount: 0,
      }),
      false,
    );
  });
});
