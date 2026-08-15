/**
 * Capability matrix host band classification tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classifyProviderHost } from '../../src/benchmark/capabilities/host-group.ts';

describe('classifyProviderHost', () => {
  test('maps Minnow hosting providers', () => {
    assert.equal(classifyProviderHost('minnow-library'), 'minnow-hosting');
    assert.equal(classifyProviderHost('llama-cpp-local'), 'minnow-hosting');
    assert.equal(classifyProviderHost('mlx-lm-local'), 'minnow-hosting');
  });

  test('maps LM Studio providers', () => {
    assert.equal(classifyProviderHost('lm-studio'), 'lm-studio');
    assert.equal(classifyProviderHost('lm-studio-local'), 'lm-studio');
  });

  test('defaults to cloud', () => {
    assert.equal(classifyProviderHost('openai'), 'cloud');
    assert.equal(classifyProviderHost('anthropic'), 'cloud');
  });
});
