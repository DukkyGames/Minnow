/**
 * Tests for Orchestrate send gating helpers.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  ORCHESTRATE_DEFAULT_USER_MESSAGE,
  orchestrateRequiresPlanBlock,
  resolveOrchestrateSlashInput,
} from '../../src/chat/orchestrate/send-gate.ts';

describe('orchestrateRequiresPlanBlock', () => {
  test('idle when not orchestrate', () => {
    assert.equal(
      orchestrateRequiresPlanBlock('build', undefined, 'hello', 0),
      'idle',
    );
  });

  test('idle when orchestrate with plan', () => {
    assert.equal(
      orchestrateRequiresPlanBlock(
        'orchestrate',
        'documentation/plans/x.md',
        '',
        0,
      ),
      'idle',
    );
  });

  test('idle when orchestrate without plan and nothing to send', () => {
    assert.equal(
      orchestrateRequiresPlanBlock('orchestrate', undefined, '', 0),
      'idle',
    );
  });

  test('block when orchestrate without plan but user typed text', () => {
    assert.equal(
      orchestrateRequiresPlanBlock('orchestrate', undefined, 'run it', 0),
      'block',
    );
  });

  test('block when orchestrate without plan but has attachments', () => {
    assert.equal(
      orchestrateRequiresPlanBlock('orchestrate', undefined, '', 1),
      'block',
    );
  });
});

describe('resolveOrchestrateSlashInput', () => {
  test('returns raw text when non-orchestrate', () => {
    assert.equal(resolveOrchestrateSlashInput('build', undefined, ''), '');
    assert.equal(resolveOrchestrateSlashInput('build', undefined, 'hi'), 'hi');
  });

  test('returns raw text when orchestrate without plan', () => {
    assert.equal(resolveOrchestrateSlashInput('orchestrate', '', ''), '');
  });

  test('injects default when orchestrate with plan and empty input', () => {
    assert.equal(
      resolveOrchestrateSlashInput(
        'orchestrate',
        'documentation/plans/p.md',
        '',
      ),
      ORCHESTRATE_DEFAULT_USER_MESSAGE,
    );
  });

  test('preserves user text when orchestrate with plan', () => {
    assert.equal(
      resolveOrchestrateSlashInput(
        'orchestrate',
        'documentation/plans/p.md',
        'Only wave 1',
      ),
      'Only wave 1',
    );
  });
});
