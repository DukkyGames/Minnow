/**
 * grep server tool (POLISH-021 / MIN-103).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import {
  GREP_DEFAULT_HEAD_LIMIT,
  isRipgrepMatchLine,
  runGrepSearch,
  truncateRipgrepOutput,
} from '../../server/tools/grep.js';
import { pathAccessStore, resolveSafePath } from '../../server/runtime/path-access.js';
import { initWorkspaceRoot, setWorkspaceRoot } from '../../server/workspace/root.js';

const fixtureRoot = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '../fixtures/grep-workspace',
);

/** Mirror tools-middleware display paths for tests. */
function toRelativePath(absPath) {
  const rel = path.relative(fixtureRoot, absPath);
  return rel === '' ? '.' : rel.replace(/\\/g, '/');
}

function grepInFixture(args) {
  return pathAccessStore.run({ allowOutsideWorkspace: false }, () =>
    runGrepSearch(args, {
      resolveSafePath,
      toRelativePath,
      getWorkspaceRoot: () => fixtureRoot,
    }),
  );
}

describe('grep helpers', () => {
  it('isRipgrepMatchLine detects match vs context lines', () => {
    assert.equal(isRipgrepMatchLine('src/foo.ts:12:export const x'), true);
    assert.equal(isRipgrepMatchLine('src/foo.ts-11-context'), false);
    assert.equal(isRipgrepMatchLine('12:export const x'), true);
    assert.equal(isRipgrepMatchLine('--'), false);
  });

  it('truncateRipgrepOutput caps primary match lines', () => {
    const sample = ['1:alpha', '2-beta', '3:gamma', '4:delta'].join('\n');
    const { text, truncated, matchCount } = truncateRipgrepOutput(sample, 2);
    assert.equal(truncated, true);
    assert.equal(matchCount, 2);
    assert.match(text, /1:alpha/);
    assert.match(text, /2-beta/);
    assert.doesNotMatch(text, /4:delta/);
  });
});

describe('runGrepSearch fixture workspace', () => {
  before(async () => {
    await setWorkspaceRoot(fixtureRoot);
  });

  after(async () => {
    await initWorkspaceRoot();
  });

  it('finds matches under src/', async () => {
    const out = await grepInFixture({
      pattern: 'grep-fixture-visible',
      path: 'src',
    });
    assert.match(out, /visible\.ts/);
    assert.match(out, /grep-fixture-visible/);
  });

  it('respects .gitignore for ignored-dir', async () => {
    const out = await grepInFixture({
      pattern: 'grep-fixture-hidden',
      path: '.',
    });
    assert.match(out, /No matches/);
    assert.doesNotMatch(out, /hidden\.ts/);
  });

  it('returns no-match message when pattern is absent', async () => {
    const out = await grepInFixture({
      pattern: 'grep-fixture-absent-xyz',
      path: 'src',
    });
    assert.match(out, /No matches/);
  });

  it('rejects invalid regex', async () => {
    const out = await grepInFixture({ pattern: '[', path: 'src' });
    assert.match(out, /invalid regex/i);
  });

  it('supports literal search', async () => {
    const out = await grepInFixture({
      pattern: 'grep-fixture-visible',
      path: 'src/visible.ts',
      literal: true,
    });
    assert.match(out, /grep-fixture-visible/);
  });

  it('supports case_insensitive search', async () => {
    const out = await grepInFixture({
      pattern: 'GREP-FIXTURE-VISIBLE',
      path: 'src/visible.ts',
      case_insensitive: true,
    });
    assert.match(out, /grep-fixture-visible/i);
  });

  it('truncates when head_limit is exceeded', async () => {
    const out = await grepInFixture({
      pattern: 'export',
      path: 'src',
      head_limit: 1,
    });
    assert.match(out, /\(truncated at 1 matching lines\)/);
  });

  it('uses default head limit constant', () => {
    assert.equal(GREP_DEFAULT_HEAD_LIMIT, 200);
  });

  it('rejects paths outside workspace', async () => {
    await assert.rejects(
      () =>
        grepInFixture({
          pattern: 'test',
          path: '/etc',
        }),
      /outside the workspace/i,
    );
  });
});
