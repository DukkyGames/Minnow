/**
 * What a task changed, read from git at its merge commit.
 *
 * The tests that matter here are the two that would silently produce a wrong
 * answer rather than an error: a **merge commit** (which `git show` prints as an
 * empty diff unless asked for a parent) and a patch parse that drops or
 * mislabels lines. Both would render as "this task changed nothing", which is
 * indistinguishable from the truth on a screen.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

import { runProcess } from '../../server/process-runner.js';
import {
  patchToDiffLines,
  readCommitFileDiff,
  readCommitFileStats,
  safeRepoPath,
  safeSha,
} from '../../server/orchestrator/task-files.js';

describe('argument guards', () => {
  it('takes a sha and nothing that could be a flag', () => {
    assert.equal(safeSha('076d47903592'), '076d47903592');
    assert.equal(safeSha('  abc1234  '), 'abc1234');
    assert.equal(safeSha('--upload-pack=evil'), null);
    assert.equal(safeSha('HEAD'), null, 'a ref is not a sha');
    assert.equal(safeSha('abc'), null, 'too short to be one');
    assert.equal(safeSha(''), null);
  });

  it('takes a repo-relative path and nothing that escapes the repo', () => {
    assert.equal(safeRepoPath('src/a.ts'), 'src/a.ts');
    assert.equal(safeRepoPath('../etc/passwd'), null);
    assert.equal(safeRepoPath('src/../../x'), null);
    assert.equal(safeRepoPath('/etc/passwd'), null);
    assert.equal(safeRepoPath('C:\\Windows\\system32'), null);
    assert.equal(safeRepoPath('--output=x'), null);
  });
});

describe('patchToDiffLines', () => {
  it('keeps hunk headers, because three distant hunks are not one block', () => {
    const { lines } = patchToDiffLines(
      [
        'diff --git a/a.ts b/a.ts',
        'index 111..222 100644',
        '--- a/a.ts',
        '+++ b/a.ts',
        '@@ -1,2 +1,2 @@',
        ' const a = 1;',
        '-const b = 2;',
        '+const b = 3;',
        '@@ -20,1 +20,1 @@',
        '-const z = 9;',
        '+const z = 10;',
      ].join('\n'),
    );
    assert.deepEqual(
      lines.map((l) => l.type),
      ['unchanged', 'unchanged', 'remove', 'add', 'unchanged', 'remove', 'add'],
    );
    // The preamble is dropped: `+++ b/a.ts` is not an added line of code.
    assert.equal(
      lines.some((l) => l.text.includes('+++')),
      false,
    );
    assert.equal(lines[1].text, 'const a = 1;', 'the leading space is the marker, not content');
    assert.equal(lines[3].text, 'const b = 3;');
  });

  it('drops the no-newline marker rather than showing it as a line', () => {
    const { lines } = patchToDiffLines(['@@ -1 +1 @@', '-a', '\\ No newline at end of file', '+b'].join('\n'));
    assert.deepEqual(
      lines.map((l) => l.text),
      ['@@ -1 +1 @@', 'a', 'b'],
    );
  });

  it('is empty for a patch git never produced', () => {
    assert.deepEqual(patchToDiffLines('').lines, []);
    assert.deepEqual(patchToDiffLines('diff --git a/a b/a\nindex 1..2\n').lines, []);
  });
});

describe('reading a real repository', () => {
  /** @type {string} */
  let repo;
  /** @type {string} */
  let squashSha;
  /** @type {string} */
  let mergeSha;
  let available = true;

  before(async () => {
    repo = await fs.mkdtemp(path.join(os.tmpdir(), 'mn-task-files-'));
    const git = async (...args) => {
      const result = await runProcess('git', args, { cwd: repo, timeout: 30_000 });
      if (result.code !== 0) throw new Error(`git ${args.join(' ')}: ${result.stderr}`);
      return String(result.stdout ?? '');
    };
    try {
      await git('init', '-b', 'main');
      await git('config', 'user.email', 'test@example.com');
      await git('config', 'user.name', 'Test');
      await git('config', 'commit.gpgsign', 'false');

      await fs.writeFile(path.join(repo, 'base.txt'), 'one\n', 'utf8');
      await git('add', '.');
      await git('commit', '-m', 'base');

      // A plain (single-parent) commit: the squash-merge shape.
      await fs.writeFile(path.join(repo, 'a.txt'), 'alpha\nbeta\n', 'utf8');
      await git('add', '.');
      await git('commit', '-m', 'squashed task');
      squashSha = (await git('rev-parse', 'HEAD')).trim();

      // A real merge commit: the merge-queue shape, and the case `git show`
      // prints as empty without `-m --first-parent`.
      await git('checkout', '-b', 'task');
      await fs.writeFile(path.join(repo, 'b.txt'), 'x\ny\nz\n', 'utf8');
      await git('add', '.');
      await git('commit', '-m', 'task work');
      await git('checkout', 'main');
      await git('merge', '--no-ff', '-m', 'merge task', 'task');
      mergeSha = (await git('rev-parse', 'HEAD')).trim();
    } catch (err) {
      // A machine with no usable git is not a failing assertion about this code.
      available = false;
      console.warn(`[task-files] skipping repo tests: ${err.message}`);
    }
  });

  after(async () => {
    if (repo) await fs.rm(repo, { recursive: true, force: true });
  });

  it('counts the lines a single-parent commit added', async (t) => {
    if (!available) return t.skip('git unavailable');
    const stats = await readCommitFileStats(squashSha, repo);
    assert.ok(stats);
    assert.deepEqual(
      stats.files.map((f) => [f.path, f.additions, f.deletions]),
      [['a.txt', 2, 0]],
    );
    assert.equal(stats.additions, 2);
    assert.equal(stats.deletions, 0);
  });

  it('counts a merge commit, which git shows as empty unless asked', async (t) => {
    if (!available) return t.skip('git unavailable');
    // This is the whole reason `showArgs` passes `-m --first-parent`. Without
    // them a merged task renders as having changed no files at all.
    const stats = await readCommitFileStats(mergeSha, repo);
    assert.ok(stats, 'a merge commit must not read as an empty diffstat');
    assert.deepEqual(
      stats.files.map((f) => f.path),
      ['b.txt'],
    );
    assert.equal(stats.additions, 3);
  });

  it('returns one file diff, as rows the unified renderer draws', async (t) => {
    if (!available) return t.skip('git unavailable');
    const diff = await readCommitFileDiff(mergeSha, 'b.txt', repo);
    assert.ok(diff);
    assert.equal(diff.path, 'b.txt');
    assert.deepEqual(
      diff.lines.filter((l) => l.type === 'add').map((l) => l.text),
      ['x', 'y', 'z'],
    );
  });

  it('answers with nothing rather than throwing when git cannot help', async (t) => {
    if (!available) return t.skip('git unavailable');
    // A pruned worktree, a moved repo, or a sha from another clone: the panel
    // falls back to the declared footprint, and the board still opens.
    assert.equal(await readCommitFileStats('0123456789abcdef0123', repo), null);
    assert.equal(await readCommitFileDiff(mergeSha, 'nope.txt', repo), null);
    assert.equal(await readCommitFileStats('not-a-sha', repo), null);
  });
});
