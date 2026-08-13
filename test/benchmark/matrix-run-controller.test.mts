import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  abortCapabilityMatrixRun,
  getCapabilityMatrixInFlightAutos,
  resetCapabilityMatrixRunControllerForTests,
  seedCapabilityMatrixSessionProbesForTests,
} from '../../src/benchmark/capabilities/matrix-run-controller.ts';
import type { TestResult } from '../../src/benchmark/types.ts';

const TARGET_KEY = 'openai::gpt-test';
const CAP_ID = 'core-streaming';

function probeResult(verdict: 'pass' | 'fail'): TestResult {
  return {
    testId: `cap-matrix/${CAP_ID}`,
    suite: 'capability-matrix',
    label: CAP_ID,
    passed: verdict === 'pass',
    skipped: false,
    durationMs: 1,
    score: verdict === 'pass' ? 1 : 0,
    verdict,
  };
}

describe('matrix-run-controller', () => {
  afterEach(() => {
    resetCapabilityMatrixRunControllerForTests();
  });

  test('abort keeps completed probes visible until the next run starts', () => {
    seedCapabilityMatrixSessionProbesForTests([
      { targetKey: TARGET_KEY, result: probeResult('pass') },
    ]);
    assert.equal(getCapabilityMatrixInFlightAutos().length, 1);

    abortCapabilityMatrixRun();

    const autos = getCapabilityMatrixInFlightAutos();
    assert.equal(autos.length, 1);
    assert.equal(autos[0]?.capabilityId, CAP_ID);
    assert.equal(autos[0]?.verdict, 'pass');
  });
});
