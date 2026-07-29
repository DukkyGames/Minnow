/**
 * SPA navigation detection must not swallow Vite dev module paths.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { isHtmlNavigationRequest } from '../../server/runtime/spa-auth-html.js';

function navReq(url, accept = '*/*', method = 'GET') {
  return { method, url, headers: { accept } };
}

describe('isHtmlNavigationRequest', () => {
  test('treats extensionless app routes as HTML navigations', () => {
    assert.equal(isHtmlNavigationRequest(navReq('/settings/general')), true);
    assert.equal(isHtmlNavigationRequest(navReq('/', 'text/html,application/xhtml+xml')), true);
  });

  test('skips Vite dev internal paths without file extensions', () => {
    assert.equal(isHtmlNavigationRequest(navReq('/@vite/client')), false);
    assert.equal(isHtmlNavigationRequest(navReq('/@vite/env')), false);
    assert.equal(isHtmlNavigationRequest(navReq('/@fs/C:/repo/src/main.ts')), false);
    assert.equal(isHtmlNavigationRequest(navReq('/@id/__x00__virtual:module')), false);
  });

  test('skips module and asset paths', () => {
    assert.equal(isHtmlNavigationRequest(navReq('/src/main.ts')), false);
    assert.equal(isHtmlNavigationRequest(navReq('/node_modules/.vite/deps/vue.js')), false);
    assert.equal(isHtmlNavigationRequest(navReq('/api/config/ping')), false);
  });
});
