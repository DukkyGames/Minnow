/**
 * grep server tool (POLISH-021 / MIN-103, MIN-196).
 */
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, describe, it } from 'node:test';
import {
  GREP_DEFAULT_HEAD_LIMIT,
  GREP_MAX_HEAD_LIMIT,
  GREP_MAX_LINE_CHARS,
  GREP_MAX_OUTPUT_CHARS,
  capGrepOutput,
  formatGroupedGrepOutput,
  isRipgrepMatchLine,
  runFindFilesSearch,
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

function findFilesInFixture(args, options) {
  return pathAccessStore.run({ allowOutsideWorkspace: false }, () =>
    runFindFilesSearch(
      args,
      {
        resolveSafePath,
        toRelativePath,
        getWorkspaceRoot: () => fixtureRoot,
      },
      options,
    ),
  );
}

describe('grep helpers', () => {
  it('isRipgrepMatchLine detects match vs context lines', () => {
    assert.equal(isRipgrepMatchLine('src/foo.ts:12:export const x'), true);
    assert.equal(isRipgrepMatchLine('src/foo.ts-11-context'), false);
    assert.equal(isRipgrepMatchLine('12:export const x'), true);
    assert.equal(isRipgrepMatchLine('--'), false);
  });

  it('capGrepOutput caps all emitted lines including context', () => {
    const sample = ['1:alpha', '2-beta', '3:gamma', '4:delta'].join('\n');
    const { text, truncated, lineCount } = capGrepOutput(sample, { headLimit: 2 });
    assert.equal(truncated, true);
    assert.equal(lineCount, 2);
    assert.match(text, /1:alpha/);
    assert.match(text, /2-beta/);
    assert.doesNotMatch(text, /3:gamma/);
    assert.match(text, /truncated at 2 match lines/);
  });

  it('capGrepOutput supports offset pagination', () => {
    const sample = ['line-a', 'line-b', 'line-c', 'line-d'].join('\n');
    const { text, lineCount, nextOffset } = capGrepOutput(sample, {
      offset: 2,
      headLimit: 2,
    });
    assert.equal(lineCount, 2);
    assert.equal(nextOffset, 4);
    assert.match(text, /line-c/);
    assert.match(text, /line-d/);
    assert.doesNotMatch(text, /line-a/);
  });

  it('capGrepOutput caps per-line length', () => {
    const longLine = 'x'.repeat(500);
    const { text } = capGrepOutput(longLine, { headLimit: 1 });
    const emitted = text.split('\n')[0];
    assert.ok(emitted.length <= GREP_MAX_LINE_CHARS);
    assert.match(emitted, /\.\.\.$/);
  });

  it('capGrepOutput enforces total output char budget', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `match-${i}:${'a'.repeat(400)}`);
    const { text, truncated } = capGrepOutput(lines.join('\n'), {
      headLimit: 100,
      maxOutputChars: 2000,
    });
    assert.equal(truncated, true);
    assert.ok(text.length <= GREP_MAX_OUTPUT_CHARS + 200);
  });

  it('truncateRipgrepOutput delegates to capGrepOutput', () => {
    const sample = ['1:alpha', '2-beta', '3:gamma'].join('\n');
    const { text, truncated, lineCount } = truncateRipgrepOutput(sample, 1);
    assert.equal(truncated, true);
    assert.equal(lineCount, 1);
    assert.match(text, /1:alpha/);
    assert.doesNotMatch(text, /2-beta/);
  });

  it('formatGroupedGrepOutput groups path:line rows per file', () => {
    const sample = [
      'src/foo.ts:42: const x = 1',
      'src/foo.ts:47: const y = 2',
      'src/bar.ts:10: export default',
    ].join('\n');
    const grouped = formatGroupedGrepOutput(sample);
    assert.match(grouped, /^src\/foo\.ts\n {2}42:/m);
    assert.match(grouped, / {2}47:/);
    assert.match(grouped, /^src\/bar\.ts\n {2}10:/m);
  });
});

describe('grep constants (MIN-196)', () => {
  it('uses conservative default and max head limits', () => {
    assert.equal(GREP_DEFAULT_HEAD_LIMIT, 200);
    assert.equal(GREP_MAX_HEAD_LIMIT, 200);
    assert.equal(GREP_MAX_OUTPUT_CHARS, 32000);
    assert.equal(GREP_MAX_LINE_CHARS, 400);
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
    assert.match(out, /truncated at 1 match lines/);
  });

  it('supports output_mode files_with_matches', async () => {
    const out = await grepInFixture({
      pattern: 'grep-fixture',
      path: 'src',
      output_mode: 'files_with_matches',
    });
    assert.match(out, /visible\.ts/);
    assert.doesNotMatch(out, /grep-fixture-visible/);
  });

  it('supports output_mode count', async () => {
    const out = await grepInFixture({
      pattern: 'export',
      path: 'src',
      output_mode: 'count',
    });
    assert.match(out, /:\d+$/m);
    assert.doesNotMatch(out, /export const/);
  });

  it('supports output_mode grouped', async () => {
    const out = await grepInFixture({
      pattern: 'grep-fixture',
      path: 'src',
      output_mode: 'grouped',
    });
    assert.match(out, /visible\.ts/m);
    assert.match(out, / {2}\d+: /);
    assert.doesNotMatch(out, /:\d+:.*:\d+:/);
  });

  it('supports offset pagination', async () => {
    const full = await grepInFixture({
      pattern: 'export',
      path: 'src',
      head_limit: 10,
    });
    const lines = full.split('\n').filter((l) => l && !l.startsWith('(truncated'));
    if (lines.length < 2) return;

    const page = await grepInFixture({
      pattern: 'export',
      path: 'src',
      head_limit: 1,
      offset: 1,
    });
    const pageLines = page.split('\n').filter((l) => l && !l.startsWith('(truncated'));
    assert.equal(pageLines.length, 1);
    assert.notEqual(pageLines[0], lines[0]);
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

describe('runFindFilesSearch fixture workspace', () => {
  before(async () => {
    await setWorkspaceRoot(fixtureRoot);
  });

  after(async () => {
    await initWorkspaceRoot();
  });

  it('finds .ts files with forward-slash relative paths', async () => {
    const out = await findFilesInFixture({ pattern: '**/*.ts' });
    assert.match(out, /^src\/visible\.ts$/m);
    assert.match(out, /^src\/nested\/deep\.ts$/m);
    assert.doesNotMatch(out, /\\/); // no Windows backslashes
    assert.doesNotMatch(out, /^\.\//m); // no ./ prefix
  });

  it('matches a bare basename glob in any directory', async () => {
    const out = await findFilesInFixture({ pattern: '*.ts' });
    assert.match(out, /visible\.ts/);
    assert.match(out, /nested\/deep\.ts/);
  });

  it('respects .gitignore (excludes ignored-dir)', async () => {
    const out = await findFilesInFixture({ pattern: '**/*.ts' });
    assert.doesNotMatch(out, /hidden\.ts/);
  });

  it('returns a no-match message for an absent pattern', async () => {
    const out = await findFilesInFixture({ pattern: '**/*.rs' });
    assert.match(out, /No files matching/);
  });

  it('scopes results to a subdirectory', async () => {
    const out = await findFilesInFixture({ pattern: '**/*.ts', path: 'src/nested' });
    assert.match(out, /deep\.ts/);
    assert.doesNotMatch(out, /visible\.ts/);
  });
});
