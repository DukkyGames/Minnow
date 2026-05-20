/**
 * Tests for client-side tool permission / workspace prompt heuristics.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { toolInvocationWouldPrompt } from '../../src/tools/permission-gate.ts';

describe('toolInvocationWouldPrompt', () => {
  test('ask mode prompts even when paths are inside workspace', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'src/foo.ts' },
        'ask',
        'workspace',
        'C:/proj',
      ),
      true,
    );
  });

  test('full permission skips modal when paths stay inside workspace', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'src/foo.ts' },
        'full',
        'workspace',
        'C:/proj',
      ),
      false,
    );
  });

  test('full permission still prompts when path escapes workspace in workspace FS mode', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'C:/Windows/system.ini' },
        'full',
        'workspace',
        'C:/proj',
      ),
      true,
    );
  });

  test('full filesystem mode skips path-only prompt', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'C:/Windows/system.ini' },
        'full',
        'full',
        'C:/proj',
      ),
      false,
    );
  });
});
