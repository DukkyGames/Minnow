import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import {
  markCurrentTestAsStoppedForTests,
  setLiveCurrentTestMetaForTests,
} from '../../src/ui/benchmark-page.ts';

describe('benchmark stopped card', () => {
  beforeEach(async () => {
    const { Window } = await import('happy-dom');
    const window = new Window();
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.performance = window.performance;
    globalThis.CSS = {
      escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '\\$&'),
    };

    document.body.innerHTML = `
      <div id="benchmarkSuites" class="is-live">
        <section class="benchmark-suite-block" data-suite="capability">
          <div class="benchmark-test-grid" data-suite-tests>
            <article class="benchmark-test-card is-running is-current" data-test-id="cap-stream">
              <div class="benchmark-test-card-status"></div>
              <div class="benchmark-test-card-body">
                <h3 class="benchmark-test-card-title">Streaming completion</h3>
                <p class="benchmark-test-card-meta">Running…</p>
              </div>
            </article>
          </div>
        </section>
      </div>
    `;
  });

  afterEach(() => {
    setLiveCurrentTestMetaForTests(null);
  });

  test('markCurrentTestAsStopped shows X icon and Stopped meta', () => {
    setLiveCurrentTestMetaForTests({
      testId: 'cap-stream',
      suite: 'capability',
      label: 'Streaming completion',
    });

    markCurrentTestAsStoppedForTests();

    const card = document.querySelector('[data-test-id="cap-stream"]');
    assert.ok(card?.classList.contains('is-stopped'));
    assert.ok(card?.classList.contains('is-fail'));
    assert.ok(!card?.classList.contains('is-running'));
    assert.equal(card?.querySelector('.benchmark-test-card-meta')?.textContent, 'Stopped');
    assert.match(card?.querySelector('.benchmark-test-card-status')?.innerHTML ?? '', /fi-rr-cross-circle/);
    assert.equal(card?.getAttribute('role'), 'button');
    assert.equal(card?.getAttribute('tabindex'), '0');
  });
});
