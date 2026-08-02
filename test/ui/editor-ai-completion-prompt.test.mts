import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EditorState } from '@codemirror/state';
import {
  PROMPT_VERSION,
  EDITOR_AI_FIM_MARKER,
  PROMPT_SECTION_CAPS,
  alignAndValidateCompletionText,
  applyContextBudget,
  buildEditorAiCompletionMessages,
  cursorIndentAt,
  EditorRecentEditsRing,
  extractImportSymbols,
  extractPrefixSuffix,
  formatNearbyDiagnostics,
  languageHintFromPath,
  longestOverlapSuffixPrefix,
  reindentCompletionText,
  sanitizeCompletionText,
  shouldReplaceGhostPartial,
  symbolsEnclosingLine,
  trimOverlapWithDocument,
  isUnchangedPrefixEcho,
  isMeaningfulDocumentOverlap,
} from '../../src/ui/editor-ai-completion-prompt.ts';
import { DEFAULT_EDITOR_AI_COMPLETION } from '../../src/config/editor-ai-completion.ts';

const TEST_CONFIG = {
  ...DEFAULT_EDITOR_AI_COMPLETION,
  enabled: true,
};

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
      ...TEST_CONFIG,
      maxPrefixLines: 1,
      maxSuffixLines: 1,
      maxPrefixChars: 100,
      maxSuffixChars: 100,
    });
    assert.match(prefix, /line two$/);
    assert.match(suffix, /line three/);
  });

  test('buildEditorAiCompletionMessages uses structured chat layout', () => {
    const doc = 'const x = 1;\n';
    const state = EditorState.create({ doc });
    const pos = doc.length;
    const { messages } = buildEditorAiCompletionMessages({
      state,
      cursorPos: pos,
      filePath: 'src/demo.ts',
      config: TEST_CONFIG,
    });
    assert.equal(messages.length, 2);
    assert.equal(messages[0].role, 'system');
    const user = messages[1];
    assert.equal(user.role, 'user');
    const content = String(user.content);
    assert.match(content, /File: src\/demo\.ts/);
    assert.match(content, /Language: TypeScript/);
    assert.match(content, /Insertion constraints:/);
    assert.match(content, /<file>/);
    assert.match(content, new RegExp(EDITOR_AI_FIM_MARKER.replace(/\|/g, '\\|')));
    assert.doesNotMatch(content, /Before cursor:/);
    assert.doesNotMatch(content, /After cursor:/);
    assert.doesNotMatch(content, /Broader context before cursor:/);
    assert.doesNotMatch(content, /Text after cursor:/);
  });

  test('PROMPT_VERSION is exported for cache invalidation', () => {
    assert.equal(PROMPT_VERSION, '7');
  });

  test('buildEditorAiCompletionMessages includes prefix and suffix once in file block', () => {
    const doc = 'alpha\nconst x = 1;\nomega\n';
    const state = EditorState.create({ doc });
    const pos = doc.indexOf('1;');
    const { messages } = buildEditorAiCompletionMessages({
      state,
      cursorPos: pos,
      filePath: 'src/demo.ts',
      config: TEST_CONFIG,
    });
    const content = String(messages[1].content);
    const marker = EDITOR_AI_FIM_MARKER;
    const fileMatch = content.match(/<file>\n([\s\S]*?)\n<\/file>/);
    assert.ok(fileMatch, 'expected <file> block');
    const fileInner = fileMatch[1]!;
    assert.equal(fileInner.split(marker).length - 1, 1);
    assert.match(fileInner, /^alpha\nconst x = /);
    assert.match(fileInner, /<|fim|>1;\nomega\n$/);
  });

  test('buildEditorAiCompletionMessages caps optional context sections', () => {
    const doc = 'const a = 1;\n';
    const state = EditorState.create({ doc });
    const longSymbols = 'x'.repeat(PROMPT_SECTION_CAPS.symbols + 50);
    const longDiag = 'd'.repeat(PROMPT_SECTION_CAPS.diagnostics + 50);
    const { messages } = buildEditorAiCompletionMessages({
      state,
      cursorPos: doc.length,
      filePath: 'src/demo.ts',
      config: TEST_CONFIG,
      lspSymbols: longSymbols,
      lspDiagnostics: longDiag,
    });
    const content = String(messages[1].content);
    const symbolsSection = content.match(/Enclosing symbols:\n([^\n]+)/)?.[1] ?? '';
    const diagSection = content.match(/Nearby diagnostics:\n([^\n]+)/)?.[1] ?? '';
    assert.equal(symbolsSection.length, PROMPT_SECTION_CAPS.symbols);
    assert.equal(diagSection.length, PROMPT_SECTION_CAPS.diagnostics);
  });

  test('buildEditorAiCompletionMessages includes import and LSP context', () => {
    const doc = 'import fs from "node:fs";\nconst x = 1;\n';
    const state = EditorState.create({ doc });
    const pos = doc.indexOf('const') + 6;
    const { messages } = buildEditorAiCompletionMessages({
      state,
      cursorPos: pos,
      filePath: 'src/demo.ts',
      config: TEST_CONFIG,
      modelId: 'llama-3',
      lspSymbols: 'myFn → MyClass',
      lspDiagnostics: 'L2:1 Type error',
      recentEdits: [{ lineNumber: 2, before: 'const x = ', after: 'const x = 1' }],
    });
    const content = String(messages[1].content);
    assert.match(content, /Imports \/ requires:/);
    assert.match(content, /import fs/);
    assert.match(content, /Enclosing symbols:/);
    assert.match(content, /myFn/);
    assert.match(content, /Nearby diagnostics:/);
    assert.match(content, /Recent edits:/);
  });

  test('applyContextBudget respects priority order', () => {
    const kept = applyContextBudget(
      [
        { key: 'broader', priority: 6, text: 'B'.repeat(100) },
        { key: 'scope', priority: 1, text: 'SCOPE' },
        { key: 'edits', priority: 2, text: 'EDITS' },
      ],
      20,
    );
    assert.deepEqual(kept, ['SCOPE', 'EDITS']);
  });

  test('EditorRecentEditsRing tracks changed lines only', () => {
    const ring = new EditorRecentEditsRing(4);
    ring.recordDocChange('line one\nline two', 'line one\nline TWO');
    const snap = ring.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0].lineNumber, 2);
    assert.equal(snap[0].before, 'line two');
    assert.equal(snap[0].after, 'line TWO');
  });

  test('EditorRecentEditsRing recordTransaction uses line-level diffs', () => {
    const ring = new EditorRecentEditsRing(4);
    const state = EditorState.create({ doc: 'line one\nline two' });
    const tr = state.update({
      changes: { from: 14, to: 17, insert: 'TWO' },
      selection: { anchor: 17, head: 17 },
    });
    ring.recordTransaction(tr);
    const snap = ring.snapshot();
    assert.equal(snap.length, 1);
    assert.equal(snap[0].lineNumber, 2);
    assert.equal(snap[0].before, 'line two');
    assert.equal(snap[0].after, 'line TWO');
  });

  test('symbolsEnclosingLine finds nested symbols', () => {
    const names = symbolsEnclosingLine(
      [
        {
          name: 'Outer',
          range: { start: { line: 0 }, end: { line: 10 } },
          children: [{ name: 'inner', range: { start: { line: 5 }, end: { line: 7 } } }],
        },
      ],
      6,
    );
    assert.deepEqual(names, ['Outer', 'inner']);
  });

  test('formatNearbyDiagnostics filters by cursor proximity', () => {
    const text = formatNearbyDiagnostics(
      [
        { message: 'near', range: { start: { line: 4, character: 0 } } },
        { message: 'far', range: { start: { line: 20, character: 0 } } },
      ],
      5,
    );
    assert.match(text, /near/);
    assert.doesNotMatch(text, /far/);
  });

  test('reindentCompletionText preserves leading newlines', () => {
    const prefix = 'function fn() {\n  ';
    assert.equal(
      reindentCompletionText('\nreturn 1;', prefix, '  '),
      '\n  return 1;',
    );
  });

  test('cursorIndentAt reads whitespace before cursor on current line', () => {
    assert.equal(cursorIndentAt('  const x = '), '  ');
  });

  test('longestOverlapSuffixPrefix finds shared boundary', () => {
    assert.equal(longestOverlapSuffixPrefix('abc', 'bcd'), 0);
    assert.equal(longestOverlapSuffixPrefix('foo', 'bar'), 0);
    assert.equal(longestOverlapSuffixPrefix('ab(((', '(((x'), 3);
  });

  test('isMeaningfulDocumentOverlap ignores short identifier clashes', () => {
    assert.equal(isMeaningfulDocumentOverlap('bc'), false);
    assert.equal(isMeaningfulDocumentOverlap(' );'), true);
  });

  test('trimOverlapWithDocument removes meaningful prefix overlap', () => {
    assert.equal(trimOverlapWithDocument('world', 'hello ', ' !'), 'world');
    assert.equal(trimOverlapWithDocument('); next', 'if (x', ' next'), ');');
  });

  test('isUnchangedPrefixEcho allows short non-echo inserts', () => {
    assert.equal(isUnchangedPrefixEcho(');', 'return arr'), false);
    assert.equal(isUnchangedPrefixEcho(';', 'const x = 1'), false);
  });

  test('isUnchangedPrefixEcho rejects long prefix repeats', () => {
    assert.equal(isUnchangedPrefixEcho('const x = ', 'const x = '), true);
  });

  test('alignAndValidateCompletionText rejects prose', () => {
    const result = alignAndValidateCompletionText({
      raw: "Here's the completion:\nconst y = 2;",
      prefix: 'const x = ',
      suffix: '',
    });
    assert.equal(result.rejected, true);
    assert.equal(result.reason, 'prose');
  });

  test('alignAndValidateCompletionText rejects prefix echo', () => {
    const result = alignAndValidateCompletionText({
      raw: 'const x = ',
      prefix: 'const x = ',
      suffix: '',
    });
    assert.equal(result.rejected, true);
    assert.equal(result.reason, 'prefix_echo');
  });

  test('alignAndValidateCompletionText allows single-character closers', () => {
    const result = alignAndValidateCompletionText({
      raw: ');',
      prefix: 'return arr',
      suffix: '',
    });
    assert.equal(result.rejected, false);
    assert.equal(result.text, ');');
  });

  test('alignAndValidateCompletionText trims suffix overlap', () => {
    const result = alignAndValidateCompletionText({
      raw: '42;}}}\n',
      prefix: 'const x = ',
      suffix: '}}}\n',
    });
    assert.equal(result.text, '42;');
  });

  test('alignAndValidateCompletionText rejects oversized insertions', () => {
    const result = alignAndValidateCompletionText({
      raw: 'x'.repeat(500),
      prefix: 'const a = ',
      suffix: '',
      maxInsertChars: 64,
    });
    assert.equal(result.rejected, true);
    assert.equal(result.reason, 'oversized');
  });

  test('alignAndValidateCompletionText rejects unbalanced bracket inserts', () => {
    const result = alignAndValidateCompletionText({
      raw: '((((',
      prefix: 'x',
      suffix: '',
      fenceLang: 'typescript',
    });
    assert.equal(result.rejected, true);
    assert.equal(result.reason, 'unbalanced');
  });

  test('alignAndValidateCompletionText truncates at newline in single mode', () => {
    const result = alignAndValidateCompletionText({
      raw: 'foo\nbar',
      prefix: 'const x = ',
      suffix: 'rest',
      completionMode: 'single',
      fenceLang: 'typescript',
    });
    assert.equal(result.rejected, false);
    assert.equal(result.text, 'foo');
  });

  test('sanitizeCompletionText strips markdown fences', () => {
    const raw = '```ts\nconst y = 2;\n```';
    assert.equal(sanitizeCompletionText(raw), 'const y = 2;');
  });

  test('sanitizeCompletionText strips duplicate doc prefix', () => {
    assert.equal(sanitizeCompletionText('const x = 1', 'const x = '), '1');
  });

  test('shouldReplaceGhostPartial enforces monotonic growth', () => {
    assert.equal(shouldReplaceGhostPartial('ab', 'abc', 'x', ''), true);
    assert.equal(shouldReplaceGhostPartial('abc', 'ab', 'x', ''), false);
    assert.equal(shouldReplaceGhostPartial('ab', 'xy', 'x', ''), false);
  });

  test('extractImportSymbols collects top-of-file imports', () => {
    const text = 'import a from "a";\nimport { b } from "b";\n\nconst x = 1;';
    assert.match(extractImportSymbols(text), /import a/);
    assert.match(extractImportSymbols(text), /import \{ b \}/);
  });
});
