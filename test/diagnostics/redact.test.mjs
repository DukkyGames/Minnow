import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { describe, test } from 'node:test';
import {
  formatDiagnosticReportMarkdown,
  redactDiagnosticText,
  redactPaths,
} from '../../server/diagnostics/redact.js';

describe('diagnostics redact', () => {
  test('redactPaths replaces home directory', () => {
    const home = os.homedir();
    if (!home) return;
    const sample = `failed at ${path.join(home, '.minnow', 'session-token')}`;
    const out = redactPaths(sample);
    assert.ok(!out.includes(home), 'home path should be redacted');
    assert.match(out, /\$HOME|\$MINNOW_HOME/);
  });

  test('redactDiagnosticText strips bearer tokens and URLs', () => {
    const raw =
      'Bearer sk-secret-token-abcdefghijklmnop failed https://internal.example.com:9473/api';
    const out = redactDiagnosticText(raw);
    assert.ok(!out.includes('sk-secret-token'), 'token should be redacted');
    assert.ok(!out.includes('internal.example.com'), 'URL should be redacted');
    assert.match(out, /\[redacted/);
  });

  test('formatDiagnosticReportMarkdown contains no raw home paths', () => {
    const home = os.homedir();
    const markdown = formatDiagnosticReportMarkdown({
      version: '1.0.0',
      platform: 'linux',
      nodeVersion: 'v20.0.0',
      errors: [
        {
          signature: 'server|error|boom',
          count: 1,
          message: home ? `crash at ${home}/.minnow/.key` : 'crash',
          stack: home ? `at ${home}/project/file.ts:10` : undefined,
        },
      ],
      logLines: [{ ts: '2026-01-01T00:00:00.000Z', message: 'api_key=supersecret' }],
    });
    if (home) {
      assert.ok(!markdown.includes(home), 'report must not leak home path');
    }
    assert.ok(!markdown.includes('supersecret'), 'report must not leak secrets');
    assert.match(markdown, /Minnow diagnostic report/);
  });
});
