import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { listComposerModes, listModes } from '../../../src/chat/modes/registry.ts';

describe('listComposerModes', () => {
  test('excludes orchestrate, reef, and super-plan from the composer strip', () => {
    const all = listModes().map((m) => m.id);
    const composer = listComposerModes().map((m) => m.id);
    assert.ok(all.includes('orchestrate'));
    assert.ok(all.includes('reef'));
    assert.ok(all.includes('super-plan'));
    assert.ok(!composer.includes('orchestrate'));
    assert.ok(!composer.includes('reef'));
    assert.ok(!composer.includes('super-plan'));
    assert.equal(composer.length, all.length - 3);
  });
});
