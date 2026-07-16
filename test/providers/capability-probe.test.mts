import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isConstrainedToolCallsAvailable,
  isHarmonyDeniedModel,
  isStructuredOutcomeResponseFormatAvailable,
  setProviderCapabilitiesForTests,
  resetCapabilitiesCache,
  structuredOutputBadge,
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

  it('isStructuredOutcomeResponseFormatAvailable does not require user toggle', () => {
    const weakTools: ProviderCapabilities = {
      ...CAPS,
      structuredOutputWithTools: false,
      structuredOutput: true,
    };
    assert.equal(isStructuredOutcomeResponseFormatAvailable('llama-3', weakTools), true);
    assert.equal(isStructuredOutcomeResponseFormatAvailable('', weakTools), false);
    assert.equal(isStructuredOutcomeResponseFormatAvailable('gpt-oss', weakTools), false);
  });

  it('isStructuredOutcomeResponseFormatAvailable respects model deny', () => {
    const caps: ProviderCapabilities = {
      ...CAPS,
      models: { 'bad-model': { structuredOutput: false, denyReason: 'unsupported' } },
    };
    assert.equal(isStructuredOutcomeResponseFormatAvailable('bad-model', caps), false);
  });

  it('isStructuredOutcomeResponseFormatAvailable prefers per-model true over provider false', () => {
    const caps: ProviderCapabilities = {
      ...CAPS,
      structuredOutput: false,
      structuredOutputWithTools: false,
      models: { 'gpt-4o-mini': { structuredOutput: true } },
    };
    assert.equal(isStructuredOutcomeResponseFormatAvailable('gpt-4o-mini', caps), true);
    assert.equal(isStructuredOutcomeResponseFormatAvailable('claude-sonnet-4-5', caps), false);
  });

  it('structuredOutputBadge prefers per-model entry over provider flags', () => {
    const caps: ProviderCapabilities = {
      ...CAPS,
      structuredOutput: true,
      models: {
        'claude-sonnet-4-5': { structuredOutput: false, denyReason: 'anthropic bridge' },
        'gpt-4o-mini': { structuredOutput: true },
      },
    };
    assert.equal(structuredOutputBadge(caps, 'claude-sonnet-4-5'), 'no');
    assert.equal(structuredOutputBadge(caps, 'gpt-4o-mini'), 'yes');
    assert.equal(structuredOutputBadge(caps), 'yes');
  });
});
