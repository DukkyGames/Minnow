/**
 * Sub-agent tool mode resolution for plan-family parent modes.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { resolveSubAgentToolModeId } from '../../src/agents/resolve-sub-agent-tool-mode.ts';

describe('resolveSubAgentToolModeId', () => {
  test('maps super-plan and plan to build for nested tool policy', () => {
    assert.equal(resolveSubAgentToolModeId('super-plan'), 'build');
    assert.equal(resolveSubAgentToolModeId('plan'), 'build');
  });

  test('passes through other modes unchanged', () => {
    assert.equal(resolveSubAgentToolModeId('build'), 'build');
    assert.equal(resolveSubAgentToolModeId('general'), 'general');
    assert.equal(resolveSubAgentToolModeId(undefined), 'build');
  });
});
