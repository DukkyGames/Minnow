/**
 * Minnow Issues app registration, routing, and shell markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { hashForRoute, parseOsHash, resolveLegacyHash } from '../../src/os/router.ts';

describe('issues app registry', () => {
  test('issues is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'issues'));
    const issues = getAppById('issues');
    assert.ok(issues);
    assert.match(issues.tag, /triage|track|capture/i);
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
  test('index.html defines a thin issuesView mount', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="issuesView"/);
    assert.doesNotMatch(html, /id="issuesPanelMount"/);
    assert.doesNotMatch(html, /id="issuesQuickCapture"/);
  });
});

describe('issues list CSS contract', () => {
  test('width rules use a named container query, not viewport media', () => {
    const css = fs.readFileSync(new URL('../../src/styles/issues.css', import.meta.url), 'utf8');
    assert.match(css, /container-name:\s*issues/);
    assert.match(css, /@container issues \(max-width: 900px\)/);
    assert.match(css, /--issues-peek-cols: minmax\(0, 1fr\) minmax\(380px, 520px\)/);
    assert.match(css, /\.issues-list-head[\s\S]*color: var\(--mn-fg-muted\)/);
    assert.doesNotMatch(css, /@media \(max-width: 900px\)/);
    assert.doesNotMatch(css, /@media \(max-width: 640px\)/);
    assert.doesNotMatch(css, /^\s*max-width:\s*65ch/m);
    assert.match(css, /\.issues-empty--triage/);
  });
});
