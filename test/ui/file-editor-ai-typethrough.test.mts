import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { EditorState } from '@codemirror/state';
import {
  createCompletionSuggestion,
  mapCompletionSuggestion,
  resolveSuggestionAfterTransaction,
  splitCloseBracketInsert,
} from '../../src/ui/editor-suggestions/state.ts';

function ghostAt(text: string, pos: number) {
  return createCompletionSuggestion(text, pos, 'test');
}

describe('splitCloseBracketInsert', () => {
  test('splits auto-closed parentheses', () => {
    assert.deepEqual(splitCloseBracketInsert('()'), { typed: '(', autoClosed: ')' });
    assert.deepEqual(splitCloseBracketInsert('x'), { typed: 'x', autoClosed: '' });
  });
});

describe('mapCompletionSuggestion type-through', () => {
  test('maps a single matching insertion at the ghost anchor', () => {
    const doc = 'const x = ';
    const pos = doc.length;
    const start = EditorState.create({ doc, selection: { anchor: pos, head: pos } });
    const ghost = ghostAt('42;', pos);
    const tr = start.update({
      changes: { from: pos, insert: '4' },
      selection: { anchor: pos + 1, head: pos + 1 },
    });
    const mapped = mapCompletionSuggestion(ghost, tr);
    assert.ok(mapped);
    assert.equal(mapped!.text, '2;');
    assert.equal(mapped!.consumed, '4');
    assert.equal(mapped!.pos, pos + 1);
  });

  test('strips auto-closed bracket from ghost remainder after closeBrackets insert', () => {
    const doc = 'if ';
    const pos = doc.length;
    const start = EditorState.create({ doc, selection: { anchor: pos, head: pos } });
    const ghost = ghostAt('();', pos);
    const tr = start.update({
      changes: { from: pos, insert: '()' },
      selection: { anchor: pos + 2, head: pos + 2 },
    });
    const mapped = mapCompletionSuggestion(ghost, tr);
    assert.ok(mapped);
    assert.equal(mapped!.consumed, '(');
    assert.equal(mapped!.text, ';');
    assert.equal(mapped!.pos, pos + 2);
  });

  test('returns null when typed text diverges from ghost', () => {
    const doc = 'const x = ';
    const pos = doc.length;
    const start = EditorState.create({ doc, selection: { anchor: pos, head: pos } });
    const ghost = ghostAt('42;', pos);
    const tr = start.update({
      changes: { from: pos, insert: '5' },
      selection: { anchor: pos + 1, head: pos + 1 },
    });
    assert.equal(mapCompletionSuggestion(ghost, tr), null);
  });

  test('returns null when the ghost is fully typed out', () => {
    const doc = 'const x = ';
    const pos = doc.length;
    const start = EditorState.create({ doc, selection: { anchor: pos, head: pos } });
    const ghost = ghostAt('42;', pos);
    const tr = start.update({
      changes: { from: pos, insert: '42;' },
      selection: { anchor: pos + 3, head: pos + 3 },
    });
    assert.equal(mapCompletionSuggestion(ghost, tr), null);
  });

  test('returns null when multiple document changes occur in one transaction', () => {
    const doc = 'const x = ';
    const pos = doc.length;
    const start = EditorState.create({ doc, selection: { anchor: pos, head: pos } });
    const ghost = ghostAt('42;', pos);
    const tr = start.update({
      changes: [
        { from: 0, insert: '!' },
        { from: pos, insert: '4' },
      ],
      selection: { anchor: pos + 2, head: pos + 2 },
    });
    assert.equal(mapCompletionSuggestion(ghost, tr), null);
  });
});

describe('resolveSuggestionAfterTransaction selection-only', () => {
  test('keeps ghost when selection changes but head stays at anchor', () => {
    const doc = 'const x = ';
    const pos = doc.length;
    const start = EditorState.create({ doc, selection: { anchor: pos, head: pos } });
    const ghost = ghostAt('42;', pos);
    const tr = start.update({
      selection: { anchor: pos, head: pos },
    });
    const resolved = resolveSuggestionAfterTransaction(tr, ghost);
    assert.ok(resolved);
    assert.equal(resolved!.kind, 'completion');
  });

  test('clears ghost when selection moves away from anchor', () => {
    const doc = 'const x = ';
    const pos = doc.length;
    const start = EditorState.create({ doc, selection: { anchor: pos, head: pos } });
    const ghost = ghostAt('42;', pos);
    const tr = start.update({
      selection: { anchor: 0, head: 0 },
    });
    assert.equal(resolveSuggestionAfterTransaction(tr, ghost), null);
  });
});
