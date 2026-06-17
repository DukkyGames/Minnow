/**
 * Email reading-pane body renderer (HTML vs plain-text toggle).
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { Window } from 'happy-dom';

type EmailBodyModule = typeof import('../../src/ui/email/email-body.ts');

describe('email-body renderer', () => {
  let win: Window;
  let emailBody: EmailBodyModule;

  before(async () => {
    win = new Window();
    globalThis.window = win as unknown as Window & typeof globalThis;
    globalThis.document = win.document as unknown as Document;
    globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
    globalThis.Node = win.Node as unknown as typeof Node;
    emailBody = await import('../../src/ui/email/email-body.ts');
  });

  after(() => {
    win.close();
    delete (globalThis as { window?: unknown }).window;
  });

  test('emailBodySupportsViewToggle when both parts exist', () => {
    assert.equal(
      emailBody.emailBodySupportsViewToggle({
        bodyHtml: '<p>Hi</p>',
        bodyText: 'Hi',
      }),
      true,
    );
  });

  test('emailBodySupportsViewToggle when only plain text exists', () => {
    assert.equal(
      emailBody.emailBodySupportsViewToggle({
        bodyText: 'Hi',
      }),
      false,
    );
  });

  test('renders sanitized HTML by default', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(mount, {
      bodyHtml: '<p>Hello <strong>team</strong></p>',
      bodyText: 'Hello team',
    });

    assert.equal(mount.classList.contains('html-body'), true);
    assert.match(mount.innerHTML, /<strong>team<\/strong>/);
    assert.equal(mount.textContent, 'Hello team');
  });

  test('plain mode shows only the text alternative', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(
      mount,
      {
        bodyHtml: '<p>Hello <strong>team</strong></p>',
        bodyText: 'Hello team',
      },
      'plain',
    );

    assert.equal(mount.classList.contains('html-body'), false);
    assert.equal(mount.textContent, 'Hello team');
    assert.equal(mount.innerHTML, 'Hello team');
  });

  test('falls back to plain text when HTML is missing', () => {
    const mount = document.createElement('div');
    emailBody.renderEmailBody(mount, {
      bodyText: 'Plain only',
    });

    assert.equal(mount.classList.contains('html-body'), false);
    assert.equal(mount.textContent, 'Plain only');
  });
});
