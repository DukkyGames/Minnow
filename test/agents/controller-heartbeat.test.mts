/**
 * MIN-140 Phase 1 — heartbeat wrapper (observe-only supervision).
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  bindRunSupervision,
  bumpProgress,
  createRunSupervision,
  recordHeartbeat,
  resetHeartbeatBaselines,
  resetWrapperState,
  setHeartbeatConfig,
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
});
