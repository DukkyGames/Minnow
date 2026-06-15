/**
 * MinnowOS Gallery app registration and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { parseOsHash, resolveLegacyHash } from '../../src/os/router.ts';

describe('gallery app registry', () => {
  test('gallery is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'gallery'));
    const gallery = getAppById('gallery');
    assert.ok(gallery);
    assert.match(gallery.tag, /image/i);
  });

  test('isAppId accepts gallery', () => {
    assert.equal(isAppId('gallery'), true);
  });
});

describe('gallery router', () => {
  test('legacy #/gallery redirects to #/app/gallery', () => {
    const legacy = resolveLegacyHash('#/gallery');
    assert.equal(legacy.hash, '#/app/gallery');
  });

  test('parseOsHash resolves gallery app route', () => {
    const route = parseOsHash('#/app/gallery');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'gallery');
  });
});

describe('gallery markup contract', () => {
  test('index.html defines galleryView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="galleryView"/);
    assert.match(html, /id="galleryPanelMount"/);
    assert.match(html, /id="galleryStatus"/);
  });
});
