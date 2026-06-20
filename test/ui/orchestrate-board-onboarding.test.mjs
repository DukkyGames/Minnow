/**
 * MIN-5: board onboarding panel and composer strip visibility helper.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { createEmptyChatObject, setSessionStateForTests } = await import(
  '../../src/state/sessions.ts'
);
const { shouldHideComposerPlanStripForOrchestrateBoardOnboarding } = await import(
  '../../src/ui/orchestrate-plan-picker.ts'
);
const {
  mountBoardOnboardingPanel,
  disposeBoardViewForTests,
  resolveBoardOnboardingBusyPhase,
  syncBoardOnboardingBusyUI,
} = await import('../../src/ui/orchestrate-board.ts');
const {
  setBoardOnboardingGitSetupActive,
  setBoardKickoffInProgress,
} = await import('../../src/ui/orchestrate-board-onboarding-state.ts');
const { setStreaming } = await import('../../src/app-state.ts');

describe('orchestrate board onboarding (MIN-5)', () => {
  afterEach(() => {
    disposeBoardViewForTests();
    setSessionStateForTests(null);
    setStreaming(false);
    setBoardOnboardingGitSetupActive(false);
    setBoardKickoffInProgress(false);
  });

  test('shouldHideComposerPlanStripForOrchestrateBoardOnboarding is true only for board shell without store', () => {
    const chat = createEmptyChatObject('');
    chat.modeId = 'orchestrate';
    chat.viewMode = 'board';
    assert.equal(shouldHideComposerPlanStripForOrchestrateBoardOnboarding(chat), true);

    chat.orchestrateBoard = {
      planPath: 'documentation/plans/x.md',
      tasks: [],
      waves: [{ id: 'W1', status: 'planned' }],
      startedAt: 1,
      lastUpdatedAt: 1,
    };
    assert.equal(shouldHideComposerPlanStripForOrchestrateBoardOnboarding(chat), false);

    delete chat.orchestrateBoard;
    chat.viewMode = 'chat';
    assert.equal(shouldHideComposerPlanStripForOrchestrateBoardOnboarding(chat), false);
  });

  test('mountBoardOnboardingPanel renders plan select with mocked discovery', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chat = createEmptyChatObject('');
    chat.id = '33333333-3333-3333-3333-333333333333';
    chat.modeId = 'orchestrate';
    chat.viewMode = 'board';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const wrap = document.createElement('div');
    wrap.className = 'board-onboarding';
    document.body.appendChild(wrap);

    const planPath = 'documentation/plans/mock-board.md';
    await mountBoardOnboardingPanel(wrap, chat, {
      discoverPlans: async () => ({ plans: [planPath] }),
    });

    const sel = document.getElementById('boardOnboardingPlanSelect');
    assert.ok(sel && sel.nodeName === 'SELECT');
    assert.ok(sel.options.length >= 2);
    assert.equal(chat.orchestratePlanPath, planPath);
  });

  test('resolveBoardOnboardingBusyPhase prefers plan load over stream', () => {
    const chat = createEmptyChatObject('');
    chat.id = '77777777-7777-7777-7777-777777777777';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });
    setStreaming(false);
    assert.equal(resolveBoardOnboardingBusyPhase(true), 'plans');
    assert.equal(resolveBoardOnboardingBusyPhase(false), 'idle');
  });

  test('resolveBoardOnboardingBusyPhase shows git-setup during preflight skill turn', () => {
    setBoardOnboardingGitSetupActive(true);
    assert.equal(resolveBoardOnboardingBusyPhase(false), 'git-setup');
    setBoardOnboardingGitSetupActive(false);
  });

  test('syncBoardOnboardingBusyUI shows git-setup status without kanban preview', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const wrap = document.createElement('div');
    wrap.className = 'board-onboarding';
    wrap.innerHTML = `
      <div class="board-onboarding__panel">
        <div class="board-onboarding__status hidden" data-board-onboarding-status role="status">
          <span class="board-onboarding__status-dots"><span class="board-onboarding__status-dot"></span></span>
          <span class="board-onboarding__status-label" data-board-onboarding-status-label"></span>
        </div>
        <div class="board-onboarding__preview hidden" data-board-onboarding-preview aria-hidden="true"></div>
        <div data-board-onboarding-setup></div>
      </div>`;
    document.body.appendChild(wrap);

    syncBoardOnboardingBusyUI(wrap, 'git-setup');
    assert.equal(wrap.dataset.boardOnboardingBusy, 'git-setup');
    const preview = wrap.querySelector('[data-board-onboarding-preview]');
    assert.ok(preview && preview.classList.contains('hidden'));
    assert.match(
      wrap.querySelector('[data-board-onboarding-status-label]')?.textContent ?? '',
      /Setting up git/i,
    );
  });

  test('mountBoardOnboardingPanel shows plan-loading status during slow discovery', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chat = createEmptyChatObject('');
    chat.id = '55555555-5555-5555-5555-555555555555';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const wrap = document.createElement('div');
    wrap.className = 'board-onboarding';
    document.body.appendChild(wrap);

    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    const mountPromise = mountBoardOnboardingPanel(wrap, chat, {
      discoverPlans: async () => {
        await gate;
        return { plans: ['documentation/plans/slow.md'] };
      },
    });

    await new Promise((r) => setImmediate(r));
    assert.equal(wrap.dataset.boardOnboardingBusy, 'plans');
    const status = wrap.querySelector('[data-board-onboarding-status]');
    assert.ok(status && !status.classList.contains('hidden'));
    assert.match(
      wrap.querySelector('[data-board-onboarding-status-label]')?.textContent ?? '',
      /Loading plans/i,
    );

    release();
    await mountPromise;
    assert.equal(wrap.dataset.boardOnboardingBusy, '');
  });

  test('syncBoardOnboardingBusyUI shows init preview when streaming', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chat = createEmptyChatObject('');
    chat.id = '66666666-6666-6666-6666-666666666666';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });
    setStreaming(true, chat.id);

    const wrap = document.createElement('div');
    wrap.className = 'board-onboarding';
    wrap.innerHTML = `
      <div class="board-onboarding__panel">
        <div class="board-onboarding__status hidden" data-board-onboarding-status role="status">
          <span class="board-onboarding__status-dots"><span class="board-onboarding__status-dot"></span></span>
          <span class="board-onboarding__status-label" data-board-onboarding-status-label></span>
        </div>
        <div class="board-onboarding__preview hidden" data-board-onboarding-preview aria-hidden="true"></div>
      </div>`;
    document.body.appendChild(wrap);

    syncBoardOnboardingBusyUI(wrap, 'init');
    assert.equal(wrap.dataset.boardOnboardingBusy, 'init');
    const preview = wrap.querySelector('[data-board-onboarding-preview]');
    assert.ok(preview && !preview.classList.contains('hidden'));
    assert.match(
      wrap.querySelector('[data-board-onboarding-status-label]')?.textContent ?? '',
      /Initializing board/i,
    );
  });

  test('setChatMode orchestrate defaults viewMode to board when no board store', async () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chatArea = document.createElement('div');
    chatArea.id = 'chatArea';
    document.body.appendChild(chatArea);

    const mainColumn = document.createElement('div');
    mainColumn.id = 'mainColumn';
    document.body.appendChild(mainColumn);

    const modeSelector = document.createElement('div');
    modeSelector.id = 'modeSelector';
    document.body.appendChild(modeSelector);

    const strip = document.createElement('div');
    strip.id = 'orchestratePlanStrip';
    strip.className = 'hidden';
    document.body.appendChild(strip);
    const planSel = document.createElement('select');
    planSel.id = 'orchestratePlanSelect';
    strip.appendChild(planSel);
    const planHint = document.createElement('span');
    planHint.id = 'orchestratePlanHint';
    strip.appendChild(planHint);
    const planRefresh = document.createElement('button');
    planRefresh.id = 'orchestratePlanRefresh';
    strip.appendChild(planRefresh);

    const chat = createEmptyChatObject('');
    chat.id = '44444444-4444-4444-4444-444444444444';
    chat.modeId = 'build';
    setSessionStateForTests({
      version: 2,
      activeId: chat.id,
      sidebarCollapsed: false,
      chats: [chat],
    });

    const { initModeSelector, setChatMode } = await import(
      '../../src/ui/mode-selector.ts'
    );
    initModeSelector();

    const result = setChatMode('orchestrate');
    assert.equal(result.ok, true);
    assert.equal(chat.viewMode, 'board');
    // renderChatFromHistory dispatches board render asynchronously; let it finish before session teardown.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
  });
});
