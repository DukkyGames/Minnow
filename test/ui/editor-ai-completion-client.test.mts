import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ChatCompletionChunk } from '../../src/types.ts';
import {
  alignCompletionForInsert,
  getCachedEditorAiCompletion,
  resolveEditorCompletionRawText,
  mergeEditorStreamText,
  resolveEditorCompletionDisplayText,
  validateEditorAiBinding,
  preflightEditorAiBinding,
  resolveEditorAiBinding,
  setCachedEditorAiCompletion,
  EDITOR_AI_NO_MODEL_MESSAGE,
  EDITOR_AI_COMPLETION_OVERSIZED_MESSAGE,
  EDITOR_AI_COMPLETION_PROSE_MESSAGE,
  EDITOR_AI_COMPLETION_PREFIX_ECHO_MESSAGE,
  EDITOR_AI_COMPLETION_FULL_REWRITE_MESSAGE,
  editorAiCompletionRejectionMessage,
  fetchEditorAiCompletion,
  buildMessagesForEditorAiCompletion,
} from '../../src/ui/editor-ai-completion-client.ts';
import { extractEditorCodeFromReasoning } from '../../src/ui/editor-model-output.ts';
import { encodeModelSelectKey } from '../../src/lib/model-select-key.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';
import {
  DEFAULT_EDITOR_AI_COMPLETION,
  setEditorAiCompletionConfigForTests,
} from '../../src/config/editor-ai-completion.ts';
import { StreamingContentAccumulator } from '../../src/api/message-content.ts';
import { BenchmarkStreamReasoningAccumulator } from '../../src/benchmark/stream-text.ts';
import {
  editorSuggestionBaseExtensions,
  editorSuggestionExtensions,
  hasCompletionSuggestion,
  setCompletionSuggestionForTest,
} from '../../src/ui/editor-suggestions/index.ts';
import { fileEditorKeymapExtensions } from '../../src/ui/file-editor-keymap.ts';
import {
  EditorAiCompletionCache,
  buildCompletionCacheKey,
  resetEditorAiCompletionCache,
} from '../../src/ui/editor-ai-completion-cache.ts';
import { PROMPT_VERSION } from '../../src/ui/editor-ai-completion-prompt.ts';

let domWindow: Window | null = null;

afterEach(() => {
  domWindow?.close();
  domWindow = null;
});

describe('validateEditorAiBinding', () => {
  test('rejects empty provider', () => {
    const result = validateEditorAiBinding({ providerId: '', modelId: 'm1' });
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /provider/i);
    }
  });

  test('rejects empty model', () => {
    const result = validateEditorAiBinding({ providerId: 'p1', modelId: '' });
    assert.equal(result.ok, false);
    if (result.ok === false) {
      assert.match(result.message, /No model assigned/i);
    }
  });

  test('accepts provider and model', () => {
    const result = validateEditorAiBinding({ providerId: 'p1', modelId: 'm1' });
    assert.equal(result.ok, true);
  });
});

describe('resolveEditorCompletionRawText', () => {
  test('accumulates delta content', () => {
    const content = new StreamingContentAccumulator();
    const chunk: ChatCompletionChunk = {
      choices: [{ delta: { content: 'hello' } }],
    };
    const text = resolveEditorCompletionRawText(content, chunk);
    assert.equal(text, 'hello');
    assert.equal(content.getText(), 'hello');
  });

  test('ignores reasoning channel deltas', () => {
    const content = new StreamingContentAccumulator();
    const text = resolveEditorCompletionRawText(content, {
      choices: [{ delta: { reasoning: 'I need to think about this...' } }],
    });
    assert.equal(content.getText(), '');
    assert.equal(text, '');
  });
});

describe('extractEditorCodeFromReasoning', () => {
  test('extracts fenced code from reasoning buffer', () => {
    const reasoning = 'Let me think...\n```typescript\nconst x = 1;\n```';
    assert.equal(extractEditorCodeFromReasoning(reasoning), 'const x = 1;');
  });

  test('returns empty for reasoning monologue only', () => {
    assert.equal(
      extractEditorCodeFromReasoning('The user wants me to complete this function.'),
      '',
    );
  });
});

describe('resolveEditorCompletionDisplayText', () => {
  test('does not use reasoning while streaming', () => {
    assert.equal(
      resolveEditorCompletionDisplayText('', 'const x = 1;', { reasoningFallback: false }),
      '',
    );
  });

  test('uses reasoning fallback after stream ends', () => {
    assert.equal(
      resolveEditorCompletionDisplayText('', '```\ncode();\n```', { reasoningFallback: true }),
      'code();',
    );
  });
});

describe('editor AI completion cache (Phase 6)', () => {
  test('cache key includes provider, model, and prompt version', () => {
    const config = { ...DEFAULT_EDITOR_AI_COMPLETION };
    const keyA = buildCompletionCacheKey({
      providerId: 'p1',
      modelId: 'm1',
      config,
      filePath: 'a.ts',
      prefix: 'const ',
      suffix: '',
    });
    const keyB = buildCompletionCacheKey({
      providerId: 'p2',
      modelId: 'm1',
      config,
      filePath: 'a.ts',
      prefix: 'const ',
      suffix: '',
    });
    assert.notEqual(keyA, keyB);
    assert.match(keyA, /^[a-z0-9]+$/);
    assert.equal(PROMPT_VERSION, '6');
  });

  test('LRU cache evicts oldest entry at capacity', () => {
    const cache = new EditorAiCompletionCache(2, 60_000);
    const binding = { providerId: 'p', modelId: 'm' };
    const config = { ...DEFAULT_EDITOR_AI_COMPLETION };
    setCachedEditorAiCompletion(binding, config, 'a.ts', '1', '', 'one', cache);
    setCachedEditorAiCompletion(binding, config, 'b.ts', '2', '', 'two', cache);
    setCachedEditorAiCompletion(binding, config, 'c.ts', '3', '', 'three', cache);
    assert.equal(cache.size, 2);
    assert.equal(
      getCachedEditorAiCompletion(binding, config, 'a.ts', '1', '', cache),
      undefined,
    );
    assert.equal(
      getCachedEditorAiCompletion(binding, config, 'c.ts', '3', '', cache),
      'three',
    );
  });

  test('cache does not store empty text', () => {
    resetEditorAiCompletionCache();
    const cache = new EditorAiCompletionCache();
    const binding = { providerId: 'p', modelId: 'm' };
    const config = { ...DEFAULT_EDITOR_AI_COMPLETION };
    setCachedEditorAiCompletion(binding, config, 'a.ts', 'x', '', '', cache);
    assert.equal(
      getCachedEditorAiCompletion(binding, config, 'a.ts', 'x', '', cache),
      undefined,
    );
  });
});

describe('fetchEditorAiCompletion transport', () => {
  test('sends structured chat messages, not raw prompt', async () => {
    const doc = 'const x = ';
    const state = EditorState.create({ doc });
    let capturedBody: Record<string, unknown> | null = null;

    const result = await fetchEditorAiCompletion({
      state,
      cursorPos: doc.length,
      filePath: 'demo.ts',
      config: { ...DEFAULT_EDITOR_AI_COMPLETION, enableCompletionCache: false },
      binding: { providerId: 'test-provider', modelId: 'coder-1' },
      signal: new AbortController().signal,
      deps: {
        resolveProvider: async () => ({
          id: 'test-provider',
          apiKind: 'openai-v1',
        }),
        buildMessagesAsync: async (input) => ({
          messages: buildMessagesForEditorAiCompletion(input),
          prefix: 'const x = ',
          suffix: '',
        }),
        createGeneration: async (_providerId, body) => {
          capturedBody = body;
          return { generationId: 'gen-1' };
        },
        subscribeToGeneration: (_id, handlers) => {
          handlers.onChunk?.({
            choices: [{ delta: { content: '42;' } }],
          });
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
        cancelGeneration: async () => {},
      },
    });

    assert.equal(result.text, '42;');
    assert.ok(capturedBody);
    assert.ok(Array.isArray(capturedBody.messages));
    assert.equal('prompt' in capturedBody, false);
    const messages = capturedBody.messages as Array<{ role: string; content: string }>;
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    assert.equal(messages[1].role, 'user');
    assert.match(messages[1].content, /<CURSOR>/);
  });
});

describe('alignCompletionForInsert', () => {
  test('aligns streamed text against prefix and suffix', () => {
    const result = alignCompletionForInsert('42;}}}', 'const x = ', '}}}');
    assert.equal(result.rejected, false);
    assert.equal(result.text, '42;');
  });

  test('returns rejection metadata for prose', () => {
    const result = alignCompletionForInsert(
      "Here's the answer:\nfoo",
      'const x = ',
      '',
    );
    assert.equal(result.rejected, true);
    assert.equal(result.reason, 'prose');
  });
});

describe('editorAiCompletionRejectionMessage', () => {
  test('maps alignment reasons to user-facing copy', () => {
    assert.equal(editorAiCompletionRejectionMessage('oversized'), EDITOR_AI_COMPLETION_OVERSIZED_MESSAGE);
    assert.equal(editorAiCompletionRejectionMessage('prose'), EDITOR_AI_COMPLETION_PROSE_MESSAGE);
    assert.equal(
      editorAiCompletionRejectionMessage('prefix_echo'),
      EDITOR_AI_COMPLETION_PREFIX_ECHO_MESSAGE,
    );
    assert.equal(
      editorAiCompletionRejectionMessage('full_rewrite'),
      EDITOR_AI_COMPLETION_FULL_REWRITE_MESSAGE,
    );
  });
});

describe('fetchEditorAiCompletion rejection', () => {
  test('returns prose message when alignment rejects streamed output', async () => {
    const doc = 'const x = ';
    const state = EditorState.create({ doc });
    const result = await fetchEditorAiCompletion({
      state,
      cursorPos: doc.length,
      filePath: 'demo.ts',
      config: { ...DEFAULT_EDITOR_AI_COMPLETION, enableCompletionCache: false },
      binding: { providerId: 'test-provider', modelId: 'coder-1' },
      signal: new AbortController().signal,
      deps: {
        resolveProvider: async () => ({
          id: 'test-provider',
          apiKind: 'openai-v1',
        }),
        buildMessagesAsync: async (input) => ({
          messages: buildMessagesForEditorAiCompletion(input),
          prefix: 'const x = ',
          suffix: '',
        }),
        createGeneration: async () => ({ generationId: 'gen-prose' }),
        subscribeToGeneration: (_id, handlers) => {
          handlers.onChunk?.({
            choices: [{ delta: { content: "Here's the completion:\n42;" } }],
          });
          handlers.onEnd?.({ status: 'complete' });
          return () => {};
        },
        cancelGeneration: async () => {},
      },
    });
    assert.equal(result.text, null);
    assert.equal(result.error, EDITOR_AI_COMPLETION_PROSE_MESSAGE);
  });
});

describe('mergeEditorStreamText', () => {
  test('returns trimmed content channel text', () => {
    assert.equal(mergeEditorStreamText('  const y = 2;  '), 'const y = 2;');
  });

  test('returns empty for reasoning-only monologue', () => {
    assert.equal(
      mergeEditorStreamText('The user wants me to complete this function.'),
      '',
    );
  });
});

describe('fetchEditorAiCompletion abort', () => {
  test('returns null text and cancels generation when aborted', async () => {
    const doc = 'const x = ';
    const state = EditorState.create({ doc });
    const controller = new AbortController();
    let cancelCalled = false;
    let subscribed = false;

    const promise = fetchEditorAiCompletion({
      state,
      cursorPos: doc.length,
      filePath: 'demo.ts',
      config: { ...DEFAULT_EDITOR_AI_COMPLETION, enableCompletionCache: false },
      binding: { providerId: 'test-provider', modelId: 'coder-1' },
      signal: controller.signal,
      deps: {
        resolveProvider: async () => ({
          id: 'test-provider',
          apiKind: 'openai-v1',
        }),
        buildMessagesAsync: async (input) => ({
          messages: buildMessagesForEditorAiCompletion(input),
          prefix: 'const x = ',
          suffix: '',
        }),
        createGeneration: async () => ({ generationId: 'gen-abort' }),
        subscribeToGeneration: () => {
          subscribed = true;
          return () => {};
        },
        cancelGeneration: async () => {
          cancelCalled = true;
        },
      },
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(subscribed, true);
    controller.abort();
    const result = await promise;
    assert.equal(result.text, null);
    assert.equal(cancelCalled, true);
  });
});

describe('editor AI model binding (MIN-133)', () => {
  test('preflight fails when model id is empty', () => {
    assert.equal(
      preflightEditorAiBinding({ providerId: 'lm-studio-local', modelId: '' }),
      EDITOR_AI_NO_MODEL_MESSAGE,
    );
    assert.equal(
      preflightEditorAiBinding({ providerId: 'p', modelId: 'llama-3' }),
      null,
    );
  });

  test('resolveEditorAiBinding uses top-bar model when following chat', async () => {
    const window = new Window();
    domWindow = window;
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;

    const chat = createEmptyChatObject('');
    chat.providerId = 'stale-provider';
    chat.modelId = '';
    setSessionStateForTests({ chats: [chat], activeId: chat.id });

    const select = document.createElement('select');
    select.id = 'modelSelect';
    const opt = document.createElement('option');
    opt.value = encodeModelSelectKey('ollama-local', 'qwen2.5-coder');
    select.appendChild(opt);
    select.value = opt.value;
    document.body.appendChild(select);

    setEditorAiCompletionConfigForTests({
      ...DEFAULT_EDITOR_AI_COMPLETION,
      useChatModel: true,
      providerId: '',
      modelId: '',
    });

    const { getEditorAiCompletionConfigSync } = await import(
      '../../src/config/editor-ai-completion.ts'
    );
    const resolved = await resolveEditorAiBinding(getEditorAiCompletionConfigSync());
    assert.equal(resolved.providerId, 'ollama-local');
    assert.equal(resolved.modelId, 'qwen2.5-coder');
  });

  test('resolveEditorAiBinding requires explicit model when pinned', async () => {
    const chat = createEmptyChatObject('chat-model');
    setSessionStateForTests({ chats: [chat], activeId: chat.id });

    setEditorAiCompletionConfigForTests({
      ...DEFAULT_EDITOR_AI_COMPLETION,
      useChatModel: false,
      providerId: 'lm-studio-local',
      modelId: '',
    });

    const { getEditorAiCompletionConfigSync } = await import(
      '../../src/config/editor-ai-completion.ts'
    );
    const binding = await resolveEditorAiBinding(getEditorAiCompletionConfigSync());
    assert.equal(binding.providerId, 'lm-studio-local');
    assert.equal(binding.modelId, '');
    assert.equal(preflightEditorAiBinding(binding), EDITOR_AI_NO_MODEL_MESSAGE);
  });
});

describe('editor AI ghost DOM', () => {
  test('ghost widget renders in the editor', () => {
    const window = new Window();
    domWindow = window;
    globalThis.window = window;
    globalThis.document = window.document;
    globalThis.HTMLElement = window.HTMLElement;
    globalThis.Node = window.Node;
    globalThis.MutationObserver = window.MutationObserver;
    globalThis.ResizeObserver = window.ResizeObserver;

    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: 'const x = ',
        extensions: [
          ...fileEditorKeymapExtensions(),
          ...editorSuggestionBaseExtensions(),
          ...editorSuggestionExtensions({
            filePath: 'test.ts',
            config: DEFAULT_EDITOR_AI_COMPLETION,
            canRequest: () => false,
          }),
        ],
      }),
      parent,
    });

    const pos = view.state.doc.length;
    setCompletionSuggestionForTest(view, '42;', pos);
    assert.equal(hasCompletionSuggestion(view.state), true);
    const ghost = parent.querySelector('.cm-ai-ghost-text');
    assert.ok(ghost, 'expected ghost span in editor DOM');
    assert.equal(ghost?.textContent, '42;');
  });
});
