/**
 * Upstream HTTP error body formatting for generations and research.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  UPSTREAM_ERROR_DETAIL_MAX,
  formatUpstreamHttpErrorDetail,
  formatUpstreamHttpErrorMessage,
} from '../../server/generations/upstream-error-detail.js';

describe('formatUpstreamHttpErrorDetail', () => {
  test('extracts Ollama-style JSON error field', () => {
    const raw = '{"error":"this model requires a paid Ollama Cloud plan"}';
    assert.equal(
      formatUpstreamHttpErrorDetail(raw),
      'this model requires a paid Ollama Cloud plan',
    );
  });

  test('extracts OpenAI-style nested error.message', () => {
    const raw = JSON.stringify({
      error: { message: 'Incorrect API key provided', type: 'invalid_request_error' },
    });
    assert.equal(formatUpstreamHttpErrorDetail(raw), 'Incorrect API key provided');
  });

  test('keeps plain text bodies', () => {
    assert.equal(formatUpstreamHttpErrorDetail('primary unavailable'), 'primary unavailable');
  });

  test('collapses whitespace', () => {
    assert.equal(formatUpstreamHttpErrorDetail('line one\n\nline two'), 'line one line two');
  });

  test('truncates very long bodies with ellipsis', () => {
    const long = 'x'.repeat(UPSTREAM_ERROR_DETAIL_MAX + 50);
    const formatted = formatUpstreamHttpErrorDetail(long);
    assert.equal(formatted.length, UPSTREAM_ERROR_DETAIL_MAX + 1);
    assert.ok(formatted.endsWith('…'));
  });
});

describe('formatUpstreamHttpErrorMessage', () => {
  test('includes parsed provider detail after status', () => {
    const message = formatUpstreamHttpErrorMessage(
      403,
      '{"error":"this model requires authentication"}',
    );
    assert.equal(message, 'Upstream HTTP 403: this model requires authentication');
  });

  test('replaces HTML error pages with guidance', () => {
    const message = formatUpstreamHttpErrorMessage(502, '<!doctype html><html><body>fail</body></html>');
    assert.equal(
      message,
      'Upstream HTTP 502 (provider returned an HTML error page — check LM Studio / provider logs)',
    );
  });

  test('omits suffix when body is empty', () => {
    assert.equal(formatUpstreamHttpErrorMessage(500, ''), 'Upstream HTTP 500');
  });
});
