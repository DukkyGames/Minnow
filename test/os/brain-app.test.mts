/**
 * MinnowOS Brain app registration and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { resolveLegacyHash, parseOsHash } from '../../src/os/router.ts';
import { WINDOW_MOUNTED_APPS } from '../../src/os/window-mounted-apps.ts';

describe('brain app registry', () => {
  test('brain is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'brain'));
    const brain = getAppById('brain');
    assert.ok(brain);
    assert.match(brain.tag, /wiki/i);
    assert.equal(brain.icon, 'brain');
    assert.equal(brain.presentationMode, 'window');
  });

  test('isAppId accepts brain', () => {
    assert.equal(isAppId('brain'), true);
  });

  test('WINDOW_MOUNTED_APPS includes brain', () => {
    assert.equal(WINDOW_MOUNTED_APPS.has('brain'), true);
  });
});

describe('brain router', () => {
  test('legacy #/brain/edit redirects to app route', () => {
    const legacy = resolveLegacyHash('#/brain/edit');
    assert.equal(legacy.hash, '#/app/brain/edit');
    assert.equal(legacy.brainSection, 'edit');
  });

  test('parseOsHash resolves brain wiki deep link', () => {
    const route = parseOsHash('#/app/brain/wiki');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'brain');
    assert.equal(route.brainSection, 'wiki');
  });
});

describe('brain markup contract', () => {
  test('index.html defines brainView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="brainView"/);
    assert.match(html, /id="brainSection-wiki"/);
    assert.match(html, /id="brainWikiTree"/);
    assert.match(html, /data-brain-nav="proposals"/);
    assert.match(html, /id="brainProposalsList"/);
    assert.match(html, /id="brainSection-settings"/);
    assert.match(html, /id="brainSynthesisEnabled"/);
  });
});
