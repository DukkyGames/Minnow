import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isHtmlNavigationRequest } from '../../server/runtime/spa-auth-html.js';

function request(url, accept = '*/*', method = 'GET') {
  return { method, url, headers: { accept } };
}

describe('isHtmlNavigationRequest', () => {
  test('recognizes root and deep-link browser navigations', () => {
    assert.equal(isHtmlNavigationRequest(request('/', 'text/html,application/xhtml+xml')), true);
    assert.equal(
      isHtmlNavigationRequest(request('/settings/network', 'text/html,application/xhtml+xml')),
      true,
    );
  });

  test('does not intercept the extensionless Vite client module', () => {
    assert.equal(isHtmlNavigationRequest(request('/@vite/client')), false);
  });

  test('does not intercept source modules or non-navigation methods', () => {
    assert.equal(isHtmlNavigationRequest(request('/src/main.ts')), false);
    assert.equal(isHtmlNavigationRequest(request('/', 'text/html', 'POST')), false);
  });
});
