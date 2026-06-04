import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EditorState } from '@codemirror/state';
const DEFAULT_EDITOR_AI_COMPLETION = {
  enabled: false,
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
};
import {
  buildEditorAiCompletionMessages,
  extractImportSymbols,
  extractPrefixSuffix,
  languageHintFromPath,
  sanitizeCompletionText,
} from '../../src/ui/editor-ai-completion-prompt.ts';

describe('editor AI completion prompt', () => {
  test('languageHintFromPath maps TypeScript extensions', () => {
    assert.equal(languageHintFromPath('src/foo.ts'), 'TypeScript');
    assert.equal(languageHintFromPath('src/foo.tsx'), 'TypeScript React');
  });

  test('extractPrefixSuffix respects cursor and caps', () => {
    const doc = 'line one\nline two\nline three';
    const state = EditorState.create({ doc });
    const pos = doc.indexOf('two') + 3;
    const { prefix, suffix } = extractPrefixSuffix(state.doc, pos, {
      ...DEFAULT_EDITOR_AI_COMPLETION,
      maxPrefixLines: 1,
      maxSuffixLines: 1,
      maxPrefixChars: 100,
      maxSuffixChars: 100,
    });
    assert.match(prefix, /line two$/);
    assert.match(suffix, /line three/);
  });

  test('buildEditorAiCompletionMessages uses FIM layout', () => {
    const doc = 'const x = 1;\n';
    const state = EditorState.create({ doc });
    const pos = doc.length;
    const { messages } = buildEditorAiCompletionMessages({
      state,
      cursorPos: pos,
      filePath: 'src/demo.ts',
      config: DEFAULT_EDITOR_AI_COMPLETION,
    });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    const user = messages[1];
    assert.equal(user.role, 'user');
    assert.match(String(user.content), /File: src\/demo\.ts/);
    assert.match(String(user.content), /Language: TypeScript/);
    assert.match(String(user.content), /<CURSOR>/);
  });

  test('sanitizeCompletionText strips markdown fences', () => {
    const raw = '```ts\nconst y = 2;\n```';
    assert.equal(sanitizeCompletionText(raw), 'const y = 2;');
  });

  test('sanitizeCompletionText strips duplicate doc prefix', () => {
    assert.equal(sanitizeCompletionText('const x = 1', 'const x = '), '1');
  });

  test('buildEditorAiCompletionMessages includes import context in chat mode', () => {
    const doc = 'import fs from "node:fs";\nconst x = 1;\n';
    const state = EditorState.create({ doc });
    const pos = doc.indexOf('const') + 6;
    const { messages } = buildEditorAiCompletionMessages({
      state,
      cursorPos: pos,
      filePath: 'src/demo.ts',
      config: DEFAULT_EDITOR_AI_COMPLETION,
      modelId: 'llama-3',
    });
    assert.match(String(messages[1].content), /Imports \/ requires:/);
    assert.match(String(messages[1].content), /import fs/);
  });

  test('extractImportSymbols collects top-of-file imports', () => {
    const text = 'import a from "a";\nimport { b } from "b";\n\nconst x = 1;';
    assert.match(extractImportSymbols(text), /import a/);
    assert.match(extractImportSymbols(text), /import \{ b \}/);
  });

  test('sanitizeCompletionText handles binary-safe paths in user content', () => {
    const path = 'docs/weird-name_%.md';
    const doc = '# Title\n';
    const state = EditorState.create({ doc });
    const { messages } = buildEditorAiCompletionMessages({
      state,
      cursorPos: doc.length,
      filePath: path,
      config: DEFAULT_EDITOR_AI_COMPLETION,
    });
    assert.match(String(messages[1].content), /docs\/weird-name_%\.md/);
  });
});
