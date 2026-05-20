import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { classifyExpertWithLlm } from '../../src/chat/experts/llm-classifier.ts';
import { shouldRunLlmClassifier } from '../../src/chat/experts/resolve.ts';
import { DEFAULT_EXPERTS_CONFIG } from '../../src/chat/experts/types.ts';

const registry = [
  {
    meta: {
      id: 'data-analyst',
      label: 'Data analyst',
      kind: 'expert',
      version: '1',
      classifierHint: 'SQL and metrics',
    },
    fullBody: 'body',
    source: 'builtin',
  },
];

describe('llm classifier', () => {
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('shouldRunLlmClassifier false when rules confidence high', () => {
    const rules = { expertId: 'general', source: 'rules', confidence: 0.9 };
    assert.equal(
      shouldRunLlmClassifier(rules, { ...DEFAULT_EXPERTS_CONFIG, classifier: 'rules+llm' }),
      false,
    );
  });

  test('parses valid JSON response', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return {
          choices: [{ message: { content: '{"expertId":"data-analyst"}' } }],
        };
      },
    });

    const result = await classifyExpertWithLlm({
      userText: 'aggregate revenue by month',
      registry,
      baseUrl: 'http://localhost:1234',
      modelId: 'test-model',
    });
    assert.equal(result?.expertId, 'data-analyst');
    assert.equal(result?.source, 'llm');
  });

  test('invalid JSON returns null', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      async json() {
        return { choices: [{ message: { content: 'not json' } }] };
      },
    });

    const result = await classifyExpertWithLlm({
      userText: 'test',
      registry,
      baseUrl: 'http://localhost:1234',
      modelId: 'test-model',
    });
    assert.equal(result, null);
  });
});
