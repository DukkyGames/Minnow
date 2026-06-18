import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ChatCompletionChunk } from '../../src/types.ts';
import {
  resolveEditorCompletionRawText,
  mergeEditorStreamText,
  resolveEditorCompletionDisplayText,
  validateEditorAiBinding,
  preflightEditorAiBinding,
  resolveEditorAiBinding,
  EDITOR_AI_NO_MODEL_MESSAGE,
} from '../../src/ui/editor-ai-completion-client.ts';
import { extractEditorCodeFromReasoning } from '../../src/ui/editor-model-output.ts';
import { encodeModelSelectKey } from '../../src/lib/model-select-key.ts';
import { setSessionStateForTests, createEmptyChatObject } from '../../src/state/sessions.ts';
import { setEditorAiCompletionConfigForTests } from '../../src/config/editor-ai-completion.ts';
import { StreamingContentAccumulator } from '../../src/api/message-content.ts';
import { BenchmarkStreamReasoningAccumulator } from '../../src/benchmark/stream-text.ts';
import {
  editorAiCompletionExtensions,
  hasEditorAiGhost,
  setEditorAiGhostForTest,
} from '../../src/ui/file-editor-ai-extensions.ts';
import { fileEditorKeymapExtensions } from '../../src/ui/file-editor-keymap.ts';

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
      enabled: true,
      debounceMs: 450,
      maxPrefixLines: 80,
      maxSuffixLines: 40,
      maxPrefixChars: 6000,
      maxSuffixChars: 2000,
      temperature: 0.3,
      maxTokens: 256,
      useChatModel: true,
      providerId: '',
      modelId: '',
      includeImportContext: true,
      includeLspHover: true,
      useNativeFim: true,
      enableCompletionCache: true,
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
      enabled: true,
      debounceMs: 450,
      maxPrefixLines: 80,
      maxSuffixLines: 40,
      maxPrefixChars: 6000,
      maxSuffixChars: 2000,
      temperature: 0.3,
      maxTokens: 256,
      useChatModel: false,
      providerId: 'lm-studio-local',
      modelId: '',
      includeImportContext: true,
      includeLspHover: true,
      useNativeFim: true,
      enableCompletionCache: true,
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
          ...editorAiCompletionExtensions({
            filePath: 'test.ts',
            config: {
              enabled: true,
              debounceMs: 450,
              maxPrefixLines: 80,
              maxSuffixLines: 40,
              maxPrefixChars: 6000,
              maxSuffixChars: 2000,
              temperature: 0.3,
              maxTokens: 256,
              useChatModel: true,
              providerId: '',
              modelId: '',
              includeImportContext: true,
              includeLspHover: true,
              useNativeFim: true,
              enableCompletionCache: true,
            },
            canRequest: () => false,
          }),
        ],
      }),
      parent,
    });

    const pos = view.state.doc.length;
    setEditorAiGhostForTest(view, '42;', pos);
    assert.equal(hasEditorAiGhost(view.state), true);
    const ghost = parent.querySelector('.cm-ai-ghost-text');
    assert.ok(ghost, 'expected ghost span in editor DOM');
    assert.equal(ghost?.textContent, '42;');
  });
});
