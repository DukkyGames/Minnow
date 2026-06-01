/**
 * Vibe Coding Hub helpers — mode mapping and intent copy.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  intentPrefill,
  mapIntentModeId,
} from '../../src/ui/hub-intents.ts';

describe('mapIntentModeId', () => {
  test('maps build, plan, explain, and debug intents to Minnow modes', () => {
    assert.equal(mapIntentModeId('build'), 'build');
    assert.equal(mapIntentModeId('plan'), 'plan');
    assert.equal(mapIntentModeId('explain'), 'general');
    assert.equal(mapIntentModeId('debug'), 'debug');
  });
});

describe('intentPrefill', () => {
  test('returns stable composer prefill strings', () => {
    assert.equal(intentPrefill('build'), 'Build a new feature: ');
    assert.equal(intentPrefill('plan'), 'Plan a change to ');
    assert.equal(intentPrefill('explain'), 'Explain how this repo is structured.');
    assert.equal(intentPrefill('debug'), 'Help me debug: ');
  });
});
