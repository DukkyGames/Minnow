/**
 * Browser allowlist consent applied from ask_question answers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ALLOWLIST_QUESTION_ID,
  extractBrowserAllowlistTargetUrl,
  normalizeBrowserAllowlistDecision,
} from '../../src/tools/browser-navigation-gate.ts';

describe('browser allowlist from ask_question', () => {
  test('normalizeBrowserAllowlistDecision maps always-allow aliases to persist', () => {
    assert.equal(normalizeBrowserAllowlistDecision('persist'), 'persist');
    assert.equal(normalizeBrowserAllowlistDecision('always_allow'), 'persist');
    assert.equal(normalizeBrowserAllowlistDecision('always-allow'), 'persist');
    assert.equal(normalizeBrowserAllowlistDecision('once'), 'once');
    assert.equal(normalizeBrowserAllowlistDecision('deny'), 'deny');
    assert.equal(normalizeBrowserAllowlistDecision('other'), null);
  });

  test('extractBrowserAllowlistTargetUrl reads origin from standard prompt', () => {
    assert.equal(
      extractBrowserAllowlistTargetUrl('Allow browser navigation to https://example.com?'),
      'https://example.com',
    );
  });

  test('extractBrowserAllowlistTargetUrl reads bare hostnames', () => {
    assert.equal(
      extractBrowserAllowlistTargetUrl('Allow browser navigation to docs.example.com?'),
      'https://docs.example.com',
    );
  });

  test('ALLOWLIST_QUESTION_ID matches prompt contract', () => {
    assert.equal(ALLOWLIST_QUESTION_ID, 'browser_allow_origin');
  });
});
