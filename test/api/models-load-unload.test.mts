/**
 * Client helpers for model load/unload state and URL resolution.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isModelLoaded } from '../../src/api/model-loaded-state.ts';
import { providerSupportsModelLoadUnload } from '../../src/providers/capabilities.ts';
import { resolveProviderEndpoints } from '../../src/providers/resolve.ts';
import type { ProviderPublic } from '../../src/providers/types.ts';

describe('isModelLoaded', () => {
  it('returns true only for loaded state', () => {
    assert.equal(isModelLoaded('loaded'), true);
    assert.equal(isModelLoaded('not-loaded'), false);
    assert.equal(isModelLoaded(undefined), false);
  });
});

describe('providerSupportsModelLoadUnload', () => {
  const lmStudio: ProviderPublic = {
    id: 'lm-studio-local',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234',
    apiKind: 'lm-studio-v0',
    enabled: true,
    connectionMode: 'proxy',
    hasApiKey: false,
    hasBearer: false,
  };

  const openAi: ProviderPublic = {
    ...lmStudio,
    id: 'remote',
    apiKind: 'openai-v1',
    supportsModelLoadUnload: false,
  };

  it('defaults lm-studio-v0 to supported', () => {
    assert.equal(providerSupportsModelLoadUnload(lmStudio), true);
  });

  it('respects explicit false on profile', () => {
    assert.equal(providerSupportsModelLoadUnload(openAi), false);
  });
});

describe('resolveProviderEndpoints load/unload URLs', () => {
  it('proxy mode exposes Minnow load/unload routes for lm-studio-v0', () => {
    const provider: ProviderPublic = {
      id: 'lm-studio-local',
      label: 'LM Studio',
      baseUrl: 'http://localhost:1234',
      apiKind: 'lm-studio-v0',
      enabled: true,
      connectionMode: 'proxy',
      supportsModelLoadUnload: true,
      hasApiKey: false,
      hasBearer: false,
    };
    const endpoints = resolveProviderEndpoints(provider);
    assert.equal(endpoints.modelsLoadUrl, '/api/providers/lm-studio-local/models/load');
    assert.equal(endpoints.modelsUnloadUrl, '/api/providers/lm-studio-local/models/unload');
  });

  it('omits load/unload URLs for openai-v1', () => {
    const provider: ProviderPublic = {
      id: 'remote',
      label: 'Remote',
      baseUrl: 'https://api.example.com',
      apiKind: 'openai-v1',
      enabled: true,
      connectionMode: 'proxy',
      hasApiKey: true,
      hasBearer: false,
    };
    const endpoints = resolveProviderEndpoints(provider);
    assert.equal(endpoints.modelsLoadUrl, undefined);
    assert.equal(endpoints.modelsUnloadUrl, undefined);
  });
});

