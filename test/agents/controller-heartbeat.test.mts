/**
 * MIN-140 Phase 1 — heartbeat wrapper (observe-only supervision).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  bindRunSupervision,
  bumpProgress,
  createRunSupervision,
  getProgressAgeMs,
  recordHeartbeat,
  resetHeartbeatBaselines,
  resetWrapperState,
  setHeartbeatConfig,
  simulatePageVisibilityForTests,
  startHeartbeat,
  stopHeartbeat,
} from '../../src/agents/controller/wrapper.ts';

describe('controller heartbeat wrapper', () => {
  const RUN_ID = 'run-heartbeat-test-1';
  let now = 0;
  let originalNow: typeof performance.now;
  const intervalIds: ReturnType<typeof setInterval>[] = [];

  beforeEach(() => {
    resetWrapperState();
    now = 0;
    originalNow = performance.now;
    performance.now = () => now;
    setHeartbeatConfig({
      heartbeatIntervalMs: 100,
      progressStallMs: 90_000,
      heartbeatDeadMs: 30_000,
    });
    intervalIds.length = 0;
    const realSetInterval = globalThis.setInterval;
    globalThis.setInterval = ((handler: TimerHandler, ms?: number) => {
      const id = realSetInterval(handler, ms);
      intervalIds.push(id);
      return id;
    }) as typeof setInterval;
  });

  afterEach(() => {
    for (const id of intervalIds) clearInterval(id);
    performance.now = originalNow;
    resetWrapperState();
  });

  test('heartbeat tick updates lastHeartbeatAt', () => {
    const supervision = createRunSupervision();
    bindRunSupervision(RUN_ID, supervision);

    recordHeartbeat(RUN_ID);
    const first = supervision.lastHeartbeatAt;
    assert.equal(typeof first, 'number');

    now = 50;
    recordHeartbeat(RUN_ID);
    assert.ok((supervision.lastHeartbeatAt ?? 0) > (first ?? 0));

    startHeartbeat(RUN_ID);
    assert.notEqual(supervision.lastHeartbeatAt, null);
    stopHeartbeat(RUN_ID);
  });

  test('bumpProgress increments progressSeq', () => {
    const supervision = createRunSupervision();
    bindRunSupervision(RUN_ID, supervision);

    assert.equal(supervision.progressSeq, 0);
    bumpProgress(RUN_ID);
    assert.equal(supervision.progressSeq, 1);
    assert.equal(typeof supervision.lastProgressAt, 'number');

    now = 40;
    const firstProgressAt = supervision.lastProgressAt;
    bumpProgress(RUN_ID);
    assert.equal(supervision.progressSeq, 2);
    assert.ok((supervision.lastProgressAt ?? 0) >= (firstProgressAt ?? 0));
  });

  test('visibilitychange resets baselines', () => {
    const supervision = createRunSupervision();
    bindRunSupervision(RUN_ID, supervision);

    now = 100;
    recordHeartbeat(RUN_ID);
    bumpProgress(RUN_ID);
    assert.notEqual(supervision.lastHeartbeatAt, null);
    assert.notEqual(supervision.lastProgressAt, null);
    assert.equal(supervision.progressSeq, 1);

    now = 500;
    resetHeartbeatBaselines();
    assert.equal(supervision.lastHeartbeatAt, null);
    assert.equal(supervision.lastProgressAt, null);
    assert.equal(supervision.progressSeq, 1);
  });

  test('progress age is frozen while the page is hidden', () => {
    const supervision = createRunSupervision();
    bindRunSupervision(RUN_ID, supervision);

    now = 100;
    bumpProgress(RUN_ID);
    now = 200;
    assert.equal(getProgressAgeMs(RUN_ID), 100);

    simulatePageVisibilityForTests('hidden');
    now = 500_000;
    assert.equal(getProgressAgeMs(RUN_ID), 100);
  });

  test('hidden interval is excluded after the page becomes visible again', () => {
    const supervision = createRunSupervision();
    bindRunSupervision(RUN_ID, supervision);

    now = 100;
    bumpProgress(RUN_ID);
    now = 200;
    simulatePageVisibilityForTests('hidden');
    now = 10_000;
    simulatePageVisibilityForTests('visible');

    // Baseline reset on visible — fresh bump should not inherit hidden elapsed time.
    now = 10_000;
    bumpProgress(RUN_ID);
    now = 10_100;
    assert.equal(getProgressAgeMs(RUN_ID), 100);
  });

  test('progress age resumes counting after the page becomes visible', () => {
    const supervision = createRunSupervision();
    bindRunSupervision(RUN_ID, supervision);

    now = 50;
    bumpProgress(RUN_ID);
    simulatePageVisibilityForTests('hidden');
    now = 9_000;
    simulatePageVisibilityForTests('visible');

    now = 9_000;
    bumpProgress(RUN_ID);
    now = 9_150;
    assert.equal(getProgressAgeMs(RUN_ID), 150);
  });
});
