/**
 * Tests for HumanEval program assembly and harness wiring.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { RunCodingPythonResult } from '../../../src/benchmark/coding-run-python.ts';
import {
  assembleHumanEvalProgram,
  derivePromptPrefix,
  scoreHumanEval,
} from '../../../src/benchmark/standard/harnesses/humaneval.ts';
import type { StandardBenchmarkItem } from '../../../src/benchmark/standard/types.ts';

const HUMANEVAL_0: StandardBenchmarkItem = {
  id: 'HumanEval/0',
  prompt:
    'from typing import List\n\n\ndef has_close_elements(numbers: List[float], threshold: float) -> bool:\n' +
    '    """ doc """\n\nComplete the Python function. Reply with a fenced ```python code block only.',
  groundTruth:
    'for idx, elem in enumerate(numbers):\n        for idx2, elem2 in enumerate(numbers):\n' +
    '            if idx != idx2:\n                distance = abs(elem - elem2)\n' +
    '                if distance < threshold:\n                    return True\n\n    return False',
  category: 'coding',
  metadata: {
    entryPoint: 'has_close_elements',
    tests:
      'def check(candidate):\n    assert candidate([1.0, 2.0, 3.0], 0.5) == False\n' +
      '    assert candidate([1.0, 2.8, 3.0, 4.0, 5.0, 2.0], 0.3) == True',
  },
};

describe('humaneval harness', () => {
  test('derivePromptPrefix strips completion instruction', () => {
    const prefix = derivePromptPrefix(HUMANEVAL_0.prompt);
    assert.match(prefix, /def has_close_elements/);
    assert.doesNotMatch(prefix, /Complete the Python function/);
  });

  test('assembleHumanEvalProgram normalizes body-only indentation', () => {
    const body = HUMANEVAL_0.groundTruth;
    const assembled = assembleHumanEvalProgram(HUMANEVAL_0, body);
    assert.ok('program' in assembled);
    assert.match(assembled.program, /\n    for idx, elem in enumerate/);
    assert.doesNotMatch(assembled.program, /\nfor idx, elem in enumerate/);
    assert.match(assembled.program, /def check\(candidate\):/);
    assert.match(assembled.program, /check\(has_close_elements\)\s*$/);
  });

  test('assembleHumanEvalProgram accepts full def in completion', () => {
    const fullDef =
      'def has_close_elements(numbers, threshold):\n    return False\n';
    const assembled = assembleHumanEvalProgram(HUMANEVAL_0, fullDef);
    assert.ok('program' in assembled);
    assert.match(assembled.program, /^def has_close_elements/);
    assert.doesNotMatch(assembled.program, /from typing import List/);
  });

  test('scoreHumanEval passes when mock run_python exits 0', async () => {
    const mockRun = async (): Promise<RunCodingPythonResult> => ({
      ok: true,
      stdout: '',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      raw: 'python (exit 0)',
      code: 'mock',
    });

    const result = await scoreHumanEval({
      item: HUMANEVAL_0,
      response: '```python\n' + HUMANEVAL_0.groundTruth + '\n```',
      signal: new AbortController().signal,
      runPython: mockRun,
    });
    assert.equal(result.passed, true);
  });

  test('scoreHumanEval surfaces stderr on failure', async () => {
    const mockRun = async (): Promise<RunCodingPythonResult> => ({
      ok: false,
      stdout: '',
      stderr: 'AssertionError: boom',
      exitCode: 1,
      timedOut: false,
      raw: 'python (exit 1)',
      code: 'mock',
    });

    const result = await scoreHumanEval({
      item: HUMANEVAL_0,
      response: '```python\ndef has_close_elements(a,b): return True\n```',
      signal: new AbortController().signal,
      runPython: mockRun,
    });
    assert.equal(result.passed, false);
    assert.match(result.details ?? '', /AssertionError/);
  });
});
