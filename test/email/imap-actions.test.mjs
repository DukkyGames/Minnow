/**
 * IMAP folder resolution and flag parsing tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { imapFlagsToObject, resolveMailFolder } from '../../server/email/imap-actions.js';

describe('imapFlagsToObject', () => {
  test('maps Seen and Flagged', () => {
    const flags = imapFlagsToObject(['\\Seen', '\\Flagged']);
    assert.equal(flags.seen, true);
    assert.equal(flags.flagged, true);
    assert.equal(flags.answered, false);
  });

  test('defaults unseen unflagged', () => {
    const flags = imapFlagsToObject([]);
    assert.equal(flags.seen, false);
    assert.equal(flags.flagged, false);
  });
});

describe('resolveMailFolder', () => {
  const folders = [
    { path: 'INBOX', name: 'Inbox' },
    { path: '[Gmail]/All Mail', name: 'All Mail', specialUse: '\\All' },
    { path: '[Gmail]/Trash', name: 'Trash', specialUse: '\\Trash' },
  ];

  test('resolves Gmail archive role', () => {
    assert.equal(resolveMailFolder(folders, 'Archive', 'archive'), '[Gmail]/All Mail');
  });

  test('resolves trash role', () => {
    assert.equal(resolveMailFolder(folders, 'Trash', 'trash'), '[Gmail]/Trash');
  });

  test('returns preferred when present', () => {
    assert.equal(resolveMailFolder(folders, 'INBOX', ''), 'INBOX');
  });
});
