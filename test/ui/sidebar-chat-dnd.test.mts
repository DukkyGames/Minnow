/**
 * Sidebar chat drag-and-drop helpers.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { CHAT_DRAG_MIME } from '../../src/attachments/chat-drag.ts';
import { resetSidebarChatDnDForTests } from '../../src/ui/sidebar-chat-dnd.ts';

afterEach(() => {
  resetSidebarChatDnDForTests();
});

describe('sidebar chat dnd', () => {
  test('exports chat drag mime type', () => {
    assert.equal(CHAT_DRAG_MIME, 'application/x-minnow-chat-id');
  });
});
