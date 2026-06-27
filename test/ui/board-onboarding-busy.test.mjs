/**
 * Board onboarding init UI helpers and busy-phase structure.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { formatBoardOnboardingPlanDisplay } = await import(
  '../../src/ui/orchestrate-board-plan-display.ts'
);
const {
  syncBoardOnboardingBusyUI,
  resolveBoardOnboardingBusyPhase,
  disposeBoardOnboardingUiTimers,
} = await import('../../src/ui/orchestrate-board-onboarding-ui.ts');
const { createEmptyChatObject } = await import('../../src/state/sessions.ts');
const { resetBoardOnboardingTransientState } = await import(
  '../../src/ui/orchestrate-board-onboarding-state.ts'
);
const { setStreaming } = await import('../../src/app-state.ts');

/** happy-dom windows keep the event loop alive unless closed. */
let testWindow = null;

afterEach(() => {
  disposeBoardOnboardingUiTimers();
  resetBoardOnboardingTransientState();
  setStreaming(false);
  testWindow?.close();
  testWindow = null;
});

function mountTestDom() {
  testWindow = new Window();
  globalThis.document = testWindow.document;
  globalThis.HTMLElement = testWindow.HTMLElement;
}

describe('formatBoardOnboardingPlanDisplay', () => {
  test('returns basename for posix paths', () => {
    assert.equal(
      formatBoardOnboardingPlanDisplay('documentation/plans/my-plan.md'),
      'my-plan.md',
    );
  });

  test('normalizes windows separators', () => {
    assert.equal(
      formatBoardOnboardingPlanDisplay('docs\\plans\\wave.md'),
      'wave.md',
    );
  });

  test('falls back when path is empty', () => {
    assert.equal(formatBoardOnboardingPlanDisplay('   '), 'Plan file');
  });
});

describe('syncBoardOnboardingBusyUI init phase', () => {
  test('hides setup and shows centered loader during init', () => {
    mountTestDom();

    const chat = createEmptyChatObject('');
    const wrap = document.createElement('div');
    wrap.className = 'board-onboarding';
    wrap.innerHTML = `
      <div class="board-onboarding__panel">
        <div class="board-onboarding__loader hidden" data-board-onboarding-loader hidden>
          <h2 data-board-onboarding-headline></h2>
          <p data-board-onboarding-status-message></p>
          <p class="hidden" data-board-onboarding-plan-name></p>
        </div>
        <div class="board-onboarding__setup" data-board-onboarding-setup>
          <h2 class="board-onboarding__title">Orchestrate a plan</h2>
        </div>
        <div class="board-onboarding__footer hidden" data-board-onboarding-footer hidden></div>
        <select id="boardOnboardingPlanSelect">
          <option value="documentation/plans/fixture.md" selected>fixture</option>
        </select>
      </div>
    `;

    syncBoardOnboardingBusyUI(wrap, 'init', chat);

    const panel = wrap.querySelector('.board-onboarding__panel');
    const setup = wrap.querySelector('[data-board-onboarding-setup]');
    const loader = wrap.querySelector('[data-board-onboarding-loader]');
    const planName = wrap.querySelector('[data-board-onboarding-plan-name]');

    assert.ok(panel?.classList.contains('board-onboarding__panel--busy'));
    assert.equal(setup.hidden, true);
    assert.equal(loader.hidden, false);
    assert.equal(planName.textContent, 'fixture.md');
    assert.match(
      wrap.querySelector('[data-board-onboarding-headline]')?.textContent ?? '',
      /Preparing your board/i,
    );
  });
});

describe('syncBoardGitPromptCopy', () => {
  test('updates prompt labels for remote setup', async () => {
    mountTestDom();

    const { createBoardGitSetupPrompt, syncBoardGitPromptCopy } = await import(
      '../../src/ui/orchestrate-board-onboarding-ui.ts'
    );

    const panel = createBoardGitSetupPrompt();
    syncBoardGitPromptCopy(panel, 'remote');

    assert.equal(
      panel.querySelector('.board-onboarding__git-prompt-title')?.textContent,
      'GitHub remote',
    );
    assert.match(
      panel.querySelector('.board-onboarding__git-prompt-yes')?.textContent ?? '',
      /connect remote/i,
    );
  });
});

describe('resolveBoardOnboardingBusyPhase git-prompt', () => {
  test('prefers git prompt over streaming', async () => {
    const { promptBoardGitSetup, resolveBoardGitSetupPrompt } = await import(
      '../../src/ui/orchestrate-board-onboarding-state.ts'
    );
    const { setStreaming } = await import('../../src/app-state.ts');
    setStreaming(true);
    const pending = promptBoardGitSetup('init');
    assert.equal(resolveBoardOnboardingBusyPhase(false), 'git-prompt');
    resolveBoardGitSetupPrompt(false);
    await pending;
    setStreaming(false);
  });
});
