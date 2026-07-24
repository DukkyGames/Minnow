/**
 * Deterministic selection / drag helpers for the Email inbox.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  canAcceptEmailDrop,
  clearEmailSelection,
  collectMessageIdsForThreads,
  createEmailSelection,
  encodeEmailDragPayload,
  masterCheckboxState,
  parseEmailDragPayload,
  pruneEmailSelection,
  resolveActionTargetIds,
  resolveDragThreadIds,
  selectEmailPage,
  selectEmailFolder,
  selectEmailShiftRange,
  selectionDisplayCount,
  selectionReadAction,
  selectionStarAction,
  shouldOfferFolderSelect,
  toggleEmailSelection,
} from '../../src/ui/email/email-selection';

describe('email selection helpers', () => {
  test('toggle replaces selection unless additive', () => {
    const state = createEmailSelection();
    toggleEmailSelection(state, 'a');
    assert.deepEqual([...state.selected], ['a']);
    toggleEmailSelection(state, 'b');
    assert.deepEqual([...state.selected], ['b']);
    toggleEmailSelection(state, 'c', { additive: true });
    assert.deepEqual([...state.selected].sort(), ['b', 'c']);
  });

  test('select page and clear', () => {
    const state = createEmailSelection();
    selectEmailPage(state, ['a', 'b', 'c']);
    assert.equal(state.selected.size, 3);
    assert.equal(state.anchorId, 'c');
    assert.equal(state.allInFolder, false);
    clearEmailSelection(state);
    assert.equal(state.selected.size, 0);
    assert.equal(state.anchorId, null);
    assert.equal(state.allInFolder, false);
  });

  test('select folder marks all-in-folder scope', () => {
    const state = createEmailSelection();
    selectEmailFolder(state, ['a', 'b', 'c', 'd'], 120);
    assert.equal(state.selected.size, 4);
    assert.equal(state.allInFolder, true);
    assert.equal(state.folderTotal, 120);
    assert.equal(selectionDisplayCount(state), 120);
  });

  test('folder select banner appears only when the page is fully selected', () => {
    const state = createEmailSelection();
    assert.equal(shouldOfferFolderSelect(state, ['a', 'b'], 50), false);
    selectEmailPage(state, ['a', 'b']);
    assert.equal(shouldOfferFolderSelect(state, ['a', 'b'], 50), true);
    selectEmailFolder(state, ['a', 'b'], 50);
    assert.equal(shouldOfferFolderSelect(state, ['a', 'b'], 50), false);
  });

  test('shift range uses page order from the anchor', () => {
    const state = createEmailSelection();
    toggleEmailSelection(state, 'b');
    selectEmailShiftRange(state, ['a', 'b', 'c', 'd'], 'd');
    assert.deepEqual([...state.selected], ['b', 'c', 'd']);
  });

  test('prune drops stale ids', () => {
    const state = createEmailSelection();
    selectEmailPage(state, ['a', 'b', 'gone']);
    const changed = pruneEmailSelection(state, ['a', 'b']);
    assert.equal(changed, true);
    assert.deepEqual([...state.selected].sort(), ['a', 'b']);
  });

  test('master checkbox tri-state', () => {
    const selected = new Set(['a', 'b']);
    assert.equal(masterCheckboxState(selected, ['a', 'b', 'c']), 'some');
    assert.equal(masterCheckboxState(selected, ['a', 'b']), 'all');
    assert.equal(masterCheckboxState(new Set(), ['a']), 'none');
  });

  test('action target preserves a selected group', () => {
    const selected = new Set(['a', 'b']);
    assert.deepEqual(resolveActionTargetIds(selected, 'a').sort(), ['a', 'b']);
    assert.deepEqual(resolveActionTargetIds(selected, 'z'), ['z']);
  });

  test('drag group matches action target rules', () => {
    const selected = new Set(['a', 'b']);
    assert.deepEqual(resolveDragThreadIds(selected, 'a').sort(), ['a', 'b']);
    assert.deepEqual(resolveDragThreadIds(selected, 'z'), ['z']);
  });

  test('drag payload round-trips and rejects malformed input', () => {
    const encoded = encodeEmailDragPayload({
      accountId: 'acct-1',
      sourceFolder: 'INBOX',
      threadIds: ['t1', 't2'],
    });
    assert.deepEqual(parseEmailDragPayload(encoded), {
      accountId: 'acct-1',
      sourceFolder: 'INBOX',
      threadIds: ['t1', 't2'],
    });
    assert.equal(parseEmailDragPayload('{'), null);
    assert.equal(parseEmailDragPayload('{"accountId":"x"}'), null);
  });

  test('drop acceptance requires matching account and a different folder', () => {
    const payload = {
      accountId: 'acct-1',
      sourceFolder: 'INBOX',
      threadIds: ['t1'],
    };
    assert.equal(
      canAcceptEmailDrop(payload, { accountId: 'acct-1', folderPath: 'Archive' }),
      true,
    );
    assert.equal(
      canAcceptEmailDrop(payload, { accountId: 'acct-1', folderPath: 'INBOX' }),
      false,
    );
    assert.equal(
      canAcceptEmailDrop(payload, { accountId: 'other', folderPath: 'Archive' }),
      false,
    );
  });

  test('read and star labels follow mixed selection rules', () => {
    const threads = [
      { threadId: 'a', unreadCount: 1, flagged: false },
      { threadId: 'b', unreadCount: 0, flagged: true },
    ];
    assert.equal(selectionReadAction(threads, new Set(['a', 'b'])), 'read');
    assert.equal(selectionReadAction(threads, new Set(['b'])), 'unread');
    assert.equal(selectionStarAction(threads, new Set(['a', 'b'])), 'flag');
    assert.equal(selectionStarAction(threads, new Set(['b'])), 'unflag');
  });

  test('collectMessageIdsForThreads stays folder-scoped via summary field', () => {
    const ids = collectMessageIdsForThreads(
      [
        { threadId: 't1', messageIds: ['INBOX:1', 'INBOX:2'] },
        { threadId: 't2', messageIds: ['INBOX:3'] },
      ],
      ['t1'],
    );
    assert.deepEqual(ids, ['INBOX:1', 'INBOX:2']);
  });
});
