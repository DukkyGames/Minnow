/**
 * LSP/AI completion arbitration policy — pure helpers and state transitions.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import {
  autocompletion,
  closeCompletion,
  completionStatus,
  pickedCompletion,
  startCompletion,
  type CompletionResult,
} from '@codemirror/autocomplete';
import { EditorState, type Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  COMPLETION_ACCEPT_COOLDOWN_MS,
  collectInsertedText,
  didLspCloseWithoutAccept,
  hasCompletionAccept,
  isLspBusy,
  isMeaningfulEditText,
  shouldLspTabTakePrecedence,
  suggestionTabTarget,
  shouldScheduleAi,
} from '../../src/ui/editor-completion-policy.ts';
import {
  fileEditorKeymapExtensions,
  fileEditorTabBinding,
} from '../../src/ui/file-editor-keymap.ts';
import {
  editorSuggestionBaseExtensions,
  editorSuggestionExtensions,
  editorSuggestionKeymapBindings,
  setCompletionSuggestionForTest,
} from '../../src/ui/editor-suggestions/index.ts';

let domWindow: Window | null = null;

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

function makeUpdate(
  state: EditorState,
  transactions: Transaction[],
  overrides: Partial<{
    docChanged: boolean;
    selectionSet: boolean;
    readOnly: boolean;
    lspClosedWithoutAccept: boolean;
  }> = {},
) {
  return {
    docChanged: overrides.docChanged ?? transactions.some((tr) => tr.docChanged),
    selectionSet:
      overrides.selectionSet ?? transactions.some((tr) => !tr.newSelection.eq(tr.startState.selection)),
    readOnly: overrides.readOnly ?? state.readOnly,
    state,
    transactions,
    lspClosedWithoutAccept: overrides.lspClosedWithoutAccept ?? false,
  };
}

function applyChange(state: EditorState, spec: Parameters<EditorState['update']>[0]): {
  state: EditorState;
  transaction: Transaction;
} {
  const transaction = state.update(spec);
  return { state: transaction.state, transaction };
}

async function waitForCompletionStatus(
  view: EditorView,
  expected: 'pending' | 'active' | null,
  timeoutMs = 500,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = completionStatus(view.state);
    if (status === expected) return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return completionStatus(view.state);
}

function mountWithCompletion(
  doc: string,
  source: (() => CompletionResult | null) | (() => Promise<CompletionResult | null>),
): EditorView {
  setupDom();
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: [
        autocompletion({
          activateOnTyping: false,
          defaultKeymap: false,
          override: [source],
        }),
      ],
    }),
    parent,
  });
}

afterEach(() => {
  domWindow?.close();
  domWindow = null;
  document.body.innerHTML = '';
});

describe('editor completion policy', () => {
  test('isLspBusy is true while LSP completion is pending', async () => {
    setupDom();
    const pendingView = mountWithCompletion('con', () => new Promise(() => {}));
    startCompletion(pendingView);
    assert.equal(await waitForCompletionStatus(pendingView, 'pending'), 'pending');
    assert.equal(isLspBusy(pendingView.state), true);
    assert.equal(suggestionTabTarget(pendingView.state, { intent: false, completion: true }), 'lsp');
    assert.equal(shouldLspTabTakePrecedence(pendingView.state), true);
    pendingView.destroy();
  });

  test('isLspBusy is true while LSP completion menu is active', async () => {
    setupDom();
    const activeView = mountWithCompletion('con', () => ({
      from: 0,
      options: [{ label: 'console', type: 'function' }],
    }));
    startCompletion(activeView);
    assert.equal(await waitForCompletionStatus(activeView, 'active'), 'active');
    assert.equal(isLspBusy(activeView.state), true);
    activeView.destroy();
  });

  test('isLspBusy is false when completion is idle', () => {
    const state = EditorState.create({ doc: 'idle' });
    assert.equal(isLspBusy(state), false);
    assert.equal(suggestionTabTarget(state, { intent: false, completion: true }), 'completion');
  });

  test('shouldScheduleAi rejects read-only, range selection, IME, and LSP busy', async () => {
    const base = EditorState.create({ doc: 'const x = ' });
    const { state: editedState, transaction } = applyChange(base, {
      changes: { from: 10, insert: '1' },
    });
    const update = makeUpdate(editedState, [transaction]);

    assert.equal(shouldScheduleAi({ ...update, readOnly: true }), false);

    const ranged = EditorState.create({
      doc: 'abc',
      selection: { anchor: 0, head: 3 },
    });
    const rangedEdit = applyChange(ranged, { changes: { from: 3, insert: 'd' } });
    assert.equal(shouldScheduleAi(makeUpdate(rangedEdit.state, [rangedEdit.transaction])), false);

    assert.equal(shouldScheduleAi(update, { isComposing: true }), false);

    setupDom();
    const busyView = mountWithCompletion('con', () => new Promise(() => {}));
    startCompletion(busyView);
    await waitForCompletionStatus(busyView, 'pending');
    const busyEdit = applyChange(busyView.state, { changes: { from: 3, insert: 's' } });
    assert.equal(shouldScheduleAi(makeUpdate(busyEdit.state, [busyEdit.transaction])), false);
    busyView.destroy();
  });

  test('shouldScheduleAi respects completion acceptance cooldown', () => {
    const state = EditorState.create({ doc: 'let ' });
    const { state: editedState, transaction } = applyChange(state, {
      changes: { from: 4, insert: 'a' },
    });
    const update = makeUpdate(editedState, [transaction]);
    const now = 1_000_000;

    assert.equal(
      shouldScheduleAi(update, {
        now,
        completionAcceptedAt: now - 50,
        completionAcceptCooldownMs: COMPLETION_ACCEPT_COOLDOWN_MS,
      }),
      false,
    );

    assert.equal(
      shouldScheduleAi(update, {
        now,
        completionAcceptedAt: now - COMPLETION_ACCEPT_COOLDOWN_MS,
        completionAcceptCooldownMs: COMPLETION_ACCEPT_COOLDOWN_MS,
      }),
      true,
    );
  });

  test('shouldScheduleAi rejects completion-accept and non-meaningful edits', () => {
    const state = EditorState.create({ doc: 'abc' });
    const acceptEdit = applyChange(state, {
      changes: { from: 3, insert: 'Item' },
      annotations: pickedCompletion.of({ label: 'Item', apply: 'Item' }),
    });
    assert.equal(hasCompletionAccept([acceptEdit.transaction]), true);
    assert.equal(shouldScheduleAi(makeUpdate(acceptEdit.state, [acceptEdit.transaction])), false);

    const spaceEdit = applyChange(state, { changes: { from: 3, insert: '   ' } });
    assert.equal(isMeaningfulEditText(collectInsertedText([spaceEdit.transaction])), false);
    assert.equal(shouldScheduleAi(makeUpdate(spaceEdit.state, [spaceEdit.transaction])), false);

    const punctEdit = applyChange(state, { changes: { from: 3, insert: '...' } });
    assert.equal(isMeaningfulEditText(collectInsertedText([punctEdit.transaction])), false);
    assert.equal(shouldScheduleAi(makeUpdate(punctEdit.state, [punctEdit.transaction])), false);

    const deleteEdit = applyChange(state, { changes: { from: 2, to: 3 } });
    assert.equal(shouldScheduleAi(makeUpdate(deleteEdit.state, [deleteEdit.transaction])), false);
  });

  test('shouldScheduleAi allows meaningful identifier and newline edits', () => {
    const state = EditorState.create({ doc: 'const ' });
    const idEdit = applyChange(state, { changes: { from: 6, insert: 'value' } });
    assert.equal(shouldScheduleAi(makeUpdate(idEdit.state, [idEdit.transaction])), true);

    const nlEdit = applyChange(state, { changes: { from: 6, insert: '\n' } });
    assert.equal(shouldScheduleAi(makeUpdate(nlEdit.state, [nlEdit.transaction])), true);
  });

  test('shouldScheduleAi allows idle reschedule after LSP closes without accept', async () => {
    setupDom();
    const view = mountWithCompletion('con', () => ({
      from: 0,
      options: [{ label: 'console', type: 'function' }],
    }));
    startCompletion(view);
    assert.equal(await waitForCompletionStatus(view, 'active'), 'active');

    const beforeClose = view.state;
    closeCompletion(view);
    const afterClose = view.state;
    assert.equal(completionStatus(afterClose), null);
    assert.equal(
      didLspCloseWithoutAccept(beforeClose, afterClose, []),
      true,
    );

    assert.equal(
      shouldScheduleAi(
        {
          docChanged: false,
          selectionSet: false,
          readOnly: false,
          state: afterClose,
          transactions: [],
          lspClosedWithoutAccept: true,
        },
        { isComposing: false, completionAcceptedAt: 0 },
      ),
      true,
    );
    view.destroy();
  });

  test('cursor-only selection changes do not schedule AI', () => {
    const state = EditorState.create({ doc: 'abc', selection: { anchor: 3 } });
    const transaction = state.update({ selection: { anchor: 2 } });
    assert.equal(
      shouldScheduleAi({
        docChanged: false,
        selectionSet: true,
        readOnly: false,
        state: transaction.state,
        transactions: [transaction],
      }),
      false,
    );
  });
});

describe('editor completion keymap coordination', () => {
  function mountEditorWithAiAndLsp(
    doc: string,
    source: (() => CompletionResult | null) | (() => Promise<CompletionResult | null>),
  ): EditorView {
    setupDom();
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView({
      state: EditorState.create({
        doc,
        extensions: [
          autocompletion({
            activateOnTyping: false,
            defaultKeymap: false,
            override: [source],
          }),
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

  test('Tab yields to pending LSP even when AI ghost is visible', async () => {
    const view = mountEditorWithAiAndLsp('con', () => new Promise(() => {}));
    startCompletion(view);
    assert.equal(await waitForCompletionStatus(view, 'pending'), 'pending');
    setCompletionSuggestionForTest(view, 'sole.log()', 3);

    assert.equal(editorSuggestionKeymapBindings[0].run!(view), false);

    const before = view.state.doc.toString();
    assert.equal(fileEditorTabBinding.run!(view), true);
    assert.equal(view.state.doc.toString(), before);
    view.destroy();
  });

  test('Tab defers to active LSP instead of AI ghost', async () => {
    const view = mountEditorWithAiAndLsp('con', () => ({
      from: 0,
      options: [{ label: 'console', apply: 'console' }],
    }));
    startCompletion(view);
    assert.equal(await waitForCompletionStatus(view, 'active'), 'active');
    setCompletionSuggestionForTest(view, 'sole.log()', 3);

    assert.equal(editorSuggestionKeymapBindings[0].run!(view), false);
    assert.equal(shouldLspTabTakePrecedence(view.state), true);
    assert.equal(fileEditorTabBinding.run!(view), true);
    view.destroy();
  });
});
