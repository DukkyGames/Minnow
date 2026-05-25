/**
 * Client merge: catalog vs probe precedence.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  catalogCapabilitiesFromRow,
  mergeModelCapabilities,
  prioritizeModelIdsForProbe,
} from '../../src/providers/model-capabilities.ts';
import { modelCache } from '../../src/app-state.ts';

describe('mergeModelCapabilities', () => {
  test('catalog vision wins for vlm over probe false', () => {
    const row = { id: 'x', type: 'vlm', max_context_length: 32768 };
    const merged = mergeModelCapabilities(row, {
      vision: false,
      tools: true,
      streaming: true,
      grammar: null,
      reasoning: null,
      contextLength: null,
      loadState: null,
      sources: { vision: 'catalog', tools: 'probe' },
      probeErrors: {},
    });
    assert.equal(merged.vision, true);
    assert.equal(merged.tools, true);
    assert.equal(merged.contextLength, 32768);
  });

  test('probe fills tools when catalog unknown', () => {
    const row = { id: 'y', type: 'llm' };
    const merged = mergeModelCapabilities(row, {
      vision: false,
      tools: true,
      streaming: true,
      grammar: null,
      reasoning: null,
      contextLength: null,
      loadState: 'loaded',
      sources: { tools: 'probe', streaming: 'probe' },
      probeErrors: {},
    });
    assert.equal(merged.tools, true);
    assert.equal(merged.streaming, true);
  });
});

describe('catalogCapabilitiesFromRow', () => {
  test('marks vlm as vision', () => {
    const caps = catalogCapabilitiesFromRow({ id: 'v', type: 'vlm' });
    assert.equal(caps.vision, true);
  });
});

describe('prioritizeModelIdsForProbe', () => {
  test('respects loaded cache state', () => {
    modelCache.clear();
    modelCache.set('loaded-one', { id: 'loaded-one', state: 'loaded' });
    modelCache.set('other', { id: 'other', state: 'not loaded' });
    const out = prioritizeModelIdsForProbe(
      ['other', 'loaded-one', 'zzz'],
      'zzz',
    );
    assert.equal(out[0], 'zzz');
    assert.equal(out[1], 'loaded-one');
  });
});
