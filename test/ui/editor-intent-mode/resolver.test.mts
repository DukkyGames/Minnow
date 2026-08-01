import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ChatCompletionChunk } from '../../../src/types.ts';
import {
  EDITOR_AI_EMPTY_COMPLETION_MESSAGE,
  EDITOR_AI_NO_MODEL_MESSAGE,
} from '../../../src/ui/editor-ai-completion-client.ts';
import {
  DEFAULT_EDITOR_AI_COMPLETION,
  resetEditorAiCompletionConfigCache,
  setEditorAiCompletionConfigForTests,
} from '../../../src/config/editor-ai-completion.ts';
import { DEFAULT_EDITOR_INTENT_MODE } from '../../../src/config/editor-intent-mode.ts';
import { resolveIntentLine, finalizeIntentResolveDisplay, alignIntentResolvedCode } from '../../../src/ui/editor-intent-mode/resolver.ts';
import { BenchmarkStreamReasoningAccumulator } from '../../../src/benchmark/stream-text.ts';
import { StreamingContentAccumulator } from '../../../src/api/message-content.ts';

import { setSessionStateForTests, createEmptyChatObject } from '../../../src/state/sessions.ts';

let domWindow: Window | null = null;

beforeEach(() => {
  const chat = createEmptyChatObject('intent-test-chat');
  setSessionStateForTests({ chats: [chat], activeId: chat.id });
});

afterEach(() => {
  domWindow?.close();
  domWindow = null;
  resetEditorAiCompletionConfigCache();
  setEditorAiCompletionConfigForTests(DEFAULT_EDITOR_AI_COMPLETION);
});

function testAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

describe('resolveIntentLine', () => {
  test('returns binding error when model is not assigned', async () => {
    setEditorAiCompletionConfigForTests({
      ...DEFAULT_EDITOR_AI_COMPLETION,
      useChatModel: false,
      providerId: 'provider-1',
      modelId: '',
    });

    const result = await resolveIntentLine({
      filePath: 'src/app.ts',
      intentText: 'funciton add(a,b',
      above: [],
      below: [],
      signal: testAbortSignal(),
    });

    assert.equal(result.text, null);
    assert.equal(result.error, EDITOR_AI_NO_MODEL_MESSAGE);
  });

  test('uses reasoning fallback on stream end when content is empty', async () => {
    setEditorAiCompletionConfigForTests({
      ...DEFAULT_EDITOR_AI_COMPLETION,
      useChatModel: false,
      providerId: 'provider-1',
      modelId: 'model-1',
    });

    const chunks: ChatCompletionChunk[] = [
      { choices: [{ delta: { reasoning: '```typescript\nconst x = 1;\n```' } }] },
    ];

    const result = await resolveIntentLine(
      {
        filePath: 'src/app.ts',
        intentText: 'set x to one',
        above: [],
        below: [],
        signal: testAbortSignal(),
      },
      {
        createGeneration: async () => ({ generationId: 'gen-intent-1' }),
        resolveProvider: async () => ({
          id: 'provider-1',
          apiKind: 'openai-v1',
        }),
        subscribeToGeneration: (_id, handlers) => {
          const contentAcc = new StreamingContentAccumulator();
          const reasoningAcc = new BenchmarkStreamReasoningAccumulator();
          for (const chunk of chunks) {
            contentAcc.ingestChoice(chunk.choices?.[0]);
            reasoningAcc.ingestChunk(chunk);
            handlers.onChunk?.(chunk);
          }
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
      },
    );

    assert.equal(result.text, 'const x = 1;');
    assert.equal(result.error, undefined);
  });

  test('returns empty completion message for prose-only replies', async () => {
    setEditorAiCompletionConfigForTests({
      ...DEFAULT_EDITOR_AI_COMPLETION,
      useChatModel: false,
      providerId: 'provider-1',
      modelId: 'model-1',
    });

    const result = await resolveIntentLine(
      {
        filePath: 'src/app.ts',
        intentText: 'broken line',
        above: [],
        below: [],
        signal: testAbortSignal(),
      },
      {
        createGeneration: async () => ({ generationId: 'gen-intent-2' }),
        resolveProvider: async () => ({
          id: 'provider-1',
          apiKind: 'openai-v1',
        }),
        subscribeToGeneration: (_id, handlers) => {
          handlers.onChunk?.({
            choices: [{ delta: { content: 'The user wants me to fix this line.' } }],
          });
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
      },
    );

    assert.equal(result.text, null);
    assert.equal(result.error, EDITOR_AI_EMPTY_COMPLETION_MESSAGE);
  });

  test('mines a code line from prose-heavy content at stream end', () => {
    const text = finalizeIntentResolveDisplay(
      'The user wants me to fix this line.',
      '```typescript\nconst fixed = 1;\n```',
      'broken line',
      true,
    );
    assert.equal(text, 'const fixed = 1;');
  });

  test('restores leading indent for nested intent lines', () => {
    const prefix = 'def count_cats(cats):\n    ';
    const aligned = alignIntentResolvedCode('cat_count += 1', prefix);
    assert.equal(aligned, '    cat_count += 1');
  });

  test('finalizeIntentResolveDisplay aligns to doc prefix', () => {
    const prefix = 'def count_cats(cats):\n    ';
    const text = finalizeIntentResolveDisplay(
      'for cat in cats:',
      '',
      'loop cats',
      false,
      prefix,
    );
    assert.equal(text, '    for cat in cats:');
  });
});

describe('systemPromptForIntent', () => {
  test('mentions incomplete or invalid intent', async () => {
    const { systemPromptForIntent } = await import(
      '../../../src/ui/editor-intent-mode/resolver.ts'
    );
    const prompt = systemPromptForIntent('src/app.ts');
    assert.match(prompt, /incomplete|invalid/i);
  });
});
