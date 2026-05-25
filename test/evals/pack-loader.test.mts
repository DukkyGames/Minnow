/**
 * Eval pack list merge tests.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mergeEvalPackLists, resolveEvalPack } from '../../src/evals/pack-loader.ts';
import type { EvalPack, EvalPackListItem } from '../../src/evals/types.ts';

const builtinItem: EvalPackListItem = {
  id: 'coding-smoke',
  label: 'Coding smoke',
  version: 1,
  taskCount: 2,
  source: 'builtin',
};

const userItem: EvalPackListItem = {
  id: 'coding-smoke',
  label: 'Custom smoke',
  version: 2,
  taskCount: 3,
  source: 'user',
};

describe('mergeEvalPackLists', () => {
  it('user overrides builtin id', () => {
    const merged = mergeEvalPackLists([builtinItem], [userItem]);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].source, 'user');
    assert.equal(merged[0].label, 'Custom smoke');
  });
});

describe('resolveEvalPack', () => {
  const builtinPack: EvalPack = {
    id: 'coding-smoke',
    label: 'Builtin',
    version: 1,
    tasks: [],
    source: 'builtin',
  };
  const userPack: EvalPack = {
    id: 'coding-smoke',
    label: 'User',
    version: 2,
    tasks: [],
    source: 'user',
  };

  it('prefers user pack', () => {
    const resolved = resolveEvalPack('coding-smoke', [builtinPack], [userPack]);
    assert.equal(resolved?.label, 'User');
  });
});
