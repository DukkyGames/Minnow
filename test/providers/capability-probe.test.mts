import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isConstrainedToolCallsAvailable,
  isHarmonyDeniedModel,
  setProviderCapabilitiesForTests,
  resetCapabilitiesCache,
  type ProviderCapabilities,
} from '../../src/providers/capability-probe.ts';

const CAPS: ProviderCapabilities = {
  schemaVersion: 1,
  probedAt: '2026-05-22T12:00:00.000Z',
  providerId: 'test-provider',
  structuredOutput: true,
  structuredOutputWithTools: true,
  probeError: null,
};

describe('capability-probe', () => {
  it('denies Harmony / gpt-oss model ids', () => {
    assert.equal(isHarmonyDeniedModel('openai/gpt-oss-20b'), true);
    assert.equal(isHarmonyDeniedModel('some-harmony-model'), true);
    assert.equal(isHarmonyDeniedModel('llama-3'), false);
  });

  it('requires user toggle and probe flags', () => {
    resetCapabilitiesCache();
    setProviderCapabilitiesForTests('p1', CAPS);
    assert.equal(
      isConstrainedToolCallsAvailable('p1', 'llama-3', false, CAPS),
      false,
    );
    assert.equal(
      isConstrainedToolCallsAvailable('p1', 'llama-3', true, CAPS),
      true,
    );
    assert.equal(
      isConstrainedToolCallsAvailable('p1', 'gpt-oss', true, CAPS),
      false,
    );
  });

  it('blocks when structured output with tools is false', () => {
    const weak: ProviderCapabilities = {
      ...CAPS,
      structuredOutputWithTools: false,
      structuredOutput: false,
    };
    assert.equal(
      isConstrainedToolCallsAvailable('p1', 'llama-3', true, weak),
      false,
    );
  });
});
