/**
 * Compare → Chat handoff helpers (MIN-169).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  buildCompareChatHistory,
  buildCompareChatName,
} from '../../src/compare/continue-in-chat.ts';
import { GUARD_OPEN_PREFIX } from '../../src/lib/untrusted.mjs';

const COLUMNS = [
  {
    label: 'A',
    text: 'Alpha response body.',
    providerId: 'local',
    modelId: 'alpha-model',
  },
  {
    label: 'B',
    text: 'Beta response body.',
    providerId: 'cloud',
    modelId: 'beta-model',
  },
];

describe('buildCompareChatHistory', () => {
  test('seeds user prompt and selected assistant response', () => {
    const history = buildCompareChatHistory({
      prompt: 'Explain recursion.',
      columns: COLUMNS,
      selectedIndex: 0,
    });

    assert.equal(history.length, 2);
    assert.equal(history[0]?.role, 'user');
    assert.equal(history[1]?.role, 'assistant');
    assert.match(history[0]!.content, /Explain recursion\./);
    assert.match(history[0]!.content, /Beta response body\./);
    assert.match(history[1]!.content, /Alpha response body\./);
    assert.ok(history[0]!.content.includes(GUARD_OPEN_PREFIX));
    assert.ok(history[1]!.content.includes(GUARD_OPEN_PREFIX));
  });

  test('omits reference block when only one column has text', () => {
    const history = buildCompareChatHistory({
      prompt: 'Single column run.',
      columns: [
        {
          label: 'A',
          text: 'Only response.',
          providerId: 'local',
          modelId: 'solo',
        },
      ],
      selectedIndex: 0,
    });

    assert.equal(history.length, 2);
    assert.equal(history[0]?.role, 'user');
    assert.equal(history[0]?.content, 'Single column run.');
    assert.match(history[1]!.content, /Only response\./);
  });

  test('throws when selected column has no response text', () => {
    assert.throws(
      () =>
        buildCompareChatHistory({
          prompt: 'Hello',
          columns: [{ label: 'A', text: '   ', providerId: 'local', modelId: 'x' }],
          selectedIndex: 0,
        }),
      /No response text/,
    );
  });
});

describe('buildCompareChatName', () => {
  test('includes blind label and model name', () => {
    const name = buildCompareChatName(COLUMNS[0]!);
    assert.match(name, /^Compare · A · /);
    assert.match(name, /Alpha Model/i);
  });
});
