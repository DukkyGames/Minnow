import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
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
  includeLspContext: true,
  contextBudgetChars: 4000,
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
  acceptCompletionGhost,
  acceptPartialCompletionGhost,
  dismissSuggestion,
  editorSuggestionBaseExtensions,
  editorSuggestionExtensions,
  editorSuggestionKeymapBindings,
  hasCompletionSuggestion,
  setCompletionSuggestionForTest,
} from '../../src/ui/editor-suggestions/index.ts';
import {
  buildCompletionCacheKey,
  hashCompletionContext,
} from '../../src/ui/editor-ai-completion-cache.ts';
import {
  buildEditorAiCompletionMessages,
  nextPartialGhostChunk,
  PROMPT_VERSION,
} from '../../src/ui/editor-ai-completion-prompt.ts';
import {
  getCachedEditorAiCompletion,
  resetEditorAiCompletionCache,
  setCachedEditorAiCompletion,
} from '../../src/ui/editor-ai-completion-client.ts';
import { applyReplacementInRange } from '../../src/ui/editor-quick-edit/diff-apply.ts';
import { buildFileViewerContextMenuItems } from '../../src/ui/editor-quick-edit/context-menu.ts';
import { formatSelectionFence } from '../../src/ui/editor-quick-edit/selection-fence.ts';

let domWindow: Window | null = null;

function setupDom(): void {
  const window = new Window();
  domWindow = window;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Node = window.Node;
  globalThis.MutationObserver = window.MutationObserver;
  globalThis.ResizeObserver = window.ResizeObserver;
}

afterEach(() => {
  domWindow?.close();
  domWindow = null;
  document.body.innerHTML = '';
});

function mountEditorWithAi(doc: string): EditorView {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        ...fileEditorKeymapExtensions(),
        ...editorSuggestionBaseExtensions(),
        ...editorSuggestionExtensions({
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
    setCompletionSuggestionForTest(view, 'x = 1;', pos);
    assert.equal(hasCompletionSuggestion(view.state), true);

    const handled = editorSuggestionKeymapBindings[0].run!(view);
    assert.equal(handled, true);
    assert.equal(view.state.doc.toString(), 'const x = 1;');
    assert.equal(hasCompletionSuggestion(view.state), false);
  });

  test('Mod-ArrowRight partial accept when ghost is visible', () => {
    setupDom();
    const view = mountEditorWithAi('const ');
    const pos = view.state.doc.length;
    setCompletionSuggestionForTest(view, 'x = 1;\nmore', pos);

    const partialBinding = editorSuggestionKeymapBindings.find(
      (b) => b.key === 'Mod-ArrowRight',
    );
    assert.ok(partialBinding);
    assert.equal(partialBinding?.preventDefault, true);
    const handled = partialBinding!.run!(view);
    assert.equal(handled, true);
    assert.match(view.state.doc.toString(), /^const x/);
    assert.equal(hasCompletionSuggestion(view.state), true);
  });

  test('Tab indents when no ghost is active', () => {
    setupDom();
    const view = mountEditorWithAi('line');
    view.focus();
    const aiHandled = editorSuggestionKeymapBindings[0].run!(view);
    assert.equal(aiHandled, false);
    const indentHandled = fileEditorTabBinding.run!(view);
    assert.equal(indentHandled, true);
    assert.equal(view.state.doc.toString(), '  line');
  });

  test('Escape dismisses ghost (preventDefault binding)', () => {
    setupDom();
    const view = mountEditorWithAi('abc');
    setCompletionSuggestionForTest(view, 'ghost', 3);

    const escapeBinding = editorSuggestionKeymapBindings.find((b) => b.key === 'Escape');
    const dismissed = escapeBinding!.run!(view);
    assert.equal(dismissed, true);
    assert.equal(hasCompletionSuggestion(view.state), false);
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
    const escapeBinding = editorSuggestionKeymapBindings.find((b) => b.key === 'Escape');
    const handled = escapeBinding!.run!(view);
    assert.equal(handled, false);
  });

  test('acceptCompletionGhost and dismissSuggestion helpers', () => {
    setupDom();
    const view = mountEditorWithAi('fn(');
    setCompletionSuggestionForTest(view, 'a, b', 3);
    assert.equal(acceptCompletionGhost(view), true);
    assert.equal(view.state.doc.toString(), 'fn(a, b');

    setCompletionSuggestionForTest(view, 'tmp', 6);
    assert.equal(dismissSuggestion(view), true);
    assert.equal(view.state.doc.toString(), 'fn(a, b');
  });

  test('acceptPartialCompletionGhost accepts one chunk', () => {
    setupDom();
    const view = mountEditorWithAi('a');
    setCompletionSuggestionForTest(view, 'bc def', 1);
    assert.equal(acceptPartialCompletionGhost(view), true);
    assert.equal(view.state.doc.toString(), 'abc ');
    assert.equal(hasCompletionSuggestion(view.state), true);
  });

});

describe('editor AI prompt + cache (Phase 6)', () => {
  test('buildEditorAiCompletionMessages always uses chat messages', () => {
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
    assert.equal(result.messages.length, 2);
    assert.match(String(result.messages[1].content), /<CURSOR>/);
    assert.match(String(result.messages[1].content), /Insertion constraints:/);
  });

  test('buildEditorAiCompletionMessages includes structured sections for non-Qwen', () => {
    const doc = 'const a = ';
    const state = EditorState.create({ doc });
    const result = buildEditorAiCompletionMessages({
      state,
      cursorPos: doc.length,
      filePath: 'src/demo.ts',
      config: DEFAULT_EDITOR_AI_COMPLETION,
      modelId: 'llama-3',
    });
    assert.equal(result.messages.length, 2);
    assert.match(String(result.messages[1].content), /<CURSOR>/);
  });

  test('nextPartialGhostChunk accepts word or line', () => {
    assert.equal(nextPartialGhostChunk('foo bar'), 'foo ');
    assert.equal(nextPartialGhostChunk('\nline'), '\n');
  });

  test('completion cache key isolates provider and prompt version', () => {
    const config = DEFAULT_EDITOR_AI_COMPLETION;
    const prefixTail = `${'a'.repeat(508)}TAIL`;
    const suffixHead = `HEAD${'b'.repeat(508)}`;
    const key = buildCompletionCacheKey({
      providerId: 'p1',
      modelId: 'm1',
      promptVersion: PROMPT_VERSION,
      config,
      filePath: 'src/a.ts',
      prefix: prefixTail,
      suffix: suffixHead,
    });
    const keySame = buildCompletionCacheKey({
      providerId: 'p1',
      modelId: 'm1',
      promptVersion: PROMPT_VERSION,
      config,
      filePath: 'src/a.ts',
      prefix: `ignored${prefixTail}`,
      suffix: `${suffixHead}ignored`,
    });
    assert.equal(key, keySame);
    assert.notEqual(
      key,
      buildCompletionCacheKey({
        providerId: 'p2',
        modelId: 'm1',
        config,
        filePath: 'src/a.ts',
        prefix: prefixTail,
        suffix: suffixHead,
      }),
    );
    assert.equal(typeof hashCompletionContext('test'), 'string');
  });

  test('completion cache stores and reads validated text', () => {
    resetEditorAiCompletionCache();
    const binding = { providerId: 'p', modelId: 'm' };
    setCachedEditorAiCompletion(binding, DEFAULT_EDITOR_AI_COMPLETION, 'f.ts', 'pre', 'suf', 'done');
    assert.equal(
      getCachedEditorAiCompletion(binding, DEFAULT_EDITOR_AI_COMPLETION, 'f.ts', 'pre', 'suf'),
      'done',
    );
    resetEditorAiCompletionCache();
    assert.equal(
      getCachedEditorAiCompletion(binding, DEFAULT_EDITOR_AI_COMPLETION, 'f.ts', 'pre', 'suf'),
      undefined,
    );
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

  test('buildFileViewerContextMenuItems includes Link to issue when hooked', () => {
    let linked = false;
    const items = buildFileViewerContextMenuItems({
      path: 'src/a.ts',
      hasEditorSelection: true,
      isMarkdown: false,
      isMarkdownPreview: false,
      onAddSelectionToChat: () => {},
      onQuickEdit: () => {},
      onLinkToIssue: () => {
        linked = true;
      },
      onSwitchToCode: () => {},
      onSwitchToPreview: () => {},
    });
    assert.ok(items.some((i) => i.label === 'Link to issue…'));
    items.find((i) => i.label === 'Link to issue…')?.action?.();
    assert.equal(linked, true);
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
