/**
 * OOM recovery helpers for orchestrate board boot resume.
 */

import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import {
  OOM_SAFE_MAX_CONCURRENT,
  isOomPauseActive,
  probeOomPauseFromElectron,
  setOomPauseActiveForBoot,
} from '../../../src/chat/orchestrate/oom-recovery.ts';
import { resolveEffectiveMaxConcurrent } from '../../../src/state/orchestrate-board-actions.ts';
import type { OrchestrateBoardState } from '../../../src/types.ts';

describe('orchestrate OOM recovery', () => {
  beforeEach(() => {
    setOomPauseActiveForBoot(false);
    (globalThis as { window?: Window }).window = {
      minnow: {
        diagnostics: {
          reportError: () => {},
          getLastCrash: async () => null,
          getOomPause: async () => ({
            reason: 'oom',
            kind: 'render-process-gone',
            ts: new Date().toISOString(),
          }),
          clearOomPause: async () => {},
        },
      },
    } as Window;
  });

  afterEach(() => {
    delete (globalThis as { window?: Window }).window;
    setOomPauseActiveForBoot(false);
  });

  test('probeOomPauseFromElectron returns true when marker reason is oom', async () => {
    assert.equal(await probeOomPauseFromElectron(), true);
  });

  test('resolveEffectiveMaxConcurrent caps concurrency during OOM recovery', () => {
    const board = {
      executionMode: 'auto',
      maxConcurrentTasks: 5,
    } as OrchestrateBoardState;

    setOomPauseActiveForBoot(true);
    assert.equal(isOomPauseActive(), true);
    assert.equal(resolveEffectiveMaxConcurrent(board), OOM_SAFE_MAX_CONCURRENT);

    setOomPauseActiveForBoot(false);
    assert.equal(resolveEffectiveMaxConcurrent(board), 5);
  });
});
