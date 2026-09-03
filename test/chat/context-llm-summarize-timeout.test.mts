/**
 * LLM summarize timeout must abort the in-flight generation.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { ProviderPublic } from '../../src/providers/types';
import {
  setSummarizeCompleteForTests,
  setSummarizeProviderForTests,
  setSummarizeTimeoutMsForTests,
  summarizeDroppedTurns,
} from '../../src/chat/context/llm-summarize.ts';

const STUB_PROVIDER = {
  id: 'openai',
  label: 'stub',
  baseUrl: 'http://127.0.0.1:9',
  apiKind: 'openai-v1',
  enabled: true,
} as ProviderPublic;

describe('summarizeDroppedTurns timeout abort', () => {
  afterEach(() => {
    setSummarizeTimeoutMsForTests(null);
    setSummarizeCompleteForTests(null);
    setSummarizeProviderForTests(null);
  });

  test('aborts the hanging generation and falls back to extractive', async () => {
    const abortState = { seen: false };
    setSummarizeTimeoutMsForTests(25);
    setSummarizeProviderForTests(async () => STUB_PROVIDER);
    setSummarizeCompleteForTests(async (_provider, _body, signal) => {
      await new Promise((_resolve, reject) => {
        if (signal.aborted) {
          abortState.seen = true;
          reject(new DOMException('Aborted', 'AbortError'));
          return;
        }
        signal.addEventListener(
          'abort',
          () => {
            abortState.seen = true;
            reject(new DOMException('Aborted', 'AbortError'));
          },
          { once: true },
        );
      });
      return { choices: [] } as never;
    });

    const result = await summarizeDroppedTurns({
      droppedText: 'alpha '.repeat(200),
      providerId: 'openai',
      modelId: 'gpt-test',
      summaryReserveTokens: 64,
    });
    assert.equal(result.usedLlm, false);
    assert.ok(result.summaryBody.length > 0);
    assert.equal(abortState.seen, true);
  });
});
