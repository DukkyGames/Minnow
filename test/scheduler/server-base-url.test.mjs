/**
 * Scheduler dev-server base URL helper tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getSchedulerServerBaseUrl,
  setSchedulerServerBaseUrl,
} from '../../server/scheduler/server-base-url.js';

describe('scheduler server base URL', () => {
  test('defaults to localhost (Vite bind on Windows)', () => {
    const url = getSchedulerServerBaseUrl();
    assert.match(url, /^http:\/\/localhost:\d+$/);
  });

  test('setSchedulerServerBaseUrl strips trailing slash', () => {
    setSchedulerServerBaseUrl('http://localhost:5173/');
    assert.equal(getSchedulerServerBaseUrl(), 'http://localhost:5173');
    setSchedulerServerBaseUrl('http://localhost:5173');
  });
});
