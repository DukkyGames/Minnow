/**
 * Menubar session-rail toggle visibility for Code vs Chat foreground apps.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  chatToggleAriaLabel,
  isChatToggleVisible,
  isMenubarCenterVisible,
} from '../../src/os/menubar-visibility.ts';

describe('menubar chat toggle visibility', () => {
  test('toggle visible only for code and chat', () => {
    assert.equal(isChatToggleVisible(null), false);
    assert.equal(isChatToggleVisible('research'), false);
    assert.equal(isChatToggleVisible('code'), true);
    assert.equal(isChatToggleVisible('chat'), true);
  });

  test('center slot visible only for settings search', () => {
    assert.equal(isMenubarCenterVisible('chat'), false);
    assert.equal(isMenubarCenterVisible('code'), false);
    assert.equal(isMenubarCenterVisible('settings'), true);
  });

  test('aria labels distinguish code sidebar vs chat session rail', () => {
    assert.equal(chatToggleAriaLabel('code'), 'Chat sidebar');
    assert.equal(chatToggleAriaLabel('chat'), 'Session rail');
    assert.equal(chatToggleAriaLabel('bench'), null);
  });
});
