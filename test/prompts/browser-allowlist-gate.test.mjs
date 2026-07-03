/**
 * browser-allowlist-gate — history scan for preview browser tool use.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  BROWSER_PREVIEW_TOOL_IDS,
  chatHistoryHasBrowserToolUse,
} from '../../src/chat/prompts/browser-allowlist-gate.ts';

describe('chatHistoryHasBrowserToolUse', () => {
  test('returns false for empty history', () => {
    assert.equal(chatHistoryHasBrowserToolUse([]), false);
  });

  test('returns false when only non-browser tools were called', () => {
    const history = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ],
      },
    ];
    assert.equal(chatHistoryHasBrowserToolUse(history), false);
  });

  test('returns true after a preview browser tool call', () => {
    const history = [
      {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_1',
            type: 'function',
            function: { name: 'browser_navigate', arguments: '{"url":"https://example.com"}' },
          },
        ],
      },
    ];
    assert.equal(chatHistoryHasBrowserToolUse(history), true);
  });

  test('recognizes every BROWSER_PREVIEW_TOOL_IDS entry', () => {
    for (const toolId of BROWSER_PREVIEW_TOOL_IDS) {
      const history = [
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_1',
              type: 'function',
              function: { name: toolId, arguments: '{}' },
            },
          ],
        },
      ];
      assert.equal(
        chatHistoryHasBrowserToolUse(history),
        true,
        `expected activation for ${toolId}`,
      );
    }
  });
});
