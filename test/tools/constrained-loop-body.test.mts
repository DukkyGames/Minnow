import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyConstrainedToolCallsToBody,
  isResponseFormatRejectionError,
  stripResponseFormatFromBody,
} from '../../src/providers/constrained-tool-calls.ts';
import type { ProviderCapabilities } from '../../src/providers/capability-probe.ts';
import type { OpenAIFunctionDefinition } from '../../src/tools/definitions.ts';

const CAPS: ProviderCapabilities = {
  schemaVersion: 1,
  probedAt: '2026-05-22T12:00:00.000Z',
  providerId: 'p1',
  structuredOutput: true,
  structuredOutputWithTools: true,
  probeError: null,
};

const TOOL: OpenAIFunctionDefinition = {
  type: 'function',
  function: {
    name: 'read_file',
    description: 'Read',
    parameters: { type: 'object', properties: { path: { type: 'string' } } },
  },
};

describe('constrained completion body', () => {
  it('does not attach response_format when user disabled', () => {
    const base = { messages: [], temperature: 0.4, max_tokens: 1024 };
    const result = applyConstrainedToolCallsToBody(base, {
      providerId: 'p1',
      modelId: 'm1',
      userEnabled: false,
      capabilities: CAPS,
      enabledTools: [TOOL],
    });
    assert.equal(result.usedConstrained, false);
    assert.equal(result.body.response_format, undefined);
  });

  it('attaches response_format when enabled and capable', () => {
    const base = { messages: [], temperature: 0.4, max_tokens: 1024 };
    const result = applyConstrainedToolCallsToBody(base, {
      providerId: 'p1',
      modelId: 'm1',
      userEnabled: true,
      capabilities: CAPS,
      enabledTools: [TOOL],
    });
    assert.equal(result.usedConstrained, true);
    assert.equal(result.body.response_format?.type, 'json_schema');
  });

  it('detects response_format rejection errors', () => {
    assert.equal(
      isResponseFormatRejectionError(new Error('HTTP 400: unsupported response_format')),
      true,
    );
    assert.equal(isResponseFormatRejectionError(new Error('HTTP 500: timeout')), false);
  });

  it('strips response_format for retry body', () => {
    const body = {
      messages: [],
      temperature: 0.4,
      max_tokens: 1024,
      response_format: { type: 'json_schema' as const, json_schema: { name: 'x', schema: {} } },
    };
    const stripped = stripResponseFormatFromBody(body);
    assert.equal('response_format' in stripped, false);
  });
});
