/**
 * Metrics strip paints the canonical last-turn snapshot and survives model-cache refreshes.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  installHappyDomGlobals,
  seedMinimalSession,
  teardownHappyDomAsync,
} from '../os/dom-helpers.mts';

const { setSessionStateForTests, getActiveChat } = await import('../../src/state/sessions.ts');
const { refreshMetricsStripForChat } = await import('../../src/ui/stats.ts');
const { showCachedModelInfo } = await import('../../src/api/models.ts');
const { formatStatCount } = await import('../../src/usage/format-stat-count.ts');
const { buildLastStatsSnapshot } = await import('../../src/usage/chat-turn-metrics.ts');

/** @type {import('happy-dom').Window | undefined} */
let win;

function setupStripDom() {
  win = new Window();
  installHappyDomGlobals(win);
  document.body.innerHTML = `
    <select id="modelSelect"><option value="local/qwen" selected>qwen</option></select>
    <div id="stripTPS">—</div>
    <div id="stripTTFT">—</div>
    <div id="stripGen">—</div>
    <div id="stripTotal">—</div>
    <div id="stripCost">—</div>
    <div id="barPrompt"></div>
    <div id="barCompletion"></div>
    <div id="cntPrompt">—</div>
    <div id="cntCompletion">—</div>
    <div id="iArch">—</div>
    <div id="iQuant">—</div>
    <div id="iCtx">—</div>
    <div id="iStop">—</div>
    <div id="statsExpandPreview"></div>
  `;
}

describe('metrics strip last-turn parity', { concurrency: false }, () => {
  afterEach(async () => {
    setSessionStateForTests(null);
    if (win) {
      await teardownHappyDomAsync(win);
      win = undefined;
    }
  });

  test('hydrates prompt-only lastStats from the last assistant chip usage', () => {
    setupStripDom();
    seedMinimalSession();
    const chat = getActiveChat();
    chat.lastStats = buildLastStatsSnapshot({}, { prompt_tokens: 61_692 });
    chat.history = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'ok',
        stats: {
          tokens_per_second: 21.4,
          time_to_first_token: 0.469,
          generation_time: 8.12,
        },
        usage: { prompt_tokens: 61_692, completion_tokens: 5_794, total_tokens: 67_486 },
      },
    ];

    refreshMetricsStripForChat(chat);

    assert.equal(document.getElementById('stripTotal')?.textContent, formatStatCount(67_486).display);
    assert.equal(document.getElementById('cntPrompt')?.textContent, formatStatCount(61_692).display);
    assert.equal(document.getElementById('cntCompletion')?.textContent, formatStatCount(5_794).display);
    assert.equal(document.getElementById('stripTPS')?.textContent, '21.4');
    assert.equal(chat.lastStats?.total_tokens, 67_486);
  });

  test('showCachedModelInfo does not blank last-turn tokens', () => {
    setupStripDom();
    seedMinimalSession();
    const chat = getActiveChat();
    chat.modelId = 'local/qwen';
    chat.lastStats = buildLastStatsSnapshot(
      { tokens_per_second: 40, time_to_first_token: 0.2, generation_time: 3 },
      { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050 },
    );

    refreshMetricsStripForChat(chat);
    showCachedModelInfo();

    assert.equal(document.getElementById('stripTotal')?.textContent, formatStatCount(1050).display);
    assert.equal(document.getElementById('stripTPS')?.textContent, '40.0');
    assert.equal(document.getElementById('cntPrompt')?.textContent, formatStatCount(1000).display);
  });
});
