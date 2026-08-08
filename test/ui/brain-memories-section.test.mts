/**
 * Brain Memories section registration and routing helpers.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { describe, test } from 'node:test';
import { resolveBrainMemoryRoute } from '../../src/ui/brain-memory-routing.ts';

const html = fs.readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

describe('brain memories section', () => {
  test('memories rail and panel exist in index.html', () => {
    assert.match(html, /data-brain-nav="memories"/);
    assert.match(html, /id="brainSection-memories"/);
    assert.match(html, /id="brainMemoryEnabled"/);
    assert.match(html, /id="brainMemoryAddOpen"/);
    assert.match(html, /brain-section--memories/);
  });

  test('resolveBrainMemoryRoute maps store keys to memories', () => {
    assert.equal(resolveBrainMemoryRoute('knowledge.memory.enabled'), 'memories');
    assert.equal(resolveBrainMemoryRoute('knowledge.memory.injection'), 'memories');
    assert.equal(resolveBrainMemoryRoute(undefined, 'memory'), 'memories');
  });

  test('resolveBrainMemoryRoute maps embeddings and synthesis to settings', () => {
    assert.equal(resolveBrainMemoryRoute('knowledge.memory.embeddings'), 'settings');
    assert.equal(resolveBrainMemoryRoute('knowledge.memory.synthesis'), 'settings');
  });

  test('resolveBrainMemoryRoute ignores unrelated keys', () => {
    assert.equal(resolveBrainMemoryRoute('agents.rules.enabled'), null);
  });
});
