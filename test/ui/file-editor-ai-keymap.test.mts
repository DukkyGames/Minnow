import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { indentMore } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
const DEFAULT_EDITOR_AI_COMPLETION = {
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
};
import {
  fileEditorEscapeBlurBinding,
  fileEditorKeymapBindings,
  fileEditorKeymapExtensions,
  fileEditorTabBinding,
  lspCompletionKeymapBindings,
} from '../../src/ui/file-editor-keymap.ts';
import {
  acceptEditorAiGhost,
  acceptPartialEditorAiGhost,
  dismissEditorAiGhost,
  editorAiCompletionExtensions,
  editorAiGhostKeymapBindings,
  hasEditorAiGhost,
  setEditorAiGhostForTest,
} from '../../src/ui/file-editor-ai-extensions.ts';
import {
  buildCompletionCacheKey,
  hashCompletionContext,
} from '../../src/ui/editor-ai-completion-cache.ts';
import {
  buildEditorAiCompletionMessages,
  buildQwenFimPrompt,
  isQwenFimModel,
  nextPartialGhostChunk,
  QWEN_FIM_MIDDLE,
  QWEN_FIM_PREFIX,
  QWEN_FIM_SUFFIX,
} from '../../src/ui/editor-ai-completion-prompt.ts';
import {
  getCachedEditorAiCompletion,
  resetEditorAiCompletionCache,
  setCachedEditorAiCompletion,
} from '../../src/ui/editor-ai-completion-client.ts';
import { applyReplacementInRange } from '../../src/ui/editor-quick-edit/diff-apply.ts';
import { buildFileViewerContextMenuItems } from '../../src/ui/editor-quick-edit/context-menu.ts';
import { formatSelectionFence } from '../../src/ui/editor-quick-edit/selection-fence.ts';

function setupDom(): void {
  const window = new Window();
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.ResizeObserver = window.ResizeObserver;
}

function mountEditorWithAi(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        ...fileEditorKeymapExtensions(),
        ...editorAiCompletionExtensions({
          filePath: 'test.ts',
          config: { ...DEFAULT_EDITOR_AI_COMPLETION, enabled: true },
          canRequest: () => false,
        }),
      ],
    }),
    parent,
  });
}

describe('file editor AI keymap', () => {
  test('Tab accepts ghost when active', () => {
    setupDom();
    const view = mountEditorWithAi('const ');
    const pos = view.state.doc.length;
    setEditorAiGhostForTest(view, 'x = 1;', pos);
    assert.equal(hasEditorAiGhost(view.state), true);

    const handled = editorAiGhostKeymapBindings[0].run!(view);
    assert.equal(handled, true);
    assert.equal(view.state.doc.toString(), 'const x = 1;');
    assert.equal(hasEditorAiGhost(view.state), false);
  });

  test('Mod-ArrowRight partial accept when ghost is visible', () => {
    setupDom();
    const view = mountEditorWithAi('const ');
    const pos = view.state.doc.length;
    setEditorAiGhostForTest(view, 'x = 1;\nmore', pos);

    const partialBinding = editorAiGhostKeymapBindings.find(
      (b) => b.key === 'Mod-ArrowRight',
    );
    assert.ok(partialBinding);
    assert.equal(partialBinding?.preventDefault, true);
    const handled = partialBinding!.run!(view);
    assert.equal(handled, true);
    assert.match(view.state.doc.toString(), /^const x/);
    assert.equal(hasEditorAiGhost(view.state), true);
  });

  test('Tab indents when no ghost is active', () => {
    setupDom();
    const view = mountEditorWithAi('line');
    view.focus();
    const aiHandled = editorAiGhostKeymapBindings[0].run!(view);
    assert.equal(aiHandled, false);
    const indentHandled = fileEditorTabBinding.run!(view);
    assert.equal(indentHandled, true);
    assert.equal(view.state.doc.toString(), '  line');
  });

  test('Escape dismisses ghost (preventDefault binding)', () => {
    setupDom();
    const view = mountEditorWithAi('abc');
    setEditorAiGhostForTest(view, 'ghost', 3);

    const escapeBinding = editorAiGhostKeymapBindings.find((b) => b.key === 'Escape');
    const dismissed = escapeBinding!.run!(view);
    assert.equal(dismissed, true);
    assert.equal(hasEditorAiGhost(view.state), false);
    assert.equal(escapeBinding?.preventDefault, true);
  });

  test('LSP completion keymap uses Tab accept via fileEditorTabBinding, not Enter', () => {
    const lspKeys = lspCompletionKeymapBindings.map((b) => b.key);
    assert.equal(lspKeys.includes('Enter'), false);
    assert.equal(fileEditorTabBinding.key, 'Tab');
    assert.equal(typeof fileEditorTabBinding.run, 'function');
    assert.equal(typeof indentMore, 'function');
  });

  test('ghost Escape binding returns false when no ghost', () => {
    setupDom();
    const view = mountEditorWithAi('abc');
    const escapeBinding = editorAiGhostKeymapBindings.find((b) => b.key === 'Escape');
    const handled = escapeBinding!.run!(view);
    assert.equal(handled, false);
  });

  test('acceptEditorAiGhost and dismissEditorAiGhost helpers', () => {
    setupDom();
    const view = mountEditorWithAi('fn(');
    setEditorAiGhostForTest(view, 'a, b', 3);
    assert.equal(acceptEditorAiGhost(view), true);
    assert.equal(view.state.doc.toString(), 'fn(a, b');

    setEditorAiGhostForTest(view, 'tmp', 6);
    assert.equal(dismissEditorAiGhost(view), true);
    assert.equal(view.state.doc.toString(), 'fn(a, b');
  });

  test('acceptPartialEditorAiGhost accepts one chunk', () => {
    setupDom();
    const view = mountEditorWithAi('a');
    setEditorAiGhostForTest(view, 'bc def', 1);
    assert.equal(acceptPartialEditorAiGhost(view), true);
    assert.equal(view.state.doc.toString(), 'abc ');
    assert.equal(hasEditorAiGhost(view.state), true);
  });
});

describe('editor AI prompt FIM + cache', () => {
  test('isQwenFimModel detects Qwen Coder ids', () => {
    assert.equal(isQwenFimModel('qwen2.5-coder-7b'), true);
    assert.equal(isQwenFimModel('llama-3'), false);
  });

  test('buildEditorAiCompletionMessages uses native FIM for Qwen', () => {
    const doc = 'import x from "y";\nconst a = ';
    const state = EditorState.create({ doc });
    const pos = doc.length;
    const result = buildEditorAiCompletionMessages({
      state,
      cursorPos: pos,
      filePath: 'src/demo.ts',
      config: DEFAULT_EDITOR_AI_COMPLETION,
      modelId: 'qwen2.5-coder-7b',
    });
    assert.equal(result.useNativeFim, true);
    assert.match(result.fimPrompt ?? '', new RegExp(`${QWEN_FIM_PREFIX}.+${QWEN_FIM_SUFFIX}`, 's'));
    assert.equal(result.fimPrompt?.endsWith(QWEN_FIM_MIDDLE), true);
    assert.equal(result.messages.length, 0);
  });

  test('buildEditorAiCompletionMessages falls back to chat for non-Qwen', () => {
    const doc = 'const a = ';
    const state = EditorState.create({ doc });
    const result = buildEditorAiCompletionMessages({
      state,
      cursorPos: doc.length,
      filePath: 'src/demo.ts',
      config: DEFAULT_EDITOR_AI_COMPLETION,
      modelId: 'llama-3',
    });
    assert.equal(result.useNativeFim, false);
    assert.equal(result.messages.length, 2);
    assert.match(String(result.messages[1].content), /<CURSOR>/);
  });

  test('buildQwenFimPrompt wraps prefix and suffix', () => {
    assert.equal(buildQwenFimPrompt('pre', 'suf'), `${QWEN_FIM_PREFIX}pre${QWEN_FIM_SUFFIX}suf${QWEN_FIM_MIDDLE}`);
  });

  test('nextPartialGhostChunk accepts word or line', () => {
    assert.equal(nextPartialGhostChunk('foo bar'), 'foo ');
    assert.equal(nextPartialGhostChunk('\nline'), '\n');
  });

  test('completion cache key uses prefix tail and suffix head', () => {
    const prefixTail = `${'a'.repeat(508)}TAIL`;
    const suffixHead = `HEAD${'b'.repeat(508)}`;
    const key = buildCompletionCacheKey('src/a.ts', prefixTail, suffixHead);
    const keySame = buildCompletionCacheKey(
      'src/a.ts',
      `ignored${prefixTail}`,
      `${suffixHead}ignored`,
    );
    assert.equal(key, keySame);
    assert.notEqual(key, buildCompletionCacheKey('src/b.ts', prefixTail, suffixHead));
    assert.equal(typeof hashCompletionContext('test'), 'string');
  });

  test('completion cache stores and reads sanitized text', () => {
    resetEditorAiCompletionCache();
    setCachedEditorAiCompletion('f.ts', 'pre', 'suf', 'done');
    assert.equal(getCachedEditorAiCompletion('f.ts', 'pre', 'suf'), 'done');
    resetEditorAiCompletionCache();
    assert.equal(getCachedEditorAiCompletion('f.ts', 'pre', 'suf'), undefined);
  });
});

describe('quick edit diff + context menu', () => {
  test('applyReplacementInRange replaces selection span', () => {
    const doc = 'hello world';
    const next = applyReplacementInRange(doc, 6, 11, 'there');
    assert.equal(next, 'hello there');
  });

  test('formatSelectionFence includes lang and line range', () => {
    const fenced = formatSelectionFence('const x = 1;', 'src/app.ts', 10, 12);
    assert.match(fenced, /^```typescript src\/app\.ts:10-12\n/);
    assert.match(fenced, /const x = 1;/);
  });

  test('buildFileViewerContextMenuItems with selection', () => {
    const labels: string[] = [];
    const items = buildFileViewerContextMenuItems({
      path: 'src/a.ts',
      hasEditorSelection: true,
      isMarkdown: false,
      isMarkdownPreview: false,
      onAddSelectionToChat: () => labels.push('add'),
      onQuickEdit: () => labels.push('edit'),
      onSwitchToCode: () => labels.push('code'),
      onSwitchToPreview: () => labels.push('preview'),
    });
    assert.deepEqual(
      items.map((i) => i.label),
      ['Add selection to chat', 'Quick edit'],
    );
    items[0].action?.();
    items[1].action?.();
    assert.deepEqual(labels, ['add', 'edit']);
  });

  test('buildFileViewerContextMenuItems keeps markdown preview when no selection', () => {
    const items = buildFileViewerContextMenuItems({
      path: 'readme.md',
      hasEditorSelection: false,
      isMarkdown: true,
      isMarkdownPreview: true,
      onAddSelectionToChat: () => {},
      onQuickEdit: () => {},
      onSwitchToCode: () => {},
      onSwitchToPreview: () => {},
    });
    assert.deepEqual(items.map((i) => i.label), ['Open as code']);
  });
});
