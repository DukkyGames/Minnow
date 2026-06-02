/**
 * Board onboarding init UI helpers and busy-phase structure.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';

const {
  formatBoardOnboardingPlanDisplay,
  syncBoardOnboardingBusyUI,
} = await import('../../src/ui/orchestrate-board.ts');

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
  test('hides setup and shows kanban skeleton during init', () => {
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const wrap = document.createElement('div');
    wrap.className = 'board-onboarding';
    wrap.innerHTML = `
      <div class="board-onboarding__panel">
        <div class="board-onboarding__init-lead hidden" data-board-onboarding-init-lead hidden>
          <p class="board-onboarding__init-plan" data-board-onboarding-init-plan></p>
        </div>
        <div class="board-onboarding__status hidden" data-board-onboarding-status>
          <span class="board-onboarding__status-dots"></span>
          <span data-board-onboarding-status-label></span>
        </div>
        <div class="board-onboarding__preview hidden" data-board-onboarding-preview>
          <div class="kanban-grid board-onboarding__kanban-skeleton"></div>
        </div>
        <div class="board-onboarding__setup" data-board-onboarding-setup>
          <h2 class="board-onboarding__title">Orchestrate a plan</h2>
        </div>
        <select id="boardOnboardingPlanSelect">
          <option value="documentation/plans/fixture.md" selected>fixture</option>
        </select>
      </div>
    `;

    syncBoardOnboardingBusyUI(wrap, 'init');

    const panel = wrap.querySelector('.board-onboarding__panel');
    const setup = wrap.querySelector('[data-board-onboarding-setup]');
    const preview = wrap.querySelector('[data-board-onboarding-preview]');
    const initPlan = wrap.querySelector('[data-board-onboarding-init-plan]');

    assert.ok(panel.classList.contains('board-onboarding__panel--busy'));
    assert.equal(setup.hidden, true);
    assert.equal(preview.classList.contains('hidden'), false);
    assert.equal(initPlan.textContent, 'fixture.md');
    assert.ok(wrap.querySelector('.board-onboarding__kanban-skeleton'));
  });
});
