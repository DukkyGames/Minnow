/**
 * Project key suggestion and KEY-n parsing.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  issueIdNumericSuffix,
  normalizeProjectKeyInput,
  parseKeyedIssueId,
  suggestProjectKey,
  validateProjectKey,
} from '../../src/issues/project-key.ts';

describe('project-key', () => {
  test('suggestProjectKey uses first three letters for single-word basenames', () => {
    assert.equal(suggestProjectKey('Minnow'), 'MIN');
    assert.equal(suggestProjectKey('workspace'), 'WOR');
  });

  test('suggestProjectKey uses initials for multi-segment names', () => {
    assert.equal(suggestProjectKey('my-cool-app'), 'MCA');
    assert.equal(suggestProjectKey('my_cool_app'), 'MCA');
  });

  test('suggestProjectKey falls back to ISS when too short', () => {
    assert.equal(suggestProjectKey('A'), 'ISS');
    assert.equal(suggestProjectKey(''), 'ISS');
    assert.equal(suggestProjectKey('---'), 'ISS');
  });

  test('validateProjectKey enforces length and charset', () => {
    assert.equal(validateProjectKey('MI'), null);
    assert.equal(validateProjectKey('MINNOWKEYLONG'), 'Use 2–10 letters or numbers.');
    assert.equal(validateProjectKey('M'), 'Use 2–10 letters or numbers.');
  });

  test('normalizeProjectKeyInput uppercases and strips', () => {
    assert.equal(normalizeProjectKeyInput(' min-12 '), 'MIN12');
  });

  test('parseKeyedIssueId and numeric suffix', () => {
    assert.deepEqual(parseKeyedIssueId('MIN-42'), { prefix: 'MIN', number: 42 });
    assert.equal(parseKeyedIssueId('legacy'), null);
    assert.equal(issueIdNumericSuffix('MIN-10'), 10);
    assert.equal(issueIdNumericSuffix('ISS-3'), 3);
  });
});
