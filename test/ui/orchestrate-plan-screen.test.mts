import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
  isSuperPlanPipelineResumable,
  isSuperPlanPlanScreenRestorable,
  buildRevisePlanComposerDraft,
  openOrchestratePlanScreen,
  renderOrchestratePlanScreen,
  resetOrchestratePlanScreenForTests,
  resolveOrchestratePlanScreenQuestionHost,
  restoreOrchestratePlanScreenSessionFromChat,
  shouldRouteComposerSendToSuperPlan,
  suspendOrchestratePlanScreenOnLeave,
} from '../../src/ui/orchestrate-plan-screen.ts';
import { switchChat } from '../../src/ui/sidebar.ts';
import { createInitialSuperPlanStages } from '../../src/chat/super-plan/state.ts';
import { showQuestionCardsModal } from '../../src/ui/question-cards-modal.ts';
import { appendStreamingAssistantRow, renderChatFromHistory } from '../../src/ui/messages.ts';
import { isStreamDomVisible } from '../../src/chat/streaming-state.ts';
import { createEmptyChatObject, setSessionStateForTests } from '../../src/state/sessions.ts';

/** Test DOM matching Code chat: `.chat-viewport` > `#chatArea`. */
function mountCodeChatAreaForTests(): HTMLElement {
  const viewport = document.createElement('div');
  viewport.className = 'chat-viewport';
  const area = document.createElement('main');
  area.id = 'chatArea';
  viewport.appendChild(area);
  document.body.appendChild(viewport);
  return area;
}

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

  test('spec_confirm phase presents build spec preview and checkpoint actions', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = mountCodeChatAreaForTests();
    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('sp-spec');
    chat.modeId = 'super-plan';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderOrchestratePlanScreen({
      phase: 'spec_confirm',
      chatId: chat.id,
      planPath: 'documentation/plans/references/oauth-spec.md',
      savedPrompt: 'Add OAuth login',
    });

    assert.ok(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID));
    assert.match(document.body.textContent ?? '', /Confirm build spec/);
    const root = document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID);
    assert.ok(
      root?.classList.contains('orchestrate-plan-screen--super-plan-artifact'),
      'spec_confirm should use the wider Super Plan artifact layout',
    );
    const preview = document.querySelector('.orchestrate-plan-screen__preview');
    assert.ok(preview, 'build spec preview mount should exist');
    assert.match(
      preview?.textContent ?? '',
      /build spec file is empty or could not be loaded/,
      'spec_confirm should use build-spec empty copy when no markdown is loaded yet',
    );
    assert.ok(
      [...document.querySelectorAll('.orchestrate-plan-screen__btn')].some(
        (btn) => btn.textContent === 'Confirm spec',
      ),
    );
    assert.ok(
      [...document.querySelectorAll('.orchestrate-plan-screen__btn')].some(
        (btn) => btn.textContent === 'Revise spec',
      ),
    );

    const session = getOrchestratePlanScreenSession();
    assert.equal(session?.phase, 'spec_confirm');
    assert.equal(session?.planPath, 'documentation/plans/references/oauth-spec.md');
  });

  test('buildRevisePlanComposerDraft references the plan file and leaves room to edit', () => {
    assert.equal(
      buildRevisePlanComposerDraft('documentation/plans/oauth.md'),
      'Revise the plan at documentation/plans/oauth.md:\n\n',
    );
    assert.equal(
      buildRevisePlanComposerDraft('documentation/plans/oauth.md', 'Add OAuth login'),
      'Revise the plan at documentation/plans/oauth.md:\n\n(Original planning request: Add OAuth login)\n',
    );
  });

  test('plan preview CSS fills column height and scrolls long artifacts', () => {
    const cssPath = join(
      dirname(fileURLToPath(import.meta.url)),
      '../../src/styles/orchestrate-plan-screen.css',
    );
    const css = readFileSync(cssPath, 'utf8');
    assert.match(
      css,
      /\.orchestrate-plan-screen:has\(\.orchestrate-plan-screen__preview-wrap\)[\s\S]*justify-content:\s*flex-start/,
    );
    assert.match(
      css,
      /\.orchestrate-plan-screen:has\(\.orchestrate-plan-screen__preview-wrap\)[\s\S]*\.orchestrate-plan-screen__preview[\s\S]*max-height:\s*none/,
    );
    assert.match(
      css,
      /\.orchestrate-plan-screen:has\(\.orchestrate-plan-screen__preview-wrap\)[\s\S]*\.orchestrate-plan-screen__preview[\s\S]*overflow-y:\s*auto/,
    );
  });

  test('restore session from spec_confirm checkpoint keeps spec path for resume', () => {
    const chat = createEmptyChatObject('sp-spec-restore');
    chat.modeId = 'super-plan';
    chat.history.push({ role: 'user', content: 'Add OAuth login' });
    const stages = createInitialSuperPlanStages();
    const specPath = 'documentation/plans/references/oauth-spec.md';
    stages.spec_confirm.status = 'blocked_user';
    stages.spec_confirm.artifactPath = specPath;
    chat.superPlan = {
      slug: 'oauth',
      prompt: 'Add OAuth login',
      activeStage: 'spec_confirm',
      stages,
      specPath,
      researchPath: 'documentation/plans/references/oauth-research.md',
      planPath: 'documentation/plans/oauth.md',
      uiInvolved: false,
    };
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    assert.equal(restoreOrchestratePlanScreenSessionFromChat(chat), true);
    const session = getOrchestratePlanScreenSession();
    assert.equal(session?.phase, 'spec_confirm');
    assert.equal(session?.planPath, specPath);
    assert.equal(session?.planScreenSuspended, true);
  });

  test('view chat suspends overlay and resume remounts working phase', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = mountCodeChatAreaForTests();
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
    const banner = document.getElementById(ORCHESTRATE_PLAN_BANNER_ID);
    assert.ok(banner);
    assert.equal(banner?.parentElement?.classList.contains('chat-viewport'), true);
    assert.equal(area.contains(banner), false, 'banner should float over chat, not inside scroll content');

    const resumeBtn = banner?.querySelector(
      '.orchestrate-plan-screen-banner__resume',
    ) as HTMLButtonElement | null;
    assert.ok(resumeBtn);
    resumeBtn?.click();
    assert.equal(document.getElementById(ORCHESTRATE_PLAN_BANNER_ID), null);
    assert.ok(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID));

    session = getOrchestratePlanScreenSession();
    assert.equal(session?.phase, 'working');
    assert.equal(session?.chatId, chat.id);
  });

  test('ask_question resolves embedded host on plan screen', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.localStorage = window.localStorage;
    globalThis.requestAnimationFrame = (cb: () => void) => {
      cb();
      return 0;
    };

    const area = mountCodeChatAreaForTests();
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

  test('switching away from restored super-plan chat removes resume banner', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    mountCodeChatAreaForTests();
    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('sp-switch-away');
    chat.modeId = 'super-plan';
    chat.history.push({ role: 'user', content: 'Add OAuth login' });
    const stages = createInitialSuperPlanStages();
    stages.research.status = 'running';
    chat.superPlan = {
      slug: 'oauth',
      prompt: 'Add OAuth login',
      activeStage: 'research',
      stages,
      specPath: 'documentation/plans/references/oauth-spec.md',
      researchPath: 'documentation/plans/references/oauth-research.md',
      planPath: 'documentation/plans/oauth.md',
      uiInvolved: false,
    };
    const otherChat = createEmptyChatObject('other-switch-away');
    otherChat.id = 'other-switch-away-chat';
    otherChat.history.push({ role: 'user', content: 'Hello from another chat' });
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat, otherChat],
    });

    assert.equal(restoreOrchestratePlanScreenSessionFromChat(chat), true);
    renderChatFromHistory(chat);
    assert.ok(document.getElementById(ORCHESTRATE_PLAN_BANNER_ID));

    setSessionStateForTests({
      version: 5,
      activeId: otherChat.id,
      sidebarCollapsed: false,
      chats: [chat, otherChat],
    });
    renderChatFromHistory(otherChat);

    assert.equal(
      document.getElementById(ORCHESTRATE_PLAN_BANNER_ID),
      null,
      'resume banner should not follow other chats',
    );
    assert.match(
      document.getElementById('chatArea')?.textContent ?? '',
      /Hello from another chat/,
    );
    assert.equal(getOrchestratePlanScreenSession()?.chatId, chat.id);
    assert.equal(getOrchestratePlanScreenSession()?.planScreenSuspended, true);
  });

  test('restore session from persisted superPlan shows resume banner after reload', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = mountCodeChatAreaForTests();
    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('sp-reload');
    chat.modeId = 'super-plan';
    chat.history.push({ role: 'user', content: 'Add OAuth login' });
    const stages = createInitialSuperPlanStages();
    stages.research.status = 'running';
    chat.superPlan = {
      slug: 'oauth',
      prompt: 'Add OAuth login',
      activeStage: 'research',
      stages,
      specPath: 'documentation/plans/references/oauth-spec.md',
      researchPath: 'documentation/plans/references/oauth-research.md',
      planPath: 'documentation/plans/oauth.md',
      uiInvolved: false,
    };
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    assert.equal(isSuperPlanPipelineResumable(chat), true);
    assert.equal(restoreOrchestratePlanScreenSessionFromChat(chat), true);

    const session = getOrchestratePlanScreenSession();
    assert.equal(session?.chatId, chat.id);
    assert.equal(session?.phase, 'super-plan-working');
    assert.equal(session?.planScreenSuspended, true);

    renderChatFromHistory(chat);
    const banner = document.getElementById(ORCHESTRATE_PLAN_BANNER_ID);
    assert.ok(banner);
    assert.equal(banner?.parentElement?.classList.contains('chat-viewport'), true);
    assert.equal(area.contains(banner), false, 'banner should float over chat, not inside scroll content');
    assert.equal(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID), null);
    assert.match(
      document.getElementById('chatArea')?.textContent ?? '',
      /Add OAuth login/,
      'transcript should render beneath the resume banner (not a blank page)',
    );
  });

  test('restore session from cancelled superPlan shows resume banner after reload', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = mountCodeChatAreaForTests();
    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('sp-cancelled-reload');
    chat.modeId = 'super-plan';
    chat.history.push({ role: 'user', content: 'Add OAuth login' });
    const stages = createInitialSuperPlanStages();
    stages.draft1.status = 'error';
    stages.draft1.error = 'Cancelled by user';
    chat.superPlan = {
      slug: 'oauth',
      prompt: 'Add OAuth login',
      activeStage: 'draft1',
      stages,
      cancelled: true,
      specPath: 'documentation/plans/references/oauth-spec.md',
      researchPath: 'documentation/plans/references/oauth-research.md',
      planPath: 'documentation/plans/oauth.md',
      uiInvolved: false,
    };
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    assert.equal(isSuperPlanPipelineResumable(chat), false);
    assert.equal(isSuperPlanPlanScreenRestorable(chat), true);
    assert.equal(restoreOrchestratePlanScreenSessionFromChat(chat), true);

    const session = getOrchestratePlanScreenSession();
    assert.equal(session?.chatId, chat.id);
    assert.equal(session?.phase, 'super-plan-working');
    assert.equal(session?.planScreenSuspended, true);

    renderChatFromHistory(chat);
    const banner = document.getElementById(ORCHESTRATE_PLAN_BANNER_ID);
    assert.ok(banner);
    assert.match(
      banner?.textContent ?? '',
      /Super Plan was stopped/,
      'cancelled pipeline should offer a return path after reload',
    );
    assert.equal(area.contains(banner), false, 'banner should float over chat, not inside scroll content');
  });

  test('view chat during grill questions migrates strip to composer without cancelling', async () => {
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
    const mainColumn = document.createElement('div');
    mainColumn.id = 'mainColumn';
    document.body.appendChild(mainColumn);
    const composerHost = document.createElement('div');
    composerHost.id = 'questionHost';
    composerHost.hidden = true;
    mainColumn.appendChild(composerHost);

    const chat = createEmptyChatObject('sp-grill');
    chat.modeId = 'super-plan';
    chat.history.push({ role: 'user', content: 'Add OAuth login' });
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderOrchestratePlanScreen({
      phase: 'questions',
      chatId: chat.id,
      savedPrompt: 'Add OAuth login',
    });

    const planHost = document.getElementById(ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID);
    assert.ok(planHost);

    const { showQuestionCardsModal, resetQuestionCardsModalForTests } = await import(
      '../../src/ui/question-cards-modal.ts'
    );

    let settled = false;
    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Which auth provider?',
            options: [
              { id: 'a', label: 'Google' },
              { id: 'b', label: 'GitHub' },
            ],
          },
        ],
      },
      {},
      { host: planHost!, embedded: true, chatId: chat.id },
    );

    assert.ok(planHost?.querySelector('.question-cards-panel'));

    const viewChatBtn = [...document.querySelectorAll('.orchestrate-plan-screen__btn')].find(
      (btn) => btn.textContent === 'View chat',
    ) as HTMLButtonElement | undefined;
    assert.ok(viewChatBtn);
    viewChatBtn.click();
    assert.equal(isOrchestratePlanScreenSuspended(), true);
    assert.equal(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID), null);
    assert.ok(composerHost.querySelector('.question-cards-panel'));
    assert.equal(planHost?.childElementCount, 0);

    const session = getOrchestratePlanScreenSession();
    assert.equal(session?.phase, 'questions');

    resetQuestionCardsModalForTests();
    settled = true;
    await modalPromise.catch(() => undefined);
    assert.equal(settled, true);
  });

  test('sidebar switch during grill questions migrates strip to composer without cancelling', async () => {
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
    const mainColumn = document.createElement('div');
    mainColumn.id = 'mainColumn';
    document.body.appendChild(mainColumn);
    const composerHost = document.createElement('div');
    composerHost.id = 'questionHost';
    composerHost.hidden = true;
    mainColumn.appendChild(composerHost);

    const chat = createEmptyChatObject('sp-grill-sidebar');
    chat.modeId = 'super-plan';
    chat.history.push({ role: 'user', content: 'Add OAuth login' });
    const otherChat = createEmptyChatObject('other');
    otherChat.id = 'other-chat';
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat, otherChat],
    });

    renderOrchestratePlanScreen({
      phase: 'questions',
      chatId: chat.id,
      savedPrompt: 'Add OAuth login',
    });

    const planHost = document.getElementById(ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID);
    assert.ok(planHost);

    const { showQuestionCardsModal, syncAskQuestionModalOnChatSwitch, resetQuestionCardsModalForTests } =
      await import('../../src/ui/question-cards-modal.ts');

    let settled = false;
    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Which auth provider?',
            options: [
              { id: 'a', label: 'Google' },
              { id: 'b', label: 'GitHub' },
            ],
          },
        ],
      },
      {},
      { host: planHost!, embedded: true, chatId: chat.id },
    );

    assert.ok(planHost?.querySelector('.question-cards-panel'));

    suspendOrchestratePlanScreenOnLeave(chat.id);
    assert.equal(isOrchestratePlanScreenSuspended(), true);
    assert.equal(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID), null);
    assert.ok(composerHost.querySelector('.question-cards-panel'));
    assert.equal(planHost?.childElementCount, 0);

    const session = getOrchestratePlanScreenSession();
    assert.equal(session?.phase, 'questions');

    syncAskQuestionModalOnChatSwitch(chat.id, otherChat.id);
    assert.equal(composerHost.hidden, true);

    syncAskQuestionModalOnChatSwitch(otherChat.id, chat.id);
    assert.equal(composerHost.hidden, false);
    assert.ok(composerHost.querySelector('.question-cards-panel'));

    resetQuestionCardsModalForTests();
    settled = true;
    await modalPromise.catch(() => undefined);
    assert.equal(settled, true);
  });

  test('renderChatFromHistory for other chat preserves suspended grill questions', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.requestAnimationFrame = (cb: () => void) => {
      cb();
      return 0;
    };

    mountCodeChatAreaForTests();
    const mainColumn = document.createElement('div');
    mainColumn.id = 'mainColumn';
    document.body.appendChild(mainColumn);
    const composerHost = document.createElement('div');
    composerHost.id = 'questionHost';
    composerHost.hidden = true;
    mainColumn.appendChild(composerHost);

    const chat = createEmptyChatObject('sp-grill-render');
    chat.modeId = 'super-plan';
    chat.history.push({ role: 'user', content: 'Add OAuth login' });
    const otherChat = createEmptyChatObject('other-render');
    otherChat.id = 'other-render-chat';
    otherChat.history.push({ role: 'user', content: 'Hello' });
    setSessionStateForTests({
      version: 5,
      activeId: otherChat.id,
      sidebarCollapsed: false,
      chats: [chat, otherChat],
    });

    renderOrchestratePlanScreen({
      phase: 'questions',
      chatId: chat.id,
      savedPrompt: 'Add OAuth login',
    });

    const planHost = document.getElementById(ORCHESTRATE_PLAN_SCREEN_QUESTIONS_ID);
    assert.ok(planHost);

    const {
      showQuestionCardsModal,
      syncAskQuestionModalOnChatSwitch,
      isAskQuestionModalOpenForChat,
      resetQuestionCardsModalForTests,
    } = await import('../../src/ui/question-cards-modal.ts');

    let settled = false;
    const modalPromise = showQuestionCardsModal(
      {
        questions: [
          {
            id: 'q1',
            prompt: 'Which auth provider?',
            options: [
              { id: 'a', label: 'Google' },
              { id: 'b', label: 'GitHub' },
            ],
          },
        ],
      },
      {},
      { host: planHost!, embedded: true, chatId: chat.id },
    );

    suspendOrchestratePlanScreenOnLeave(chat.id);
    syncAskQuestionModalOnChatSwitch(chat.id, otherChat.id);
    assert.equal(composerHost.hidden, true);

    renderChatFromHistory(otherChat);

    assert.equal(isAskQuestionModalOpenForChat(chat.id), true);
    assert.equal(getOrchestratePlanScreenSession()?.phase, 'questions');
    assert.equal(getOrchestratePlanScreenSession()?.planScreenSuspended, true);

    resetQuestionCardsModalForTests();
    settled = true;
    await modalPromise.catch(() => undefined);
    assert.equal(settled, true);
  });

  test('clicking active super-plan chat in sidebar shows transcript instead of blank area', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.localStorage = window.localStorage;

    const area = mountCodeChatAreaForTests();
    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('sp-sidebar-same');
    chat.modeId = 'super-plan';
    chat.history.push({ role: 'user', content: 'Add OAuth login' });
    const stages = createInitialSuperPlanStages();
    stages.research.status = 'running';
    chat.superPlan = {
      slug: 'oauth',
      prompt: 'Add OAuth login',
      activeStage: 'research',
      stages,
      specPath: 'documentation/plans/references/oauth-spec.md',
      researchPath: 'documentation/plans/references/oauth-research.md',
      planPath: 'documentation/plans/oauth.md',
      uiInvolved: false,
    };
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderOrchestratePlanScreen({
      phase: 'super-plan-working',
      chatId: chat.id,
      savedPrompt: 'Add OAuth login',
    });
    assert.ok(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID));

    switchChat(chat.id);
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(document.getElementById(ORCHESTRATE_PLAN_SCREEN_ROOT_ID), null);
    assert.equal(isOrchestratePlanScreenSuspended(), true);
    const banner = document.getElementById(ORCHESTRATE_PLAN_BANNER_ID);
    assert.ok(banner, 'resume banner should appear after sidebar click');
    assert.match(
      document.getElementById('chatArea')?.textContent ?? '',
      /Add OAuth login/,
      'transcript should render beneath the resume banner (not a blank page)',
    );
  });

  test('skip interview button shows only while the grill stage is active', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const area = mountCodeChatAreaForTests();
    document.body.appendChild(
      Object.assign(document.createElement('div'), { id: 'mainColumn' }),
    );

    const chat = createEmptyChatObject('sp-skip');
    chat.modeId = 'super-plan';
    const stages = createInitialSuperPlanStages();
    stages.grill.status = 'running';
    chat.superPlan = {
      slug: 'oauth',
      prompt: 'Add OAuth login',
      activeStage: 'grill',
      stages,
    };
    setSessionStateForTests({
      version: 5,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    renderOrchestratePlanScreen({
      phase: 'super-plan-working',
      chatId: chat.id,
      savedPrompt: 'Add OAuth login',
    });

    const skipBtn = document.querySelector(
      '[data-plan-skip-interview]',
    ) as HTMLButtonElement | null;
    assert.ok(skipBtn, 'skip interview button should render');
    assert.equal(skipBtn?.hidden, false, 'skip button visible during the interview');

    // Advancing past the interview hides the button.
    chat.superPlan.activeStage = 'spec_confirm';
    renderOrchestratePlanScreen({
      phase: 'super-plan-working',
      chatId: chat.id,
      savedPrompt: 'Add OAuth login',
    });
    const skipAfter = document.querySelector(
      '[data-plan-skip-interview]',
    ) as HTMLButtonElement | null;
    assert.equal(skipAfter?.hidden, true, 'skip button hidden once past the interview');
  });
});
