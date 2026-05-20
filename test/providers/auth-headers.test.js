/**
 * Unit tests for server/providers/auth-headers.js (static expected headers).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthHeaders } from '../../server/providers/auth-headers.js';

const PROFILE_CUSTOM = {
  customHeaders: { 'X-Custom-Example': 'profile-header-fixed' },
};

const PROFILE_API_KEY_STYLE = {
  authStyle: 'api-key',
  customHeaders: { 'X-Custom-Example': 'profile-header-fixed' },
};

describe('buildAuthHeaders', () => {
  it('returns only custom headers when secrets are empty', () => {
    const expected = { 'X-Custom-Example': 'profile-header-fixed' };
    const actual = buildAuthHeaders(PROFILE_CUSTOM, {
      apiKey: '',
      bearerToken: '',
      headerOverrides: {},
    });
    assert.deepEqual(actual, expected);
  });

  it('returns empty object when no auth and no custom headers', () => {
    const expected = {};
    const actual = buildAuthHeaders({}, { apiKey: '', bearerToken: '', headerOverrides: {} });
    assert.deepEqual(actual, expected);
  });

  it('sets Authorization Bearer for bearerToken', () => {
    const expected = { Authorization: 'Bearer test-bearer-fixed' };
    const actual = buildAuthHeaders({}, {
      apiKey: '',
      bearerToken: 'test-bearer-fixed',
      headerOverrides: {},
    });
    assert.deepEqual(actual, expected);
  });

  it('sets Authorization Bearer for apiKey with default bearer style', () => {
    const expected = { Authorization: 'Bearer sk-fixed-key' };
    const actual = buildAuthHeaders({}, {
      apiKey: 'sk-fixed-key',
      bearerToken: '',
      headerOverrides: {},
    });
    assert.deepEqual(actual, expected);
  });

  it('sets api-key header when authStyle is api-key', () => {
    const expected = {
      'X-Custom-Example': 'profile-header-fixed',
      'api-key': 'sk-fixed-key',
    };
    const actual = buildAuthHeaders(PROFILE_API_KEY_STYLE, {
      apiKey: 'sk-fixed-key',
      bearerToken: '',
      headerOverrides: {},
    });
    assert.deepEqual(actual, expected);
  });

  it('merges custom headers then secrets overrides (overrides win)', () => {
    const expected = {
      'X-Custom-Example': 'override-wins-fixed',
      Authorization: 'Bearer test-bearer-fixed',
    };
    const actual = buildAuthHeaders(PROFILE_CUSTOM, {
      apiKey: '',
      bearerToken: 'test-bearer-fixed',
      headerOverrides: { 'X-Custom-Example': 'override-wins-fixed' },
    });
    assert.deepEqual(actual, expected);
  });
});
