import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  createBenchmarkExecuteToolFn,
  isBenchmarkStubbedTool,
} from '../../src/benchmark/execute-tool-sandbox.ts';

describe('benchmark execute-tool sandbox', () => {
  test('ask_question is stubbed and does not open UI', async () => {
    assert.equal(isBenchmarkStubbedTool('ask_question'), true);

    const execute = createBenchmarkExecuteToolFn();
    const out = await execute('ask_question', {
      questions: [
        {
          id: 'bench-scope',
          prompt: 'Pick a scope',
          options: [
            { id: 'bench-a', label: 'A' },
            { id: 'bench-b', label: 'B' },
          ],
        },
      ],
    });

    const parsed = JSON.parse(out.content) as { status: string };
    assert.equal(parsed.status, 'cancelled');
  });

  test('spawn_sub_agent returns benchmark stub JSON', async () => {
    const execute = createBenchmarkExecuteToolFn();
    const out = await execute('spawn_sub_agent', { type: 'explore', prompt: 'x' });
    const parsed = JSON.parse(out.content) as { benchmark?: boolean; stubbed?: string };
    assert.equal(parsed.benchmark, true);
    assert.equal(parsed.stubbed, 'spawn_sub_agent');
  });
});
