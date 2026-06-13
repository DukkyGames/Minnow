/**
 * Dead-host cooldown expiry tests.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import {
  isHostDead,
  listDeadHosts,
  markHostDead,
  originFromUrl,
  resetHostCooldownForTests,
} from '../../server/generations/host-cooldown.js';

describe('host cooldown', () => {
  afterEach(() => {
    resetHostCooldownForTests();
  });

  test('markHostDead blocks origin until expiry', () => {
    markHostDead('http://localhost:1234', 1);
    assert.equal(isHostDead('http://localhost:1234/v1/chat/completions'), true);
    assert.equal(originFromUrl('http://localhost:1234/foo'), 'http://localhost:1234');
  });

  test('cooldown expires and allows retry', async () => {
    markHostDead('http://127.0.0.1:9999', 0.05);
    assert.equal(isHostDead('http://127.0.0.1:9999'), true);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(isHostDead('http://127.0.0.1:9999'), false);
  });

  test('re-mark extends cooldown window', async () => {
    markHostDead('http://localhost:5000', 0.05);
    await new Promise((resolve) => setTimeout(resolve, 40));
    markHostDead('http://localhost:5000', 1);
    assert.equal(isHostDead('http://localhost:5000'), true);
  });

  test('listDeadHosts returns active rows only', () => {
    markHostDead('http://localhost:1111', 60);
    const rows = listDeadHosts();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].origin, 'http://localhost:1111');
    assert.equal(rows[0].dead, true);
    assert.ok(rows[0].expiresAt);
  });
});
