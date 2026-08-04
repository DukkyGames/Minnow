/**
 * Minnow Issues app registration, routing, and shell markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, getPresentationMode, isAppId } from '../../src/os/app-registry.ts';
import { hashForRoute, parseOsHash, resolveLegacyHash } from '../../src/os/router.ts';

describe('issues app registry', () => {
  test('issues is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'issues'));
    const issues = getAppById('issues');
    assert.ok(issues);
    assert.match(issues.tag, /triage|track|capture/i);
  });

  test('issues uses fullscreen presentation mode', () => {
    assert.equal(getPresentationMode('issues'), 'fullscreen');
  });

  test('isAppId accepts issues', () => {
    assert.equal(isAppId('issues'), true);
  });
});

describe('issues router', () => {
  test('legacy #/bugs redirects to #/app/issues', () => {
    const legacy = resolveLegacyHash('#/bugs');
    assert.equal(legacy.hash, '#/app/issues');
  });

  test('parseOsHash resolves issues app route', () => {
    const route = parseOsHash('#/app/issues');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'issues');
  });

  test('parseOsHash captures issueId deep link', () => {
    const route = parseOsHash('#/app/issues/ISS-7');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'issues');
    assert.equal(route.issueId, 'ISS-7');
  });

  test('hashForRoute round-trips issue deep links', () => {
    const route = parseOsHash('#/app/issues/ISS-42');
    assert.equal(hashForRoute(route), '#/app/issues/ISS-42');
  });
});

describe('issues markup contract', () => {
  test('index.html defines issuesView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="issuesView"/);
    assert.match(html, /id="issuesPanelMount"/);
    assert.match(html, /id="issuesQuickCapture"/);
  });
});
