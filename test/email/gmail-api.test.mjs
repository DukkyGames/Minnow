/**
 * Gmail API message mapping fixtures.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mapGmailMessage } from '../../server/email/gmail-api.js';

describe('mapGmailMessage', () => {
  test('maps headers and snippet into EmailMessage shape', () => {
    const row = mapGmailMessage(
      {
        id: 'msg-1',
        snippet: 'Hello world preview',
        payload: {
          headers: [
            { name: 'Message-ID', value: '<abc@example.com>' },
            { name: 'Subject', value: 'Test subject' },
            { name: 'From', value: 'Ada <ada@example.com>' },
            { name: 'To', value: 'bob@example.com' },
            { name: 'Date', value: 'Mon, 01 Jan 2024 12:00:00 +0000' },
          ],
          mimeType: 'text/plain',
          body: { data: Buffer.from('Full body text', 'utf8').toString('base64') },
        },
      },
      'INBOX',
    );

    assert.equal(row.uid, 'msg-1');
    assert.equal(row.folder, 'INBOX');
    assert.equal(row.subject, 'Test subject');
    assert.equal(row.from, 'Ada <ada@example.com>');
    assert.equal(row.bodyPreview.length > 0, true);
    assert.equal(row.threadId.length > 0, true);
  });
});
