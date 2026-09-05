import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isTerminalCopyShortcut,
  isTerminalPasteShortcut,
  shouldCopyTerminalSelectionOnKeydown,
  shouldPasteTerminalOnKeydown,
} from '../../src/ui/terminal-copy-shortcut.ts';

describe('terminal copy shortcut', () => {
  test('isTerminalCopyShortcut accepts Ctrl+C and Cmd+C', () => {
    assert.equal(
      isTerminalCopyShortcut({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
      true,
    );
    assert.equal(
      isTerminalCopyShortcut({
        key: 'C',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      }),
      true,
    );
  });

  test('isTerminalCopyShortcut rejects modified or non-copy chords', () => {
    assert.equal(
      isTerminalCopyShortcut({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
      false,
    );
    assert.equal(
      isTerminalCopyShortcut({
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
      false,
    );
  });

  test('shouldCopyTerminalSelectionOnKeydown only on keydown with selection', () => {
    const event = {
      type: 'keydown',
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    assert.equal(shouldCopyTerminalSelectionOnKeydown(event, true), true);
    assert.equal(shouldCopyTerminalSelectionOnKeydown(event, false), false);
    assert.equal(
      shouldCopyTerminalSelectionOnKeydown({ ...event, type: 'keyup' }, true),
      false,
    );
  });
});

describe('terminal paste shortcut', () => {
  test('isTerminalPasteShortcut accepts Ctrl+V only', () => {
    assert.equal(
      isTerminalPasteShortcut({
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
      true,
    );
    assert.equal(
      isTerminalPasteShortcut({
        key: 'V',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
      true,
    );
  });

  test('isTerminalPasteShortcut leaves Cmd+V and shifted chords to the browser', () => {
    assert.equal(
      isTerminalPasteShortcut({
        key: 'v',
        ctrlKey: false,
        metaKey: true,
        altKey: false,
        shiftKey: false,
      }),
      false,
    );
    assert.equal(
      isTerminalPasteShortcut({
        key: 'v',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: true,
      }),
      false,
    );
    assert.equal(
      isTerminalPasteShortcut({
        key: 'c',
        ctrlKey: true,
        metaKey: false,
        altKey: false,
        shiftKey: false,
      }),
      false,
    );
  });

  test('shouldPasteTerminalOnKeydown only on keydown', () => {
    const event = {
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
    };
    assert.equal(shouldPasteTerminalOnKeydown(event), true);
    assert.equal(shouldPasteTerminalOnKeydown({ ...event, type: 'keyup' }), false);
    assert.equal(shouldPasteTerminalOnKeydown({ ...event, type: 'keypress' }), false);
  });
});
