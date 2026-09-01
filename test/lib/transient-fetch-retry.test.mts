/**
 * Transient fetch retry helper.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  isTransientFetchError,
  isTransientHttpError,
  retryOnceOnTransientFetch,
} from '../../src/lib/transient-fetch-retry.ts';

describe('transient-fetch-retry', () => {
  test('isTransientFetchError matches browser TypeError copy', () => {
    assert.equal(isTransientFetchError(new TypeError('Failed to fetch')), true);
    assert.equal(isTransientFetchError(new TypeError('NetworkError')), true);
    assert.equal(isTransientFetchError(new Error('Failed to fetch')), false);
    assert.equal(isTransientFetchError(new TypeError('HTTP 500')), false);
  });

  test('isTransientHttpError matches retryable statuses from HTTP error copy', () => {
    assert.equal(isTransientHttpError(new Error('HTTP 429: rate limited')), true);
    assert.equal(isTransientHttpError(new Error('HTTP 502: bad gateway')), true);
    assert.equal(isTransientHttpError(new Error('HTTP 401: unauthorized')), false);
    assert.equal(isTransientHttpError(new TypeError('Failed to fetch')), false);
  });

  test('retryOnceOnTransientFetch succeeds on second attempt', async () => {
    let calls = 0;
    const result = await retryOnceOnTransientFetch(async () => {
      calls += 1;
      if (calls === 1) {
        throw new TypeError('Failed to fetch');
      }
      return 'ok';
    }, 0);
    assert.equal(result, 'ok');
    assert.equal(calls, 2);
  });

  test('retryOnceOnTransientFetch does not retry non-transient errors', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retryOnceOnTransientFetch(async () => {
          calls += 1;
          throw new Error('HTTP 401: unauthorized');
        }, 0),
      /HTTP 401/,
    );
    assert.equal(calls, 1);
  });

  test('retries HTTP 429 with backoff and succeeds before the attempt ceiling', async () => {
    let calls = 0;
    const result = await retryOnceOnTransientFetch(async () => {
      calls += 1;
      if (calls < 3) {
        throw new Error('HTTP 429: rate limited');
      }
      return 'ok';
    }, 0);
    assert.equal(result, 'ok');
    assert.equal(calls, 3);
  });

  test('gives up on persistent HTTP 502 after the attempt ceiling', async () => {
    let calls = 0;
    await assert.rejects(
      () =>
        retryOnceOnTransientFetch(async () => {
          calls += 1;
          throw new Error('HTTP 502: bad gateway');
        }, 0),
      /HTTP 502/,
    );
    assert.equal(calls, 3);
  });
});
