/**
 * Unit tests for bounded parallel tool batch execution.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  executeToolCallBatch,
  STOPPED_TOOL_MSG,
} from '../../src/tools/execute-tool-batch.ts';
import type { ToolCall, ToolExecutionResult } from '../../src/types.ts';

function tc(name: string, id = name, args = '{}'): ToolCall {
  return {
    id,
    type: 'function',
    function: { name, arguments: args },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('executeToolCallBatch', () => {
  test('parallel segment runs faster than sequential sum', async () => {
    const calls = [tc('grep', 'a'), tc('read_file', 'b'), tc('git_status', 'c')];
    const started: string[] = [];
    const start = Date.now();

    await executeToolCallBatch({
      toolCalls: calls,
      execute: async (name) => {
        started.push(name);
        await delay(40);
        return { content: name };
      },
    });

    const elapsed = Date.now() - start;
    assert.ok(elapsed < 100, `expected parallel ~40ms, got ${elapsed}ms`);
    assert.equal(started.length, 3);
  });

  test('mutator splits segments and runs writes after reads', async () => {
    const order: string[] = [];
    const calls = [
      tc('grep', 'a'),
      tc('read_file', 'b'),
      tc('save_file', 'c'),
      tc('git_status', 'd'),
    ];

    await executeToolCallBatch({
      toolCalls: calls,
      execute: async (name) => {
        order.push(name);
        await delay(5);
        return { content: name };
      },
    });

    assert.deepEqual(order, ['grep', 'read_file', 'save_file', 'git_status']);
  });

  test('outcomes preserve original tool_calls order', async () => {
    const calls = [tc('grep', 'z'), tc('save_file', 'y'), tc('read_file', 'x')];
    const outcomes = await executeToolCallBatch({
      toolCalls: calls,
      execute: async (name) => ({ content: name }),
    });

    assert.deepEqual(
      outcomes.map((o) => o.toolCall.id),
      ['z', 'y', 'x'],
    );
  });

  test('parse errors do not block siblings in a parallel segment', async () => {
    const calls = [tc('grep', 'a', '{bad'), tc('read_file', 'b')];
    const executed: string[] = [];

    const outcomes = await executeToolCallBatch({
      toolCalls: calls,
      constrained: true,
      execute: async (name) => {
        executed.push(name);
        return { content: 'ok' };
      },
    });

    assert.equal(outcomes[0]!.parseError, 'Tool arguments were not valid JSON.');
    assert.equal(outcomes[1]!.result?.content, 'ok');
    assert.deepEqual(executed, ['read_file']);
  });

  test('aborted signal skips not-yet-started calls', async () => {
    const controller = new AbortController();
    const calls = [tc('grep', 'a'), tc('save_file', 'b'), tc('read_file', 'c')];

    const outcomes = await executeToolCallBatch({
      toolCalls: calls,
      signal: controller.signal,
      execute: async (name) => {
        if (name === 'grep') {
          controller.abort();
        }
        await delay(5);
        return { content: name };
      },
    });

    assert.equal(outcomes[0]!.result?.content, 'grep');
    assert.equal(outcomes[1]!.result?.content, STOPPED_TOOL_MSG);
    assert.equal(outcomes[2]!.result?.content, STOPPED_TOOL_MSG);
  });

  test('onToolStart and onToolDone fire for each call', async () => {
    const starts: string[] = [];
    const done: string[] = [];

    await executeToolCallBatch({
      toolCalls: [tc('grep', 'a'), tc('read_file', 'b')],
      execute: async (name): Promise<ToolExecutionResult> => ({ content: name }),
      onToolStart: (call) => starts.push(call.id),
      onToolDone: (outcome) => done.push(outcome.toolCall.id),
    });

    assert.deepEqual(starts.sort(), ['a', 'b']);
    assert.deepEqual(done.sort(), ['a', 'b']);
  });
});
