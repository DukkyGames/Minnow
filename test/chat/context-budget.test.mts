/**
 * Context budget enforcement (MIN-39).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyContextBudget,
  estimateApiMessagesTokens,
  formatContextTrimStatus,
  partitionTurns,
  resolveContextBudget,
} from '../../src/chat/context-budget.ts';
import type { ApiMessage, ToolCall } from '../../src/types.ts';

function user(content: string): ApiMessage {
  return { role: 'user', content };
}

function assistant(content: string): ApiMessage {
  return { role: 'assistant', content };
}

function system(content: string): ApiMessage {
  return { role: 'system', content };
}

function toolResult(id: string, content: string): ApiMessage {
  return { role: 'tool', tool_call_id: id, content };
}

function assistantWithTools(content: string | null, toolCalls: ToolCall[]): ApiMessage {
  return {
    role: 'assistant',
    content,
    tool_calls: toolCalls,
  };
}

describe('resolveContextBudget', () => {
  test('effectiveLimit is 90% of model limit', () => {
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'slide' },
      modelLimit: 32000,
    });
    assert.equal(resolved.modelLimit, 32000);
    assert.equal(resolved.effectiveLimit, 28800);
  });

  test('unknown model limit yields no effective limit', () => {
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'slide' },
      modelLimit: null,
    });
    assert.equal(resolved.effectiveLimit, null);
  });
});

describe('applyContextBudget truncate', () => {
  test('drops oldest history after system block', () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('a'.repeat(400)),
      assistant('b'.repeat(400)),
      user('c'.repeat(400)),
      assistant('d'.repeat(400)),
    ];
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'truncate' },
      modelLimit: 400,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'truncate',
    });
    assert.equal(out.applied, true);
    assert.ok(out.messages[0].role === 'system');
    assert.ok(estimateApiMessagesTokens(out.messages) <= (resolved.effectiveLimit ?? 0));
    assert.ok(out.droppedMessageCount >= 1);
  });

  test('does not remove leading system messages', () => {
    const messages: ApiMessage[] = [
      system('one'),
      system('two'),
      user('x'.repeat(2000)),
    ];
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'truncate' },
      modelLimit: 120,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'truncate',
    });
    assert.equal(out.messages[0].role, 'system');
    assert.equal((out.messages[0] as { content: string }).content, 'one');
    assert.equal((out.messages[1] as { content: string }).content, 'two');
  });
});

describe('applyContextBudget slide', () => {
  test('removes oldest turns and keeps minRecentTurns', () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('turn1'),
      assistant('reply1'),
      user('turn2'),
      assistant('reply2'),
      user('turn3'),
      assistant('reply3'),
    ];
    const resolved = resolveContextBudget({
      agentConfig: {
        enforcementPolicy: 'slide',
        minRecentTurns: 1,
      },
      modelLimit: 8,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'slide',
      minRecentTurns: 1,
    });
    assert.equal(out.applied, true);
    const text = out.messages.map((m) => serializeRoleContent(m)).join('|');
    assert.ok(!text.includes('turn1'));
    assert.ok(text.includes('turn3'));
  });

  test('drops assistant and tool messages as one turn', () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('old task'),
      assistantWithTools(null, [
        {
          id: 'tc1',
          type: 'function',
          function: { name: 'read_file', arguments: '{}' },
        },
      ]),
      toolResult('tc1', 'file body'),
      user('new task'),
      assistant('done'),
    ];
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'slide' },
      modelLimit: 16,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'slide',
      minRecentTurns: 1,
    });
    const serialized = out.messages.map((m) => serializeRoleContent(m)).join('\n');
    assert.ok(!serialized.includes('old task'));
    assert.ok(serialized.includes('new task'));
  });
});

describe('applyContextBudget dropMiddle', () => {
  test('compresses board-task tool loops after a single user seed', () => {
    const messages: ApiMessage[] = [system('sys')];
    messages.push(user('Execute orchestrate task W1-A'));
    for (let round = 0; round < 8; round += 1) {
      messages.push(
        assistantWithTools(null, [
          {
            id: `call_${round}`,
            type: 'function',
            function: { name: 'read_file', arguments: '{}' },
          },
        ]),
      );
      messages.push(toolResult(`call_${round}`, (`body ${round} `).repeat(20)));
    }
    const resolved = resolveContextBudget({
      agentConfig: {
        enforcementPolicy: 'dropMiddle',
        minRecentTurns: 2,
        summaryReserveTokens: 32,
      },
      modelLimit: 240,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'dropMiddle',
      minRecentTurns: 2,
      summaryReserveTokens: 32,
    });
    assert.equal(out.applied, true);
    assert.equal(out.summaryInjected, true);
    assert.ok(out.droppedTurns > 0);
    assert.ok(out.tokensAfter <= (resolved.effectiveLimit ?? 0));
    const hasSummary = out.messages.some(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('Prior context (compressed)'),
    );
    assert.ok(hasSummary);
    assertValidToolSequence(out.messages);
  });

  test('injects summary and stays under limit', () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('alpha '.repeat(40)),
      assistant('beta '.repeat(40)),
      user('gamma '.repeat(40)),
      assistant('delta '.repeat(40)),
    ];
    const resolved = resolveContextBudget({
      agentConfig: {
        enforcementPolicy: 'dropMiddle',
        minRecentTurns: 1,
        summaryReserveTokens: 32,
      },
      modelLimit: 20,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'dropMiddle',
      minRecentTurns: 1,
      summaryReserveTokens: 32,
    });
    assert.equal(out.applied, true);
    assert.equal(out.summaryInjected, true);
    const hasSummary = out.messages.some(
      (m) =>
        m.role === 'user' &&
        typeof m.content === 'string' &&
        m.content.includes('Prior context (compressed)'),
    );
    assert.ok(hasSummary);
    assert.ok(out.tokensAfter < out.tokensBefore);
  });

  test('summarize policy defers to async path (no sync trim)', () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('a'.repeat(400)),
      assistant('b'.repeat(400)),
    ];
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'summarize' },
      modelLimit: 100,
    });
    const out = applyContextBudget(messages, resolved);
    assert.equal(out.applied, false);
    assert.equal(out.messages.length, messages.length);
  });
});

describe('hard truncate single message', () => {
  test('adds truncation marker on oversized user line', () => {
    const messages: ApiMessage[] = [system('s'), user('z'.repeat(8000))];
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'truncate' },
      modelLimit: 20,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'truncate',
    });
    const lastUser = out.messages.find((m) => m.role === 'user');
    assert.ok(lastUser);
    assert.ok(
      typeof lastUser.content === 'string' &&
        lastUser.content.includes('[… truncated for context budget]'),
    );
  });
});

/** Assert an OpenAI-valid tool-call/tool-result sequence (no orphans, all answered). */
function assertValidToolSequence(messages: ApiMessage[]): void {
  for (let i = 0; i < messages.length; i += 1) {
    const m = messages[i];
    if (m.role === 'assistant' && m.tool_calls?.length) {
      const answered = new Set<string>();
      let j = i + 1;
      while (j < messages.length && messages[j].role === 'tool') {
        answered.add((messages[j] as { tool_call_id: string }).tool_call_id);
        j += 1;
      }
      for (const call of m.tool_calls) {
        assert.ok(answered.has(call.id), `assistant tool_call ${call.id} is unanswered`);
      }
    }
    if (m.role === 'tool') {
      const prev = messages[i - 1];
      const owner =
        (prev?.role === 'assistant' && prev.tool_calls) ||
        (prev?.role === 'tool' && messages.slice(0, i).reverse().find((p) => p.role === 'assistant'));
      assert.ok(prev, `tool message at ${i} has no predecessor`);
      assert.notEqual(prev.role, 'system', `tool message at ${i} orphaned directly after system`);
      assert.notEqual(prev.role, 'user', `tool message at ${i} orphaned directly after user`);
      assert.ok(owner, `tool message at ${i} has no owning assistant`);
    }
  }
}

describe('applyContextBudget preserves tool-call pairing (sub-agent single turn)', () => {
  test('dropMiddle never orphans a tool result after system', () => {
    const messages: ApiMessage[] = [
      system('s'.repeat(400)),
      user('research task ' + 'q'.repeat(200)),
      assistantWithTools(null, [
        { id: 'call_1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ]),
      toolResult('call_1', 'first file '.repeat(200)),
      assistantWithTools(null, [
        { id: 'call_2', type: 'function', function: { name: 'read_file', arguments: '{}' } },
      ]),
      toolResult('call_2', 'export default { plugins: {} }'),
    ];
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'dropMiddle' },
      modelLimit: 50,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'dropMiddle',
      minRecentTurns: 1,
    });
    assert.equal(out.applied, true);
    assert.equal(out.messages[0].role, 'system');
    assertValidToolSequence(out.messages);
  });

  test('truncate policy keeps the most recent assistant/tool pair intact', () => {
    const messages: ApiMessage[] = [
      system('s'),
      user('task'),
      assistantWithTools(null, [
        { id: 'call_9', type: 'function', function: { name: 'grep', arguments: '{}' } },
      ]),
      toolResult('call_9', 'z'.repeat(4000)),
    ];
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'truncate' },
      modelLimit: 24,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'truncate',
    });
    assertValidToolSequence(out.messages);
    const hasAssistant = out.messages.some(
      (m) => m.role === 'assistant' && m.tool_calls?.some((c) => c.id === 'call_9'),
    );
    const hasTool = out.messages.some(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_9',
    );
    assert.equal(hasAssistant, hasTool);
  });
});

describe('partitionTurns tool screenshot follow-ups', () => {
  test('binds an image follow-up to the assistant tool-call unit', () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('check ui'),
      assistantWithTools('', [
        { id: 'c1', type: 'function', function: { name: 'browser_screenshot', arguments: '{}' } },
      ]),
      toolResult('c1', 'saved'),
      {
        role: 'user',
        content: [
          { type: 'text', text: '[tool screenshot]' },
          { type: 'image_url', image_url: { url: 'data:image/png;base64,aaa' } },
        ],
        toolImageFollowUp: true,
      },
      assistant('looks fine'),
    ];
    const turns = partitionTurns(messages, 1);
    assert.deepEqual(turns, [
      { start: 1, end: 2 },
      { start: 2, end: 5 },
      { start: 5, end: 6 },
    ]);
  });
});

describe('formatContextTrimStatus', () => {
  test('includes policy and drop count', () => {
    const line = formatContextTrimStatus('slide', 4, false);
    assert.match(line, /slide/);
    assert.match(line, /4 older turns/);
  });
});

describe('applyContextBudget archive', () => {
  test('archive policy uses slide behavior', () => {
    const messages: ApiMessage[] = [
      system('sys'),
      user('a'.repeat(400)),
      assistant('b'.repeat(400)),
      user('c'.repeat(400)),
      assistant('d'.repeat(400)),
    ];
    const resolved = resolveContextBudget({
      agentConfig: { enforcementPolicy: 'archive' },
      modelLimit: 400,
    });
    const out = applyContextBudget(messages, resolved, {
      enforcementPolicy: 'archive',
      minRecentTurns: 1,
    });
    assert.equal(out.applied, true);
    assert.equal(out.policy, 'archive');
    assert.ok(out.tokensAfter <= (resolved.effectiveLimit ?? 0));
  });
});

function serializeRoleContent(m: ApiMessage): string {
  if (m.role === 'user' || m.role === 'assistant' || m.role === 'system') {
    return typeof m.content === 'string' ? m.content : '';
  }
  if (m.role === 'tool') return m.content;
  return '';
}
