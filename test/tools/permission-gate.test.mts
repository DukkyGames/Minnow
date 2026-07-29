/**
 * Tests for client-side tool permission / workspace prompt heuristics.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  companionToolRequiresApproval,
  outsideWorkspaceBlockMessage,
  toolInvocationWouldPrompt,
} from '../../src/tools/permission-gate.ts';

describe('companionToolRequiresApproval', () => {
  test('forces approval for mutating and command tools', () => {
    assert.equal(companionToolRequiresApproval('save_file'), true);
    assert.equal(companionToolRequiresApproval('git_commit'), true);
    assert.equal(companionToolRequiresApproval('execute_command'), true);
    assert.equal(companionToolRequiresApproval('email_action'), true);
  });

  test('does not force an extra prompt for read-only tools', () => {
    assert.equal(companionToolRequiresApproval('read_file'), false);
    assert.equal(companionToolRequiresApproval('web_search'), false);
    assert.equal(companionToolRequiresApproval('git_status'), false);
  });
});

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

  test('full permission blocks without modal when path escapes workspace in workspace FS mode', () => {
    assert.equal(
      toolInvocationWouldPrompt(
        'read_file',
        { path: 'C:/Windows/system.ini' },
        'full',
        'workspace',
        'C:/proj',
      ),
      false,
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

  test('outsideWorkspaceBlockMessage matches server copy', () => {
    assert.equal(
      outsideWorkspaceBlockMessage('/'),
      'Error: Path "/" resolves outside the workspace directory. Enable full disk access in Settings → General → Filesystem access (dangerous) or set TOOLS_ALLOW_ALL_PATHS=1 for automation.',
    );
  });
});
