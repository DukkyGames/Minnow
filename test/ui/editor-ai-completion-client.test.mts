import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { ChatCompletionChunk } from '../../src/types.ts';
import {
  resolveEditorCompletionRawText,
  validateEditorAiBinding,
} from '../../src/ui/editor-ai-completion-client.ts';
import { StreamingContentAccumulator } from '../../src/api/message-content.ts';
import {
  BenchmarkStreamReasoningAccumulator,
  resolveBenchmarkCompletionText,
} from '../../src/benchmark/stream-text.ts';
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
    const reasoning = new BenchmarkStreamReasoningAccumulator();
    const chunk: ChatCompletionChunk = {
      choices: [{ delta: { content: 'hello' } }],
    };
    const text = resolveEditorCompletionRawText(content, reasoning, chunk);
    assert.equal(text, 'hello');
    assert.equal(content.getText(), 'hello');
  });

  test('falls back to reasoning when content is empty', () => {
    const content = new StreamingContentAccumulator();
    const reasoning = new BenchmarkStreamReasoningAccumulator();
    resolveEditorCompletionRawText(content, reasoning, {
      choices: [{ delta: { reasoning: 'code();' } }],
    });
    assert.equal(content.getText(), '');
    assert.equal(reasoning.getText(), 'code();');
    assert.equal(
      resolveBenchmarkCompletionText(content.getText(), reasoning.getText()),
      'code();',
    );
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
