/**
 * Global keyboard help catalog and typing-target guard.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  getVisibleKeyboardShortcuts,
  GLOBAL_KEYBOARD_SHORTCUTS,
} from '../../src/ui/shell-keyboard-help.ts';

describe('shell keyboard help', () => {
  test('visible catalog includes shell, chat, and board sections', () => {
    const sections = new Set(
      getVisibleKeyboardShortcuts().map((row) => row.section).filter(Boolean),
    );
    assert.ok(sections.has('Shell'));
    assert.ok(sections.has('Chat'));
    assert.ok(sections.has('Orchestrate board'));
  });

  test('visible catalog omits release-gated apps', () => {
    const sections = new Set(
      getVisibleKeyboardShortcuts().map((row) => row.section).filter(Boolean),
    );
    assert.ok(!sections.has('Email'));
    assert.ok(GLOBAL_KEYBOARD_SHORTCUTS.some((row) => row.section === 'Email'));
  });

  test('catalog documents question mark shortcut', () => {
    const helpRow = GLOBAL_KEYBOARD_SHORTCUTS.find((row) => row.keys === '?');
    assert.ok(helpRow);
    assert.match(helpRow?.label ?? '', /shortcut/i);
  });
});
