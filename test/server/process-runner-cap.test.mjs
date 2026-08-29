/**
 * Process runner accumulation and formatProcessOutput caps (MIN-345).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_MAX_OUTPUT_CHARS,
  PROCESS_MAX_ACCUMULATE_BYTES,
  resolveOutputCapPolicy,
  runWithOutputCapPolicy,
} from '../../server/tools/output-cap.js';
import { formatProcessOutput, runProcess } from '../../server/process-runner.js';

describe('process-runner output caps', () => {
  it('formatProcessOutput truncates oversized stdout', () => {
    const stdout = 'x'.repeat(DEFAULT_MAX_OUTPUT_CHARS + 5_000);
    const formatted = formatProcessOutput('test cmd', { code: 0, stdout, stderr: '' });
    assert.match(formatted, /\[truncated — \d+ of \d+ chars;/);
    assert.ok(formatted.length < stdout.length);
  });

  it('formatProcessOutput does not slice when applyResultCap is false', () => {
    const stdout = 'x'.repeat(DEFAULT_MAX_OUTPUT_CHARS + 5_000);
    const policy = resolveOutputCapPolicy({ enabled: false, maxChars: DEFAULT_MAX_OUTPUT_CHARS }, {});
    const formatted = runWithOutputCapPolicy(policy, () =>
      formatProcessOutput('test cmd', { code: 0, stdout, stderr: '' }),
    );
    assert.doesNotMatch(formatted, /\[truncated —/);
    assert.ok(formatted.includes(stdout.slice(0, 40)));
  });

  it('formatProcessOutput notes subprocess accumulation truncation', () => {
    const formatted = formatProcessOutput('test cmd', {
      code: 0,
      stdout: 'ok',
      stderr: '',
      accumulationTruncated: true,
    });
    assert.match(formatted, /exceeded .* bytes and was cut during capture/);
  });

  it('runProcess stops accumulating stdout beyond byte ceiling', async () => {
    const limitMb = Math.ceil(PROCESS_MAX_ACCUMULATE_BYTES / (1024 * 1024)) + 1;
    const result = await runProcess('node', [
      '-e',
      `process.stdout.write('a'.repeat(${limitMb} * 1024 * 1024))`,
    ]);
    assert.equal(result.accumulationTruncated, true);
    assert.ok(Buffer.byteLength(result.stdout, 'utf8') <= PROCESS_MAX_ACCUMULATE_BYTES);
  });
});
