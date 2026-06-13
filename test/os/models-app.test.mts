/**
 * MinnowOS Models app registration and markup contract.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { APPS, getAppById, isAppId } from '../../src/os/app-registry.ts';
import { resolveLegacyHash, parseOsHash } from '../../src/os/router.ts';

describe('models app registry', () => {
  test('models is a registered launcher app', () => {
    assert.ok(APPS.some((app) => app.id === 'models'));
    const models = getAppById('models');
    assert.ok(models);
    assert.match(models.tag, /download/i);
    assert.equal(models.icon, 'chip');
  });

  test('isAppId accepts models', () => {
    assert.equal(isAppId('models'), true);
  });
});

describe('models router', () => {
  test('legacy #/settings/providers redirects to models providers', () => {
    const legacy = resolveLegacyHash('#/settings/providers');
    assert.equal(legacy.hash, '#/app/models/providers');
    assert.equal(legacy.modelsSection, 'providers');
  });

  test('legacy #/settings/model-routing redirects to models routing', () => {
    const legacy = resolveLegacyHash('#/settings/model-routing');
    assert.equal(legacy.hash, '#/app/models/routing');
    assert.equal(legacy.modelsSection, 'routing');
  });

  test('parseOsHash resolves models section deep link', () => {
    const route = parseOsHash('#/app/models/recommend');
    assert.equal(route.view, 'app');
    assert.equal(route.appId, 'models');
    assert.equal(route.modelsSection, 'recommend');
  });
});

describe('models markup contract', () => {
  test('index.html defines modelsView shell', () => {
    const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    assert.match(html, /id="modelsView"/);
    assert.match(html, /id="modelsSection-recommend"/);
    assert.match(html, /id="modelsRecommendBody"/);
    assert.match(html, /data-models-nav="providers"/);
  });
});
