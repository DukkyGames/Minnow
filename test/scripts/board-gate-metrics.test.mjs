import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, test } from 'node:test';
import {
  collectBoardGateMetrics,
  main,
} from '../../scripts/collect-board-gate-metrics.mjs';

const temporaryDirectories = [];

async function makeRun(name, rows) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-board-metrics-'));
  temporaryDirectories.push(root);
  const run = path.join(root, name);
  await fs.mkdir(run);
  await fs.writeFile(
    path.join(run, 'iterations.jsonl'),
    `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`,
  );
  return { root, run };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('board gate metrics', () => {
  test('aggregates classifications, rates, retry distribution, and recovery median', async () => {
    const { root } = await makeRun('run_a', [
      {
        classification: 'pass',
        metrics: { retryCount: 0, recoveryRounds: 0, unexpectedQuarantineCount: 0 },
      },
      {
        classification: 'expected_blocked',
        metrics: { retryCount: 2, recoveryRounds: 4, unexpectedQuarantines: ['W1-A'] },
      },
      {
        classification: 'timeout',
        retryCount: 2,
        recoveryRounds: 2,
      },
    ]);
    const metrics = await collectBoardGateMetrics({ inputs: [root] });
    assert.equal(metrics.runs, 1);
    assert.equal(metrics.iterations, 3);
    assert.equal(metrics.convergenceRate, 2 / 3);
    assert.equal(metrics.timeoutRate, 1 / 3);
    assert.equal(metrics.unexpectedQuarantineRate, 1 / 3);
    assert.equal(metrics.unexpectedQuarantineCount, 1);
    assert.equal(metrics.medianRecoveryRounds, 2);
    assert.deepEqual(metrics.retryDistribution, { 0: 1, 2: 2 });
    assert.deepEqual(metrics.classifications, {
      expected_blocked: 1,
      pass: 1,
      timeout: 1,
    });
  });

  test('enforces per-file and aggregate artifact size caps', async () => {
    const { root } = await makeRun('run_large', [
      { classification: 'pass', detail: 'x'.repeat(200) },
    ]);
    await assert.rejects(
      collectBoardGateMetrics({ inputs: [root], maxFileBytes: 20 }),
      /exceeds 20 byte cap/,
    );
    await assert.rejects(
      collectBoardGateMetrics({ inputs: [root], maxTotalBytes: 20 }),
      /aggregate byte cap/,
    );

    const second = await makeRun('run_second', [{ classification: 'pass' }]);
    await assert.rejects(
      collectBoardGateMetrics({ inputs: [path.join(root, 'run_large'), second.run], maxRuns: 1 }),
      /exceeds 1 run cap/,
    );
  });

  test('fail-on-unexpected classifies artifact failures and writes output', async () => {
    const { root } = await makeRun('run_failure', [
      { classification: 'harness_error', metrics: { retryCount: 1 } },
    ]);
    const output = path.join(root, 'summary', 'metrics.json');
    const result = await main([
      '--input',
      root,
      '--output',
      output,
      '--fail-on-unexpected',
    ]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.classification, 'product_failure');
    assert.deepEqual(JSON.parse(await fs.readFile(output, 'utf8')), result);
  });
});
