/**
 * Unit tests for session-scoped tool result cache.
 */

import assert from 'node:assert/strict';
import { describe, test, beforeEach } from 'node:test';
import {
  buildCacheKey,
  clearCacheScope,
  executeWithResultCache,
  getCachePolicyForTool,
  getCachedResult,
  invalidateAfterTool,
  isErrorToolResult,
  normalizeToolArgs,
  pathMatchesBustPrefix,
  bindWorkspacePathForToolCache,
  getCacheScope,
  resetResultCacheForTests,
  setCachedResult,
  setResultCacheNowForTests,
} from '../../src/tools/result-cache.ts';

beforeEach(() => {
  resetResultCacheForTests();
  bindWorkspacePathForToolCache(() => '/test-workspace');
});

function testScope(): string {
  return getCacheScope({});
}

describe('normalizeToolArgs / buildCacheKey', () => {
  test('same args with different key order produce the same cache key', () => {
    const a = normalizeToolArgs('read_file', { path: 'src/a.ts' });
    const b = normalizeToolArgs('read_file', { path: 'src/a.ts' });
    assert.equal(buildCacheKey('read_file', a), buildCacheKey('read_file', b));
  });

  test('path trim and ./ normalization produce the same key', () => {
    const a = normalizeToolArgs('read_file', { path: './src/a.ts' });
    const b = normalizeToolArgs('read_file', { path: 'src/a.ts' });
    assert.equal(buildCacheKey('read_file', a), buildCacheKey('read_file', b));
  });
});

describe('cache hit/miss', () => {
  test('cache hit invokes inner only once', async () => {
    let calls = 0;
    const inner = async () => {
      calls += 1;
      return { content: 'file-body' };
    };

    const args = { path: 'src/foo.ts' };
    const r1 = await executeWithResultCache('read_file', args, {}, inner);
    const r2 = await executeWithResultCache('read_file', args, {}, inner);

    assert.equal(calls, 1);
    assert.equal(r1.content, 'file-body');
    assert.equal(r2.content, 'file-body');
  });

  test('error results are not stored', async () => {
    let calls = 0;
    const inner = async () => {
      calls += 1;
      return { content: 'Error: not found' };
    };

    await executeWithResultCache('read_file', { path: 'missing.ts' }, {}, inner);
    await executeWithResultCache('read_file', { path: 'missing.ts' }, {}, inner);

    assert.equal(calls, 2);
    assert.equal(isErrorToolResult({ content: 'Error: not found' }), true);
  });

  test('non-cacheable tools always invoke inner', async () => {
    let calls = 0;
    const inner = async () => {
      calls += 1;
      return { content: 'ok' };
    };

    await executeWithResultCache('execute_command', { command: 'echo hi' }, {}, inner);
    await executeWithResultCache('execute_command', { command: 'echo hi' }, {}, inner);

    assert.equal(calls, 2);
    assert.equal(getCachePolicyForTool('execute_command').cacheable, false);
  });
});

describe('invalidation', () => {
  test('save_file busts read_file for the same path', async () => {
    const policy = getCachePolicyForTool('read_file');
    const normalized = normalizeToolArgs('read_file', { path: 'src/foo.ts' });
    const key = buildCacheKey('read_file', normalized);

    const scope = testScope();
    setCachedResult(scope, key, { content: 'stale' }, policy);
    assert.equal(getCachedResult(scope, key)?.content, 'stale');

    invalidateAfterTool(
      scope,
      'save_file',
      { path: 'src/foo.ts' },
      { content: 'saved' },
    );

    assert.equal(getCachedResult(scope, key), undefined);
  });

  test('move_file busts read_file for source and destination', () => {
    const policy = getCachePolicyForTool('read_file');
    const srcKey = buildCacheKey(
      'read_file',
      normalizeToolArgs('read_file', { path: 'old/a.ts' }),
    );
    const destKey = buildCacheKey(
      'read_file',
      normalizeToolArgs('read_file', { path: 'new/a.ts' }),
    );

    const scope = testScope();
    setCachedResult(scope, srcKey, { content: 'a' }, policy);
    setCachedResult(scope, destKey, { content: 'b' }, policy);

    invalidateAfterTool(
      scope,
      'move_file',
      { source: 'old/a.ts', destination: 'new/a.ts' },
      { content: 'moved' },
    );

    assert.equal(getCachedResult(scope, srcKey), undefined);
    assert.equal(getCachedResult(scope, destKey), undefined);
  });
});

describe('TTL and scope clear', () => {
  test('TTL expiry causes miss after ttlMs', () => {
    const policy = { cacheable: true, ttlMs: 100 };
    const key = buildCacheKey('get_lsp_diagnostics', normalizeToolArgs('get_lsp_diagnostics', { path: 'x.ts' }));

    setResultCacheNowForTests(1_000);
    const scope = testScope();
    setCachedResult(scope, key, { content: 'diag' }, policy);
    assert.equal(getCachedResult(scope, key)?.content, 'diag');

    setResultCacheNowForTests(1_150);
    assert.equal(getCachedResult(scope, key), undefined);
  });

  test('clearCacheScope removes all entries for scope', () => {
    const policy = getCachePolicyForTool('read_file');
    const key = buildCacheKey('read_file', normalizeToolArgs('read_file', { path: 'a.ts' }));
    const scope = testScope();
    setCachedResult(scope, key, { content: 'x' }, policy);
    clearCacheScope(scope);
    assert.equal(getCachedResult(scope, key), undefined);
  });
});

describe('pathMatchesBustPrefix', () => {
  test('directory prefix matches nested file paths', () => {
    assert.equal(pathMatchesBustPrefix('src/pkg/foo.ts', 'src/pkg'), true);
    assert.equal(pathMatchesBustPrefix('other/foo.ts', 'src/pkg'), false);
  });
});
