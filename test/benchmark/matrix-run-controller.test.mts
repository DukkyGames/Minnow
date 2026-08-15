import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  abortCapabilityMatrixRun,
  getCapabilityMatrixCurrentProbe,
  getCapabilityMatrixInFlightAutos,
  getCapabilityMatrixRunState,
  resetCapabilityMatrixRunControllerForTests,
  seedCapabilityMatrixSessionProbesForTests,
  simulateCapabilityMatrixProgressForTests,
} from '../../src/benchmark/capabilities/matrix-run-controller.ts';
import type { TestResult } from '../../src/benchmark/types.ts';

const TARGET_KEY = 'openai::gpt-test';
const CAP_ID = 'core-streaming';
const TEST_ID = `cap-matrix/${CAP_ID}`;

function probeResult(verdict: 'pass' | 'fail'): TestResult {
  return {
    testId: TEST_ID,
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

  test('test-start sets currentProbe and test-done clears it', () => {
    simulateCapabilityMatrixProgressForTests({
      type: 'integration-progress',
      targetKey: TARGET_KEY,
      event: {
        type: 'test-start',
        suiteId: 'capability-matrix',
        testId: TEST_ID,
        label: 'Core streaming',
      },
    });

    const probe = getCapabilityMatrixCurrentProbe();
    assert.ok(probe);
    assert.equal(probe?.targetKey, TARGET_KEY);
    assert.equal(probe?.capabilityId, CAP_ID);
    assert.equal(probe?.label, 'Core streaming');
    assert.match(getCapabilityMatrixRunState().phaseLabel, /Running: Core streaming/);

    simulateCapabilityMatrixProgressForTests({
      type: 'integration-progress',
      targetKey: TARGET_KEY,
      event: {
        type: 'test-done',
        result: probeResult('pass'),
      },
    });

    assert.equal(getCapabilityMatrixCurrentProbe(), null);
  });

  test('abort clears currentProbe', () => {
    simulateCapabilityMatrixProgressForTests({
      type: 'integration-progress',
      targetKey: TARGET_KEY,
      event: {
        type: 'test-start',
        suiteId: 'capability-matrix',
        testId: TEST_ID,
        label: CAP_ID,
      },
    });
    assert.ok(getCapabilityMatrixCurrentProbe());

    abortCapabilityMatrixRun();

    assert.equal(getCapabilityMatrixCurrentProbe(), null);
    assert.equal(getCapabilityMatrixRunState().phaseLabel, 'Cancelled');
  });
});
