/**
 * Per-message metric chips: token total derives from prompt+completion when
 * total_tokens is missing (legacy / local providers).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';

const { appendStats } = await import('../../src/ui/messages.ts');

function setupDom() {
  const window = new Window();
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  return window;
}

describe('appendStats chip parity', { concurrency: false }, () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('shows red token chip from prompt + completion without total_tokens', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';

    appendStats(
      wrap,
      {
        tokens_per_second: 43.8,
        time_to_first_token: 0.469,
        generation_time: 31.486,
        prompt_tokens_per_second: 275,
        draft_acceptance: 0.78,
      },
      { prompt_tokens: 10000, completion_tokens: 5522 },
    );

    const chips = wrap.querySelector('.msg-stats');
    assert.ok(chips);
    const texts = [...chips.querySelectorAll('.stat-chip')].map((el) => el.textContent);
    assert.ok(texts.some((t) => t.includes('tok/s') && t.includes('43.8')));
    assert.ok(texts.some((t) => t.includes('15522') && t.includes('tokens')));
    assert.ok(texts.some((t) => t.includes('pp') && t.includes('275')));
    assert.ok(texts.some((t) => t.includes('draft') && t.includes('78%')));
  });

  test('keeps an explicit total_tokens value', () => {
    setupDom();
    const wrap = document.createElement('div');
    wrap.className = 'msg assistant';

    appendStats(wrap, { tokens_per_second: 10 }, { total_tokens: 15522 });

    const red = wrap.querySelector('.stat-chip.r');
    assert.ok(red);
    assert.match(red.textContent ?? '', /15522/);
  });
});
