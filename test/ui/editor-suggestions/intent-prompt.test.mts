import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';
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
import {
  alignIntentBlock,
  buildIntentMessages,
  finalizeIntentText,
  reindentBlock,
  resolveIntentSuggestion,
  systemPromptForIntent,
} from '../../../src/ui/editor-suggestions/intent-prompt.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../../src/state/sessions.ts';

beforeEach(() => {
  const chat = createEmptyChatObject('intent-test-chat');
  setSessionStateForTests({ chats: [chat], activeId: chat.id });
});

afterEach(() => {
  resetEditorAiCompletionConfigCache();
  setEditorAiCompletionConfigForTests(DEFAULT_EDITOR_AI_COMPLETION);
});

function testAbortSignal(): AbortSignal {
  return new AbortController().signal;
}

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    filePath: 'src/app.ts',
    intentText: 'set x to one',
    instruction: 'set x to one',
    prefix: '',
    suffix: '',
    baseIndent: '',
    signal: testAbortSignal(),
    config: DEFAULT_EDITOR_AI_COMPLETION,
    intentConfig: DEFAULT_EDITOR_INTENT_MODE,
    ...overrides,
  };
}

describe('resolveIntentSuggestion', () => {
  test('returns binding error when model is not assigned', async () => {
    setEditorAiCompletionConfigForTests({
      ...DEFAULT_EDITOR_AI_COMPLETION,
      useChatModel: false,
      providerId: 'provider-1',
      modelId: '',
    });

    const result = await resolveIntentSuggestion(
      baseInput({
        intentText: 'funciton add(a,b',
        instruction: 'funciton add(a,b',
        config: {
          ...DEFAULT_EDITOR_AI_COMPLETION,
          useChatModel: false,
          providerId: 'provider-1',
          modelId: '',
        },
      }),
    );

    assert.equal(result.text, null);
    assert.equal(result.error, EDITOR_AI_NO_MODEL_MESSAGE);
  });

  test('uses reasoning fallback on stream end when content is empty', async () => {
    const chunks: ChatCompletionChunk[] = [
      { choices: [{ delta: { reasoning: '```typescript\nconst x = 1;\n```' } }] },
    ];

    const result = await resolveIntentSuggestion(
      baseInput({
        config: {
          ...DEFAULT_EDITOR_AI_COMPLETION,
          useChatModel: false,
          providerId: 'provider-1',
          modelId: 'model-1',
        },
      }),
      {
        createGeneration: async () => ({ generationId: 'gen-intent-1' }),
        resolveProvider: async () => ({ id: 'provider-1', apiKind: 'openai-v1' }),
        subscribeToGeneration: (_id, handlers) => {
          for (const chunk of chunks) handlers.onChunk?.(chunk);
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
      },
    );

    assert.equal(result.text, 'const x = 1;');
    assert.equal(result.error, undefined);
  });

  test('returns empty completion message for prose-only replies', async () => {
    const result = await resolveIntentSuggestion(
      baseInput({
        intentText: 'broken line',
        instruction: 'broken line',
        config: {
          ...DEFAULT_EDITOR_AI_COMPLETION,
          useChatModel: false,
          providerId: 'provider-1',
          modelId: 'model-1',
        },
      }),
      {
        createGeneration: async () => ({ generationId: 'gen-intent-2' }),
        resolveProvider: async () => ({ id: 'provider-1', apiKind: 'openai-v1' }),
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

  test('keeps every line of a multi-line replacement', async () => {
    const result = await resolveIntentSuggestion(
      baseInput({
        intentText: 'fetch users and sort by name',
        instruction: 'fetch users and sort by name',
        config: {
          ...DEFAULT_EDITOR_AI_COMPLETION,
          useChatModel: false,
          providerId: 'provider-1',
          modelId: 'model-1',
        },
      }),
      {
        createGeneration: async () => ({ generationId: 'gen-intent-3' }),
        resolveProvider: async () => ({ id: 'provider-1', apiKind: 'openai-v1' }),
        subscribeToGeneration: (_id, handlers) => {
          handlers.onChunk?.({
            choices: [
              {
                delta: {
                  content:
                    'const users = await fetchUsers();\nreturn users.sort((a, b) => a.name.localeCompare(b.name));',
                },
              },
            ],
          });
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
      },
    );

    assert.equal(
      result.text,
      'const users = await fetchUsers();\nreturn users.sort((a, b) => a.name.localeCompare(b.name));',
    );
  });

  test('passes fallbackRole editor-completion so intent routes to the editor chain', async () => {
    let seenOptions: Record<string, unknown> | undefined;
    await resolveIntentSuggestion(
      baseInput({
        config: {
          ...DEFAULT_EDITOR_AI_COMPLETION,
          useChatModel: false,
          providerId: 'provider-1',
          modelId: 'model-1',
        },
      }),
      {
        createGeneration: async (_providerId, _body, options) => {
          seenOptions = options as Record<string, unknown>;
          return { generationId: 'gen-intent-4' };
        },
        resolveProvider: async () => ({ id: 'provider-1', apiKind: 'openai-v1' }),
        subscribeToGeneration: (_id, handlers) => {
          handlers.onChunk?.({ choices: [{ delta: { content: 'const x = 1;' } }] });
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
      },
    );
    assert.equal(seenOptions?.fallbackRole, 'editor-completion');
    assert.equal(seenOptions?.persist, false);
  });

  test('raises max_tokens to the intent default cap', async () => {
    let seenBody: Record<string, unknown> | undefined;
    await resolveIntentSuggestion(
      baseInput({
        config: {
          ...DEFAULT_EDITOR_AI_COMPLETION,
          maxTokens: 256,
          useChatModel: false,
          providerId: 'provider-1',
          modelId: 'model-1',
        },
        intentConfig: { ...DEFAULT_EDITOR_INTENT_MODE, maxTokens: 800 },
      }),
      {
        createGeneration: async (_providerId, body) => {
          seenBody = body as Record<string, unknown>;
          return { generationId: 'gen-intent-5' };
        },
        resolveProvider: async () => ({ id: 'provider-1', apiKind: 'openai-v1' }),
        subscribeToGeneration: (_id, handlers) => {
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
      },
    );
    assert.equal(seenBody?.max_tokens, 400);
    assert.deepEqual(seenBody?.stop, ['```', '\n\n\n']);
    assert.equal(seenBody?.temperature, 0.1);
  });

  test('uses the intent model pin when both provider and model are set', async () => {
    let seenProvider = '';
    let seenModel: unknown;
    await resolveIntentSuggestion(
      baseInput({
        intentConfig: {
          ...DEFAULT_EDITOR_INTENT_MODE,
          providerId: 'intent-provider',
          modelId: 'intent-model',
        },
      }),
      {
        createGeneration: async (providerId, body) => {
          seenProvider = providerId;
          seenModel = (body as Record<string, unknown>).model;
          return { generationId: 'gen-intent-6' };
        },
        resolveProvider: async (id?: string) => ({
          id: id ?? 'fallback',
          apiKind: 'openai-v1',
        }),
        resolveBinding: async () => {
          throw new Error('shared binding should not be consulted when pinned');
        },
        subscribeToGeneration: (_id, handlers) => {
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
      },
    );
    assert.equal(seenProvider, 'intent-provider');
    assert.equal(seenModel, 'intent-model');
  });
});

describe('intent output sanitation', () => {
  test('mines a code line from prose-heavy content at stream end', () => {
    const text = finalizeIntentText(
      'The user wants me to fix this line.',
      '```typescript\nconst fixed = 1;\n```',
      'broken line',
      true,
    );
    assert.equal(text, 'const fixed = 1;');
  });

  test('does not truncate multi-line output to the first line', () => {
    const text = finalizeIntentText(
      'const a = 1;\nconst b = 2;\nreturn a + b;',
      '',
      'add two numbers',
      false,
    );
    assert.equal(text, 'const a = 1;\nconst b = 2;\nreturn a + b;');
  });

  test('aligns a block to the intent line indentation', () => {
    const text = finalizeIntentText(
      'for cat in cats:\n    total += 1',
      '',
      'loop cats',
      false,
      '    ',
    );
    assert.equal(text, '    for cat in cats:\n        total += 1');
  });
});

describe('reindentBlock', () => {
  test('adds base indentation to an unindented block', () => {
    assert.deepEqual(reindentBlock(['if (a) {', '  b();', '}'], '    '), [
      '    if (a) {',
      '      b();',
      '    }',
    ]);
  });

  test('dedents a block the model over-indented', () => {
    assert.deepEqual(reindentBlock(['    const a = 1;', '      const b = 2;'], ''), [
      'const a = 1;',
      '  const b = 2;',
    ]);
  });

  test('leaves a block already at the base indentation untouched', () => {
    const lines = ['  a();', '    b();'];
    assert.deepEqual(reindentBlock(lines, '  '), lines);
  });

  test('blanks out whitespace-only lines instead of padding them', () => {
    assert.deepEqual(reindentBlock(['a();', '   ', 'b();'], '  '), [
      '  a();',
      '',
      '  b();',
    ]);
  });

  test('handles the empty block', () => {
    assert.deepEqual(reindentBlock([], '  '), []);
  });

  test('alignIntentBlock strips trailing whitespace and aligns', () => {
    assert.equal(alignIntentBlock('const a = 1;\nconst b = 2;\n\n', '  '), '  const a = 1;\n  const b = 2;');
  });
});

describe('buildIntentMessages', () => {
  test('labels the replacement sections and omits empty context', () => {
    const messages = buildIntentMessages({
      filePath: 'src/app.ts',
      intentText: '  fetch users and sort by name',
      instruction: 'fetch users and sort by name',
      prefix: 'import { db } from "./db";',
      suffix: '',
    });
    assert.equal(messages.length, 2);
    const user = String(messages[1].content);
    assert.match(user, /--- resolved context above ---/);
    assert.match(user, /--- intent line to replace ---/);
    assert.match(user, /fetch users and sort by name/);
    assert.match(user, /--- resolved context below ---\n\(none\)/);
    assert.match(user, /--- code before \(full prefix\) ---/);
    assert.doesNotMatch(user, /recently edited lines/);
  });

  test('includes recent edits when present', () => {
    const messages = buildIntentMessages({
      filePath: 'src/app.ts',
      intentText: 'sort them',
      instruction: 'sort them',
      prefix: 'a',
      suffix: 'b',
      recentEdits: [{ lineNumber: 3, before: 'x', after: 'y' }],
    });
    assert.match(String(messages[1].content), /--- recently edited lines ---\nL3 before: x/);
  });

  test('system prompt asks for a replacement, not a continuation', () => {
    const prompt = systemPromptForIntent('src/app.ts');
    assert.match(prompt, /replaced by real/i);
    assert.match(prompt, /multiple lines/i);
    assert.match(prompt, /no markdown fences/i);
  });
});
