/**
 * MinnowOS Calendar app registration and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { parseOsHash, resolveLegacyHash } from '../../src/os/router.ts';

describe('calendar app registry', () => {
  test('calendar is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'calendar'));
    const calendar = getAppById('calendar');
    assert.ok(calendar);
    assert.match(calendar.tag, /CalDAV|ICS/i);
  });

  test('isAppId accepts calendar', () => {
    assert.equal(isAppId('calendar'), true);
  });
});

describe('calendar router', () => {
  test('legacy #/calendar redirects to #/app/calendar', () => {
    const legacy = resolveLegacyHash('#/calendar');
    assert.equal(legacy.hash, '#/app/calendar');
  });

  test('parseOsHash resolves calendar app route', () => {
    const route = parseOsHash('#/app/calendar');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'calendar');
  });
});

describe('calendar oauth UI', () => {
  test('calendar panel mounts OAuth connect panel', () => {
    const source = fs.readFileSync(
      new URL('../../src/ui/calendar/calendar-panel.ts', import.meta.url),
      'utf8',
    );
    assert.match(source, /mountOAuthConnectPanel/);
  });
});

describe('calendar markup contract', () => {
  test('index.html defines calendarView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="calendarView"/);
    assert.match(html, /id="calendarPanelMount"/);
    assert.match(html, /id="calendarStatus"/);
  });
});
