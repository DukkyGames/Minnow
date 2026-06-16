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

  test('stores sanitized HTML body when text/html part exists', () => {
    const html = '<div><h1>Welcome</h1><p>Thanks for signing up.</p></div>';
    const row = mapGmailMessage(
      {
        id: 'msg-2',
        snippet: 'Thanks for signing up.',
        payload: {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: { data: Buffer.from('Plain only', 'utf8').toString('base64') },
            },
            {
              mimeType: 'text/html',
              body: { data: Buffer.from(html, 'utf8').toString('base64') },
            },
          ],
          headers: [
            { name: 'Message-ID', value: '<html@example.com>' },
            { name: 'Subject', value: 'HTML mail' },
            { name: 'From', value: 'noreply@example.com' },
          ],
        },
      },
      'INBOX',
    );

    assert.equal(row.bodyText, 'Plain only');
    assert.match(String(row.bodyHtml), /Welcome/);
    assert.match(String(row.bodyHtml), /Thanks for signing up/);
  });
});
