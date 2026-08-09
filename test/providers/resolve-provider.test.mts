/**
 * resolveProvider routing — an id that matches no enabled provider must never
 * quietly become a different backend on a send path.
 *
 * The regression this guards: My Models rows carry the synthetic `minnow-library`
 * id, and the silent `enabled[0]` fallback sent prompt-expander / inline-completion
 * requests to whichever provider happened to sort first (LM Studio → HTTP 400
 * "No model loaded" while the model was in fact serving under mlx-lm-local).
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

import { setStorageModeForTests } from '../../src/config/storage-mode.ts';
import {
  invalidateProviderCache,
  resolveProvider,
  UnknownProviderError,
} from '../../src/providers/store.ts';

const PROVIDERS = [
  { id: 'llama-cpp-local', label: 'llama.cpp (local)', baseUrl: 'http://127.0.0.1:8085', apiKind: 'openai-v1', enabled: false, hasApiKey: false, hasBearer: false },
  { id: 'lm-studio-local', label: 'LM Studio (local)', baseUrl: 'http://localhost:1234', apiKind: 'lm-studio-v0', enabled: true, hasApiKey: false, hasBearer: false },
  { id: 'mlx-lm-local', label: 'MLX (local)', baseUrl: 'http://127.0.0.1:8086', apiKind: 'openai-v1', enabled: true, hasApiKey: false, hasBearer: false },
];

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
let warnings: string[] = [];

beforeEach(() => {
  setStorageModeForTests('server');
  invalidateProviderCache();
  warnings = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.join(' '));
  };
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({ providers: PROVIDERS, activeProviderId: 'lm-studio-local' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  invalidateProviderCache();
});

describe('resolveProvider', () => {
  test('returns the requested enabled provider', async () => {
    const provider = await resolveProvider('mlx-lm-local');
    assert.equal(provider.id, 'mlx-lm-local');
    assert.deepEqual(warnings, []);
  });

  test('falls back to the first enabled provider with no id', async () => {
    const provider = await resolveProvider();
    assert.equal(provider.id, 'lm-studio-local');
    assert.deepEqual(warnings, []);
  });

  test('warns instead of silently substituting for an unknown id', async () => {
    const provider = await resolveProvider('minnow-library');
    assert.equal(provider.id, 'lm-studio-local');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /minnow-library/);
  });

  test('warns for a disabled provider id', async () => {
    const provider = await resolveProvider('llama-cpp-local');
    assert.equal(provider.id, 'lm-studio-local');
    assert.equal(warnings.length, 1);
  });

  test('strict mode rejects an unknown id', async () => {
    await assert.rejects(
      () => resolveProvider('minnow-library', { strict: true }),
      (err: unknown) => {
        assert.ok(err instanceof UnknownProviderError);
        assert.equal(err.providerId, 'minnow-library');
        return true;
      },
    );
  });

  test('strict mode rejects a disabled provider id', async () => {
    await assert.rejects(
      () => resolveProvider('llama-cpp-local', { strict: true }),
      UnknownProviderError,
    );
  });

  test('strict mode still resolves a valid id', async () => {
    const provider = await resolveProvider('lm-studio-local', { strict: true });
    assert.equal(provider.id, 'lm-studio-local');
  });
});
