/**
 * LSP completion source helpers — trigger detection and CodeMirror mapping.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { Window } from 'happy-dom';
import { CompletionContext, type CompletionInfo } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import {
  buildLspCompletionContext,
  charBeforeCursor,
  completionDedupKey,
  completionInfoFromDocumentation,
  completionSectionFromKind,
  isCompletionRequestValid,
  LSP_COMPLETION_TRIGGER_CHARACTER,
  LSP_COMPLETION_TRIGGER_INCOMPLETE,
  LSP_COMPLETION_TRIGGER_INVOKED,
  LSP_IDENTIFIER_MATCH,
  shouldOpenCompletionOnInput,
  stableSortCompletionItems,
  toCmCompletion,
} from '../../src/ui/lsp-completion-source.ts';

let domWindow: Window | null = null;

function setupDom(): Window {
  const window = new Window();
  domWindow = window;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.HTMLDivElement = window.HTMLDivElement;
  return window;
}

function makeContext(doc: string, pos: number, explicit = false): CompletionContext {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, pos, explicit);
}

afterEach(() => {
  domWindow?.close();
  domWindow = null;
});

describe('lsp completion source', () => {
  test('charBeforeCursor returns the preceding character', () => {
    const state = EditorState.create({ doc: 'abc' });
    assert.equal(charBeforeCursor(state.doc, 3), 'c');
    assert.equal(charBeforeCursor(state.doc, 0), null);
  });

  test('isCompletionRequestValid accepts explicit, word prefix, and trigger chars', () => {
    const wordCtx = makeContext('let foo', 7);
    assert.equal(isCompletionRequestValid(wordCtx, ['.']), true);

    const dotCtx = makeContext('console.', 8);
    assert.equal(isCompletionRequestValid(dotCtx, ['.']), true);

    const bareCtx = makeContext(' ', 1);
    assert.equal(isCompletionRequestValid(bareCtx, ['.']), false);

    const explicitCtx = makeContext(' ', 1, true);
    assert.equal(isCompletionRequestValid(explicitCtx, ['.']), true);
  });

  test('isCompletionRequestValid rejects positions without identifier or trigger char', () => {
    const parenCtx = makeContext('(', 1);
    assert.equal(isCompletionRequestValid(parenCtx, ['.']), false);

    const docStartCtx = makeContext('hello', 0);
    assert.equal(isCompletionRequestValid(docStartCtx, ['.']), false);
  });

  test('LSP_IDENTIFIER_MATCH allows zero-length match at trigger positions', () => {
    const dotCtx = makeContext('console.', 8);
    const match = dotCtx.matchBefore(LSP_IDENTIFIER_MATCH);
    assert.ok(match);
    assert.equal(match!.text, '');
    assert.equal(match!.from, 8);
  });

  test('buildLspCompletionContext maps invoke, trigger char, and incomplete refetch', () => {
    const explicit = makeContext('x', 1, true);
    assert.deepEqual(buildLspCompletionContext(explicit, ['.'], false), {
      triggerKind: LSP_COMPLETION_TRIGGER_INVOKED,
    });

    const dot = makeContext('obj.', 4);
    assert.deepEqual(buildLspCompletionContext(dot, ['.'], false), {
      triggerKind: LSP_COMPLETION_TRIGGER_CHARACTER,
      triggerCharacter: '.',
    });

    const incomplete = makeContext('obj.', 4);
    assert.deepEqual(buildLspCompletionContext(incomplete, ['.'], true), {
      triggerKind: LSP_COMPLETION_TRIGGER_INCOMPLETE,
    });
  });

  test('shouldOpenCompletionOnInput matches server trigger characters', () => {
    assert.equal(shouldOpenCompletionOnInput('.', ['.', '(']), true);
    assert.equal(shouldOpenCompletionOnInput('a', ['.']), false);
  });

  test('completionDedupKey keeps distinct overloads with the same label', () => {
    const a = { label: 'foo', insertText: 'foo()', detail: '(): void' };
    const b = { label: 'foo', insertText: 'foo(x)', detail: '(x: number): void' };
    assert.notEqual(completionDedupKey(a), completionDedupKey(b));
  });

  test('stableSortCompletionItems orders by sortText', () => {
    const sorted = stableSortCompletionItems([
      { label: 'z', insertText: 'z', sortText: '9999' },
      { label: 'a', insertText: 'a', sortText: '0000' },
    ]);
    assert.deepEqual(sorted.map((i) => i.label), ['a', 'z']);
  });

  test('toCmCompletion maps filterText, sortText, preselect, and commitCharacters', () => {
    const cm = toCmCompletion(
      'src/foo.ts',
      {
        label: 'DisplayLabel',
        filterText: 'filterMe',
        sortText: '0001',
        preselect: true,
        commitCharacters: [';'],
        insertText: 'filterMe',
      },
      'filterMe',
    );
    assert.equal(cm.label, 'filterMe');
    assert.equal(cm.displayLabel, 'DisplayLabel');
    assert.equal(cm.sortText, '0001');
    assert.equal(cm.boost, 99);
    assert.deepEqual(cm.commitCharacters, [';']);
  });

  test('completionSectionFromKind maps LSP kinds to grouped section headers', () => {
    assert.equal(completionSectionFromKind(14)?.name, 'Keywords');
    assert.equal(completionSectionFromKind(2)?.name, 'Methods');
    assert.equal(completionSectionFromKind(10)?.name, 'Properties');
    assert.equal(completionSectionFromKind(undefined), undefined);
  });

  test('toCmCompletion assigns section from LSP kind', () => {
    const cm = toCmCompletion(
      'src/foo.ts',
      { label: 'if', insertText: 'if', kind: 14 },
      'if',
    );
    assert.equal((cm.section as { name: string }).name, 'Keywords');
  });

  test('toCmCompletion uses inline documentation when present', () => {
    const cm = toCmCompletion(
      'src/foo.ts',
      { label: 'foo', insertText: 'foo', documentation: 'Inline docs' },
      'foo',
    );
    assert.equal(cm.info, 'Inline docs');
  });

  test('toCmCompletion lazy-resolves documentation when item has data', async () => {
    const window = setupDom();
    try {
      let resolveCalled = false;
      const cm = toCmCompletion(
        'src/foo.ts',
        { label: 'bar', insertText: 'bar', data: { id: 1 } },
        'bar',
        async () => {
          resolveCalled = true;
          return { label: 'bar', insertText: 'bar', documentation: 'Resolved docs' };
        },
      );
      assert.equal(typeof cm.info, 'function');
      const infoFn = cm.info as (completion: typeof cm) => Promise<CompletionInfo>;
      const resolved = await infoFn(cm);
      assert.equal(resolveCalled, true);
      assert.ok(resolved instanceof HTMLElement);
      assert.equal(resolved.textContent, 'Resolved docs');
    } finally {
      window.close();
    }
  });

  test('completionInfoFromDocumentation supports markdown objects', () => {
    assert.equal(
      completionInfoFromDocumentation({ kind: 'markdown', value: '**bold**' }),
      '**bold**',
    );
  });
});
