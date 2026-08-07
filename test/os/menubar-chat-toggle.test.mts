/**
 * Menubar session-rail toggle visibility for Code foreground.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  chatToggleAriaLabel,
  isChatToggleVisible,
} from '../../src/os/menubar-visibility.ts';

describe('menubar chat toggle visibility', () => {
  test('toggle visible only for Code', () => {
    assert.equal(isChatToggleVisible(null), false);
    assert.equal(isChatToggleVisible('research'), false);
    assert.equal(isChatToggleVisible('code'), true);
  });

  test('aria label for Code sidebar toggle', () => {
    assert.equal(chatToggleAriaLabel('code'), 'Chat sidebar');
    assert.equal(chatToggleAriaLabel('bench'), null);
  });
});
