import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { listComposerModes, listModes } from '../../../src/chat/modes/registry.ts';

describe('listComposerModes', () => {
  test('excludes surface-specific modes from the composer strip', () => {
    const all = listModes().map((m) => m.id);
    const composer = listComposerModes().map((m) => m.id);
    const excluded = ['orchestrate', 'reef', 'desktop', 'onboarding'] as const;
    for (const id of excluded) {
      assert.ok(all.includes(id), `${id} should be a registered mode`);
      assert.ok(!composer.includes(id), `${id} should not be in the composer strip`);
    }
    assert.equal(composer.length, all.length - excluded.length);
  });
});
