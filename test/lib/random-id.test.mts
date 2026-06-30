/**
 * randomUUID — secure-context API with LAN-safe fallbacks.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { randomUUID } from '../../src/lib/random-id.ts';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('randomUUID', () => {
  const originalCrypto = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  test('uses crypto.randomUUID when available', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        randomUUID: () => '11111111-1111-4111-8111-111111111111',
        getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
      },
    });
    assert.equal(randomUUID(), '11111111-1111-4111-8111-111111111111');
  });

  test('falls back to getRandomValues when randomUUID is missing (LAN http)', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: originalCrypto.getRandomValues.bind(originalCrypto),
      },
    });
    const id = randomUUID();
    assert.match(id, UUID_RE);
    assert.notEqual(id, randomUUID());
  });

  test('falls back to Math.random when crypto is undefined', () => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: undefined,
    });
    const id = randomUUID();
    assert.match(id, UUID_RE);
  });
});
