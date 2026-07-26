/**
 * MIN-361 / MIN-362 — controller host-gate (auto-boot / live-slice read decisions).
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  setEngineOwnsController,
  shouldAutoStartControllerBoot,
  shouldReadLiveSubAgentSlice,
} from '../../src/agents/controller/host-gate.ts';

describe('controller host-gate', () => {
  const prevEngine = process.env.MINNOW_SERVER_ENGINE;
  const prevTest = process.env.MINNOW_TEST;

  afterEach(() => {
    setEngineOwnsController(false);
    if (prevEngine === undefined) delete process.env.MINNOW_SERVER_ENGINE;
    else process.env.MINNOW_SERVER_ENGINE = prevEngine;
    if (prevTest === undefined) delete process.env.MINNOW_TEST;
    else process.env.MINNOW_TEST = prevTest;
    if (typeof window !== 'undefined') {
      delete (window as { __MINNOW_SERVER_ENGINE__?: boolean }).__MINNOW_SERVER_ENGINE__;
    }
  });

  test('engine host never auto-boots (explicit activate owns startup)', () => {
    setEngineOwnsController(true);
    process.env.MINNOW_SERVER_ENGINE = '1';
    process.env.MINNOW_TEST = '1';
    assert.equal(shouldAutoStartControllerBoot(), false);
    assert.equal(shouldReadLiveSubAgentSlice(), false);
  });

  test('Node flag-on without test marker skips module auto-boot', () => {
    setEngineOwnsController(false);
    process.env.MINNOW_SERVER_ENGINE = '1';
    delete process.env.MINNOW_TEST;
    assert.equal(shouldAutoStartControllerBoot(), false);
  });

  test('Node default-on (unset env) skips module auto-boot', () => {
    setEngineOwnsController(false);
    delete process.env.MINNOW_SERVER_ENGINE;
    delete process.env.MINNOW_TEST;
    assert.equal(shouldAutoStartControllerBoot(), false);
  });

  test('Node opt-out restores module auto-boot', () => {
    setEngineOwnsController(false);
    process.env.MINNOW_SERVER_ENGINE = '0';
    delete process.env.MINNOW_TEST;
    assert.equal(shouldAutoStartControllerBoot(), true);
  });

  test('tests keep auto-boot when flag on (existing controller suites)', () => {
    setEngineOwnsController(false);
    process.env.MINNOW_SERVER_ENGINE = '1';
    process.env.MINNOW_TEST = '1';
    assert.equal(shouldAutoStartControllerBoot(), true);
  });
});
