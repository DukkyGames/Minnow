/**
 * Minnow Email app registration and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { parseOsHash, resolveLegacyHash } from '../../src/os/router.ts';

describe('email app registry', () => {
  test('email is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'email'));
    const email = getAppById('email');
    assert.ok(email);
    assert.match(email.tag, /IMAP|triage/i);
  });

  test('isAppId accepts email', () => {
    assert.equal(isAppId('email'), true);
  });
});

describe('email router', () => {
  test('legacy #/email redirects to desktop while Email app is release-hidden', () => {
    const legacy = resolveLegacyHash('#/email');
    assert.equal(legacy.hash, '#/desktop');
  });

  test('parseOsHash resolves email app route', () => {
    const route = parseOsHash('#/app/email');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'email');
  });
});

describe('email IMAP setup UI', () => {
  test('email panel shows IMAP account form when no accounts exist', () => {
    const source = fs.readFileSync(
      new URL('../../src/ui/email/email-panel.ts', import.meta.url),
      'utf8',
    );
    assert.match(source, /Connect an email account/);
    assert.match(source, /imap\.gmail\.com/);
    assert.doesNotMatch(source, /mountOAuthConnectPanel/);
  });

  test('email panel exposes sign-out controls', () => {
    const source = fs.readFileSync(
      new URL('../../src/ui/email/email-panel.ts', import.meta.url),
      'utf8',
    );
    assert.match(source, /deleteEmailAccount/);
    assert.match(source, /Sign out/);
    assert.doesNotMatch(source, /chromeIconBtn\(EMAIL_ICONS\.signOut/);
  });
});

describe('email markup contract', () => {
  test('index.html defines emailView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="emailView"/);
    assert.match(html, /id="emailPanelMount"/);
    assert.match(html, /id="emailStatus"/);
  });
});
