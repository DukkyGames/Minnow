import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { DEFAULT_META } from '../../server/config/home.js';
import { mergeConfigMeta } from '../../server/config/validators.js';
import {
  DEFAULT_EDITOR_AI_COMPLETION,
  parseEditorAiCompletionBlock,
} from '../../src/config/editor-ai-completion.ts';

describe('editor AI completion meta', () => {
  test('DEFAULT_META seeds editorAiCompletion enabled by default', () => {
    assert.equal(DEFAULT_META.editorAiCompletion?.enabled, true);
    assert.equal(DEFAULT_META.editorAiCompletion?.debounceMs, 450);
    assert.equal(DEFAULT_META.editorAiCompletion?.maxTokens, 256);
    assert.equal(DEFAULT_META.editorAiCompletion?.useChatModel, true);
    assert.equal(DEFAULT_META.editorAiCompletion?.includeLspContext, true);
    assert.equal(DEFAULT_META.editorAiCompletion?.contextBudgetChars, 4000);
  });

  test('client and server defaults match field-for-field', () => {
    assert.deepEqual(DEFAULT_META.editorAiCompletion, DEFAULT_EDITOR_AI_COMPLETION);
  });

  test('partial merge preserves unspecified fields on server', () => {
    const merged = mergeConfigMeta(
      { editorAiCompletion: { ...DEFAULT_META.editorAiCompletion } },
      { editorAiCompletion: { debounceMs: 600, includeLspHover: false } },
    );
    assert.equal(merged.editorAiCompletion.debounceMs, 600);
    assert.equal(merged.editorAiCompletion.includeLspHover, false);
    assert.equal(merged.editorAiCompletion.enabled, true);
    assert.equal(merged.editorAiCompletion.maxTokens, 256);
    assert.equal(merged.editorAiCompletion.includeLspContext, true);
  });

  test('client parseEditorAiCompletionBlock preserves defaults for missing fields', () => {
    const parsed = parseEditorAiCompletionBlock({ debounceMs: 700 });
    assert.equal(parsed.debounceMs, 700);
    assert.equal(parsed.enabled, true);
    assert.equal(parsed.maxTokens, 256);
    assert.equal(parsed.includeImportContext, true);
    assert.equal(parsed.enableCompletionCache, true);
  });

  test('client parseEditorAiCompletionBlock clamps token limits', () => {
    const parsed = parseEditorAiCompletionBlock({ maxTokens: 9999 });
    assert.equal(parsed.maxTokens, 1024);
  });
});
