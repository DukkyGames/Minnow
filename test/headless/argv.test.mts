/**
 * CLI argv parsing for minnow run.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseRunArgs } from '../../src/headless/argv.ts';

describe('parseRunArgs', () => {
  it('requires --prompt when not using --stdin', () => {
    const parsed = parseRunArgs([]);
    assert.equal(parsed.ok, false);
    if (parsed.ok === false) {
      assert.match(parsed.message, /--prompt/);
    }
  });

  it('parses minimal run flags', () => {
    const parsed = parseRunArgs([
      '--prompt',
      'Say OK',
      '--workspace',
      '.',
      '--mode',
      'build',
      '--profile',
      'lite',
    ]);
    assert.equal(parsed.ok, true);
    if (parsed.ok) {
      assert.equal(parsed.options.prompt, 'Say OK');
      assert.equal(parsed.options.workspace, '.');
      assert.equal(parsed.options.modeId, 'build');
      assert.equal(parsed.options.profile, 'lite');
      assert.equal(parsed.options.noApproval, false);
    }
  });

  it('rejects orchestrate mode in v1', () => {
    const parsed = parseRunArgs(['--prompt', 'x', '--mode', 'orchestrate']);
    assert.equal(parsed.ok, false);
    if (parsed.ok === false) {
      assert.match(parsed.message, /orchestrate/i);
    }
  });

  it('rejects invalid profile', () => {
    const parsed = parseRunArgs(['--prompt', 'x', '--profile', 'bogus']);
    assert.equal(parsed.ok, false);
  });
});
