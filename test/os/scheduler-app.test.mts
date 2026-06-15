/**
 * MinnowOS Scheduler app registration and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { parseOsHash, resolveLegacyHash } from '../../src/os/router.ts';

describe('scheduler app registry', () => {
  test('scheduler is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'scheduler'));
    const scheduler = getAppById('scheduler');
    assert.ok(scheduler);
    assert.match(scheduler.tag, /recurring/i);
  });

  test('isAppId accepts scheduler', () => {
    assert.equal(isAppId('scheduler'), true);
  });
});

describe('scheduler router', () => {
  test('legacy #/scheduler redirects to #/app/scheduler', () => {
    const legacy = resolveLegacyHash('#/scheduler');
    assert.equal(legacy.hash, '#/app/scheduler');
  });

  test('legacy #/settings/scheduler redirects to scheduler app', () => {
    const legacy = resolveLegacyHash('#/settings/scheduler');
    assert.equal(legacy.hash, '#/app/scheduler');
  });

  test('parseOsHash resolves scheduler app route', () => {
    const route = parseOsHash('#/app/scheduler');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'scheduler');
  });
});

describe('scheduler markup contract', () => {
  test('index.html defines schedulerView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="schedulerView"/);
    assert.match(html, /id="schedulerPanelMount"/);
    assert.match(html, /id="schedulerStatus"/);
    assert.doesNotMatch(html, /id="settingsSection-scheduler"/);
  });
});
