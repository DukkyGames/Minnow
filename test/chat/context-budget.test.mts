/**
 * Context budget enforcement (MIN-39).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  applyContextBudget,
  estimateApiMessagesTokens,
  formatContextTrimStatus,
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
  test('effectiveLimit is min(agent, model) with safety margin', () => {
    const resolved = resolveContextBudget({
      agentConfig: { maxInputTokens: 8000, enforcementPolicy: 'slide' },
      modelLimit: 32000,
    });
    assert.equal(resolved.agentCap, 8000);
    assert.equal(resolved.modelLimit, 32000);
    assert.equal(resolved.effectiveLimit, 7200);
  });

  test('agent null yields no effective limit', () => {
    const resolved = resolveContextBudget({
      agentConfig: { maxInputTokens: null, enforcementPolicy: 'slide' },
      modelLimit: 32000,
    });
    assert.equal(resolved.effectiveLimit, null);
  });

  test('uses agent cap only when model limit unknown', () => {
    const resolved = resolveContextBudget({
      agentConfig: { maxInputTokens: 10000, enforcementPolicy: 'truncate' },
      modelLimit: null,
    });
    assert.equal(resolved.effectiveLimit, 9000);
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
      agentConfig: { maxInputTokens: 400, enforcementPolicy: 'truncate' },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 400,
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
      agentConfig: { maxInputTokens: 100, enforcementPolicy: 'truncate' },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 100,
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
        maxInputTokens: 8,
        enforcementPolicy: 'slide',
        minRecentTurns: 1,
      },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 8,
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
      agentConfig: { maxInputTokens: 12, enforcementPolicy: 'slide' },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 12,
      enforcementPolicy: 'slide',
      minRecentTurns: 1,
    });
    const serialized = out.messages.map((m) => serializeRoleContent(m)).join('\n');
    assert.ok(!serialized.includes('old task'));
    assert.ok(serialized.includes('new task'));
  });
});

describe('applyContextBudget summarize', () => {
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
        maxInputTokens: 15,
        enforcementPolicy: 'summarize',
        minRecentTurns: 1,
        summaryReserveTokens: 32,
      },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 15,
      enforcementPolicy: 'summarize',
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
});

describe('hard truncate single message', () => {
  test('adds truncation marker on oversized user line', () => {
    const messages: ApiMessage[] = [system('s'), user('z'.repeat(8000))];
    const resolved = resolveContextBudget({
      agentConfig: { maxInputTokens: 15, enforcementPolicy: 'truncate' },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 15,
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
  test('truncation never orphans a tool result after system', () => {
    // Reproduces the sub-agent shape: one user task then many assistant/tool
    // round-trips. Previously message-level truncation produced [system, tool].
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
      agentConfig: { maxInputTokens: 40, enforcementPolicy: 'summarize' },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 40,
      enforcementPolicy: 'summarize',
      minRecentTurns: 1,
    });
    assert.equal(out.applied, true);
    // System survives; the orphaned-tool bug would leave a tool right after it.
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
      agentConfig: { maxInputTokens: 20, enforcementPolicy: 'truncate' },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 20,
      enforcementPolicy: 'truncate',
    });
    assertValidToolSequence(out.messages);
    // The assistant that owns call_9 must still be present for its tool result.
    const hasAssistant = out.messages.some(
      (m) => m.role === 'assistant' && m.tool_calls?.some((c) => c.id === 'call_9'),
    );
    const hasTool = out.messages.some(
      (m) => m.role === 'tool' && m.tool_call_id === 'call_9',
    );
    assert.equal(hasAssistant, hasTool);
  });
});

describe('formatContextTrimStatus', () => {
  test('includes policy and drop count', () => {
    const line = formatContextTrimStatus('slide', 4, false);
    assert.match(line, /slide/);
    assert.match(line, /4 older messages/);
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
      agentConfig: { maxInputTokens: 400, enforcementPolicy: 'archive' },
      modelLimit: null,
    });
    const out = applyContextBudget(messages, resolved, {
      maxInputTokens: 400,
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
