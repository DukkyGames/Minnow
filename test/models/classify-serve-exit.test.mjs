/**
 * Phase 3: classifyServeExit wraps diagnoseLlamaFailure; tests may still inject codes.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  classifyServeExit,
  resetClassifyServeExitOverrideForTests,
  setClassifyServeExitOverrideForTests,
} from '../../server/models/classify-serve-exit.js';

describe('classifyServeExit', () => {
  afterEach(() => {
    resetClassifyServeExitOverrideForTests();
  });

  test('maps cudaMalloc log to oom_vram so restart policy sees the code', () => {
    assert.equal(
      classifyServeExit({ exitCode: 1, logTail: 'cudaMalloc failed: out of memory' }).code,
      'oom_vram',
    );
  });

  test('tests may inject oom_vram / port_conflict / transient', () => {
    setClassifyServeExitOverrideForTests(() => ({ code: 'oom_vram' }));
    assert.equal(classifyServeExit({ exitCode: 1 }).code, 'oom_vram');
    setClassifyServeExitOverrideForTests(() => ({ code: 'port_conflict' }));
    assert.equal(classifyServeExit({}).code, 'port_conflict');
    setClassifyServeExitOverrideForTests(() => ({ code: 'transient' }));
    assert.equal(classifyServeExit({}).code, 'transient');
  });
});
