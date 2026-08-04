/**
 * Minnow Compare app registration and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { resolveLegacyHash, parseOsHash } from '../../src/os/router.ts';

describe('compare app registry', () => {
  test('compare is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'compare'));
    const compare = getAppById('compare');
    assert.ok(compare);
    assert.match(compare.tag, /blind/i);
  });

  test('isAppId accepts compare', () => {
    assert.equal(isAppId('compare'), true);
  });
});

describe('compare router', () => {
  test('legacy #/compare redirects to desktop while Compare app is release-hidden', () => {
    const legacy = resolveLegacyHash('#/compare');
    assert.equal(legacy.hash, '#/desktop');
  });

  test('parseOsHash resolves compare app route', () => {
    const route = parseOsHash('#/app/compare');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'compare');
  });
});

describe('compare markup contract', () => {
  test('index.html defines compareView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="compareView"/);
    assert.match(html, /id="comparePrompt"/);
    assert.match(html, /id="comparePickers"/);
    assert.match(html, /id="compareColumns"/);
    assert.match(html, /id="compareVoteBar"/);
    assert.match(html, /id="btnCompareParallelToggle"/);
    assert.match(html, /id="compareHistoryList"/);
  });
});
