import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { TestResult } from '../../src/benchmark/types.ts';
import { formatBenchmarkTranscriptForCopy } from '../../src/ui/format-benchmark-transcript.ts';

const RUN_META = {
  preset: 'custom' as const,
  modelId: 'opencode-go / deepseek-v4-flash',
  startedAt: '2026-08-12T21:00:00.000Z',
};

describe('formatBenchmarkTranscriptForCopy', () => {
  test('includes metadata and empty transcript state', () => {
    const test: TestResult = {
      testId: 'cap-matrix/tool-calling-basic',
      suite: 'capability-matrix',
      label: 'Tool calling (basic)',
      passed: false,
      skipped: true,
      durationMs: 0,
      score: 0,
      verdict: 'untested',
      transcriptMeta: {
        error: 'No probe has run for this cell yet. You can still set a manual verdict.',
      },
    };

    const text = formatBenchmarkTranscriptForCopy(test, RUN_META, {
      suiteLabel: 'Tool calling (basic)',
    });

    assert.match(text, /=== Benchmark probe transcript ===/);
    assert.match(text, /Test: Tool calling \(basic\)/);
    assert.match(text, /Test ID: cap-matrix\/tool-calling-basic/);
    assert.match(text, /Verdict: Untested/);
    assert.match(text, /Model: opencode-go \/ deepseek-v4-flash/);
    assert.match(text, /Probe error:/);
    assert.match(text, /No probe has run/);
    assert.match(text, /--- Messages \(0\) ---/);
    assert.match(text, /\(none\)/);
  });

  test('formats messages, tool calls, and judge output', () => {
    const test: TestResult = {
      testId: 'tools/read-file',
      suite: 'tools',
      label: 'Read file tool',
      passed: true,
      skipped: false,
      durationMs: 842,
      ttftMs: 120,
      tokPerSec: 88,
      score: 1,
      details: 'Tool name matched.',
      transcript: [
        { role: 'user', content: 'Read package.json.' },
        {
          role: 'assistant',
          content: '',
          tool_calls: [
            {
              id: 'call-1',
              type: 'function',
              function: { name: 'read_file', arguments: '{"path":"package.json"}' },
            },
          ],
        },
        { role: 'tool', tool_call_id: 'call-1', content: '{"name":"minnow"}' },
        { role: 'assistant', content: 'Found minnow in package.json.' },
      ],
      transcriptMeta: {
        finishReason: 'stop',
        judgeRaw: '{"pass":true}',
      },
    };

    const text = formatBenchmarkTranscriptForCopy(test, RUN_META);

    assert.match(text, /Duration: 842 ms/);
    assert.match(text, /TTFT: 120 ms/);
    assert.match(text, /Throughput: 88 tok\/s/);
    assert.match(text, /Finish reason: stop/);
    assert.match(text, /\[1\] user/);
    assert.match(text, /Read package\.json\./);
    assert.match(text, /\[assistant — tool_calls\]/);
    assert.match(text, /read_file \(id=call-1\)/);
    assert.match(text, /"path": "package\.json"/);
    assert.match(text, /\[3\] tool \(tool_call_id=call-1\)/);
    assert.match(text, /Found minnow in package\.json\./);
    assert.match(text, /--- Judge output ---/);
    assert.match(text, /\{"pass":true\}/);
  });
});
