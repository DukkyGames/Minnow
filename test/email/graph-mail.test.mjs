/**
 * Microsoft Graph mail message mapping fixtures.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { mapGraphMessage } from '../../server/email/graph-mail.js';

describe('mapGraphMessage', () => {
  test('maps Graph message JSON into EmailMessage shape', () => {
    const row = mapGraphMessage(
      {
        id: 'AAMkAGI=',
        internetMessageId: '<graph@example.com>',
        subject: 'Quarterly update',
        receivedDateTime: '2024-06-01T09:30:00Z',
        bodyPreview: 'Preview line',
        body: { contentType: 'text', content: 'Full message body' },
        from: { emailAddress: { name: 'Pat', address: 'pat@contoso.com' } },
        toRecipients: [{ emailAddress: { address: 'you@example.com' } }],
        hasAttachments: false,
      },
      'inbox',
    );

    assert.equal(row.uid, 'AAMkAGI=');
    assert.equal(row.folder, 'inbox');
    assert.equal(row.subject, 'Quarterly update');
    assert.match(row.from, /pat@contoso\.com/);
    assert.equal(row.bodyText, 'Full message body');
  });
});
