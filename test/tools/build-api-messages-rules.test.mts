import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { pushOutboundSystemMessages } from '../../src/tools/api-system-messages.ts';
import type { ApiMessage } from '../../src/types.ts';

function systemMessages(messages: ApiMessage[]): ApiMessage[] {
  return messages.filter((m) => m.role === 'system');
}

describe('pushOutboundSystemMessages user rules', () => {
  test('composed only yields one system message', () => {
    const messages: ApiMessage[] = [];
    pushOutboundSystemMessages(messages, {
      composedSystemPrompt: 'Composed stack',
      legacySysPrompt: '',
    });
    assert.equal(systemMessages(messages).length, 1);
    assert.equal(messages[0].content, 'Composed stack');
  });

  test('composed plus rules yields two system messages in order', () => {
    const messages: ApiMessage[] = [];
    pushOutboundSystemMessages(messages, {
      composedSystemPrompt: 'Composed stack',
      legacySysPrompt: '',
      userRulesContent: 'RULES_MARKER_24',
    });
    assert.equal(systemMessages(messages).length, 2);
    assert.equal(messages[0].content, 'Composed stack');
    assert.equal(messages[1].content, 'RULES_MARKER_24');
  });

  test('empty rules content skips second system message', () => {
    const messages: ApiMessage[] = [];
    pushOutboundSystemMessages(messages, {
      legacySysPrompt: 'Legacy only',
      userRulesContent: '   ',
    });
    assert.equal(systemMessages(messages).length, 1);
    assert.equal(messages[0].content, 'Legacy only');
  });

  test('legacy sysPrompt plus rules when composed empty', () => {
    const messages: ApiMessage[] = [];
    pushOutboundSystemMessages(messages, {
      legacySysPrompt: 'Legacy fallback',
      userRulesContent: 'User rule line',
    });
    assert.equal(systemMessages(messages).length, 2);
    assert.equal(messages[0].content, 'Legacy fallback');
    assert.equal(messages[1].content, 'User rule line');
  });
});
