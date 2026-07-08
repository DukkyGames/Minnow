/**
 * Optional integration test: real run_python when tool server is up.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { parseRunJavascriptToolOutput } from '../../../src/benchmark/coding-code.ts';
import type { RunCodingPythonResult } from '../../../src/benchmark/coding-run-python.ts';
import { scoreHumanEval } from '../../../src/benchmark/standard/harnesses/humaneval.ts';
import type { StandardBenchmarkItem } from '../../../src/benchmark/standard/types.ts';

const BASE = process.env.MINNOW_BENCH_URL ?? 'http://localhost:9473';

const pack = JSON.parse(
  readFileSync('src/benchmark/standard/packs/humaneval-mini.json', 'utf8'),
) as { items: StandardBenchmarkItem[] };
const HUMANEVAL_0 = pack.items[0]!;

async function toolServerUp(): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/api/tools/ping`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Node-safe run_python via POST /api/tools (avoids browser executeTool client). */
async function runPythonViaApi(code: string, signal: AbortSignal): Promise<RunCodingPythonResult> {
  const res = await fetch(`${BASE}/api/tools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'run_python', args: { code } }),
    signal,
  });
  const data = (await res.json()) as { result?: string; error?: string };
  const content = data.result ?? data.error ?? '';
  const parsed = parseRunJavascriptToolOutput(content);
  return { ...parsed, code };
}

describe('humaneval integration', () => {
  test('scoreHumanEval runs check() via run_python when server is up', async (t) => {
    if (!(await toolServerUp())) {
      t.skip('tool server not reachable (npm start)');
      return;
    }

    const result = await scoreHumanEval({
      item: HUMANEVAL_0,
      response: '```python\n' + HUMANEVAL_0.groundTruth + '\n```',
      signal: AbortSignal.timeout(35_000),
      runPython: runPythonViaApi,
    });
    assert.equal(result.passed, true, result.details);
  });
});
