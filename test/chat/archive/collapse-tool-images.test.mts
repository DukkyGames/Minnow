/**
 * Archive collapse must not treat screenshot follow-ups as history rows.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { replaceArchivedRangesWithPlaceholder } from '../../../src/chat/archive/collapse.ts';
import type { ApiMessage } from '../../../src/types.ts';

describe('archive collapse vs tool screenshot follow-ups', () => {
  test('keeps a follow-up when the parent tool row is not collapsed', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'browser_screenshot', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'saved' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '[tool screenshot]' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } },
        ],
        toolImageFollowUp: true,
      },
    ];
    const { messages: out } = replaceArchivedRangesWithPlaceholder(messages, [], 4);
    assert.equal(out.length, messages.length);
    assert.equal(out[4]?.role, 'user');
  });

  test('drops a follow-up when the parent tool row is archived', () => {
    const messages: ApiMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', type: 'function', function: { name: 'browser_screenshot', arguments: '{}' } },
        ],
      },
      { role: 'tool', tool_call_id: 'c1', content: 'saved' },
      {
        role: 'user',
        content: [
          { type: 'text', text: '[tool screenshot]' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } },
        ],
        toolImageFollowUp: true,
      },
      { role: 'user', content: 'later' },
    ];
    // History indices 0..3 map to user, assistant, tool, (follow-up is not history).
    // Collapse the first three history rows (user + assistant + tool).
    const { messages: out } = replaceArchivedRangesWithPlaceholder(
      messages,
      [{ startIndex: 0, endIndex: 3, sourceTurnIndices: [0, 2] }],
      4,
    );
    assert.equal(
      out.some((m) => m.role === 'user' && m.toolImageFollowUp === true),
      false,
    );
    const later = out.find((m) => m.role === 'user' && m.content === 'later');
    assert.ok(later);
  });
});
