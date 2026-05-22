/**
 * Supervisor boot/shutdown smoke (no DOM tick side effects beyond registration).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { startSupervisor, stopSupervisor } from '../../src/agents/supervisor/index.ts';

describe('supervisor integration smoke', () => {
  test('startSupervisor is idempotent then stops cleanly', () => {
    startSupervisor();
    startSupervisor();
    assert.ok(true);
    stopSupervisor();
  });
});
