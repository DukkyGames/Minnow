import assert from 'node:assert/strict';
import { beforeEach, describe, test } from 'node:test';
import { registerExpertFilesFromRaw, resetExpertRegistry, listExperts } from '../../src/chat/experts/registry.ts';
import { resolveExpertForTurn } from '../../src/chat/experts/resolve.ts';
import { DEFAULT_EXPERTS_CONFIG } from '../../src/chat/experts/types.ts';
import { loadExpertFixtureMap } from './test-helpers.mjs';

describe('resolveExpertForTurn', () => {
  beforeEach(async () => {
    resetExpertRegistry();
    registerExpertFilesFromRaw(await loadExpertFixtureMap(), 'builtin');
  });

  test('manual security-reviewer', () => {
    const r = resolveExpertForTurn({
      selection: { mode: 'manual', expertId: 'security-reviewer' },
      userText: 'hello',
      registry: listExperts(),
      config: { ...DEFAULT_EXPERTS_CONFIG },
    });
    assert.equal(r.expertId, 'security-reviewer');
    assert.equal(r.source, 'manual');
    assert.equal(r.confidence, 1);
  });

  test('experts.enabled false → none', () => {
    const r = resolveExpertForTurn({
      selection: { mode: 'manual', expertId: 'security-reviewer' },
      userText: 'x',
      registry: listExperts(),
      config: { ...DEFAULT_EXPERTS_CONFIG, enabled: false },
    });
    assert.equal(r.expertId, null);
    assert.equal(r.source, 'none');
  });
});
