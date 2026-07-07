/**
 * git_diff smart truncation (MIN-345).
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_MAX_OUTPUT_CHARS } from '../../server/tools/output-cap.js';
import {
  splitDiffByFile,
  truncateGitDiff,
} from '../../server/tools/git-diff-truncate.js';
import { formatProcessOutput, runProcess } from '../../server/process-runner.js';
import { setWorkspaceRoot } from '../../server/workspace/root.js';

const execFileAsync = promisify(execFile);

function makePatch(filePath, lineCount) {
  const lines = Array.from({ length: lineCount }, (_, i) => `+line ${i + 1}`);
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    'index 0000000..1111111',
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lineCount} @@`,
    ...lines,
  ].join('\n');
}

describe('git-diff truncation helpers', () => {
  it('splitDiffByFile separates per-file sections', () => {
    const patch = `${makePatch('a.txt', 2)}\n${makePatch('b.txt', 2)}`;
    const sections = splitDiffByFile(patch);
    assert.equal(sections.length, 2);
    assert.equal(sections[0].path, 'a.txt');
    assert.equal(sections[1].path, 'b.txt');
  });

  it('truncateGitDiff passes through small patches', () => {
    const patch = makePatch('small.txt', 3);
    const numstat = '3\t0\tsmall.txt';
    const { text, truncated } = truncateGitDiff(patch, numstat, { maxChars: 10_000 });
    assert.equal(truncated, false);
    assert.equal(text, patch);
  });

  it('truncateGitDiff returns stat summary, included hunks, and omitted footer', () => {
    const fileA = makePatch('src/a.ts', 80);
    const fileB = makePatch('src/b.ts', 80);
    const patch = `${fileA}\n${fileB}`;
    const numstat = ['80\t0\tsrc/a.ts', '80\t0\tsrc/b.ts'].join('\n');
    const { text, truncated, includedFiles, omittedFiles } = truncateGitDiff(patch, numstat, {
      maxChars: 1_500,
    });
    assert.equal(truncated, true);
    assert.equal(includedFiles, 1);
    assert.equal(omittedFiles, 1);
    assert.match(text, /Git diff summary \(unstaged\): 2 file\(s\), \+160 -0/);
    assert.match(text, /src\/a\.ts: \+80 -0/);
    assert.match(text, /diff --git a\/src\/a\.ts b\/src\/a\.ts/);
    assert.match(text, /Truncated: omitted \d+ file\(s\)/);
    assert.match(text, /call git_diff with path=/);
  });
});

describe('git_diff integration', () => {
  let repoDir;

  before(async () => {
    repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-git-diff-cap-'));
    await setWorkspaceRoot(repoDir);
    await execFileAsync('git', ['init'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['config', 'user.email', 'test@example.com'], {
      cwd: repoDir,
      windowsHide: true,
    });
    await execFileAsync('git', ['config', 'user.name', 'Test'], {
      cwd: repoDir,
      windowsHide: true,
    });
    await fs.writeFile(path.join(repoDir, 'seed.txt'), 'seed\n', 'utf8');
    await execFileAsync('git', ['add', 'seed.txt'], { cwd: repoDir, windowsHide: true });
    await execFileAsync('git', ['commit', '-m', 'seed'], { cwd: repoDir, windowsHide: true });
  });

  after(async () => {
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it('per-file git diff returns full patch when scoped', async () => {
    const bigLines = Array.from({ length: 120 }, (_, i) => `big-${i}`).join('\n');
    await fs.writeFile(path.join(repoDir, 'seed.txt'), `${bigLines}\n`, 'utf8');

    const result = await runProcess('git', ['diff', '--', 'seed.txt'], { cwd: repoDir });
    const patch = String(result.stdout ?? '');
    assert.ok(patch.length > 1_000);

    const numstat = await runProcess('git', ['diff', '--numstat', '--', 'big.txt'], {
      cwd: repoDir,
    });
    const { text, truncated } = truncateGitDiff(patch, numstat.stdout ?? '', {
      maxChars: DEFAULT_MAX_OUTPUT_CHARS,
    });
    assert.equal(truncated, false);
    assert.match(text, /seed\.txt/);
  });

  it('repo-wide diff is truncated with metadata when changes are huge', async () => {
    for (let i = 0; i < 30; i += 1) {
      const name = `tracked-${i}.txt`;
      await fs.writeFile(path.join(repoDir, name), `base-${i}\n`, 'utf8');
      await execFileAsync('git', ['add', name], { cwd: repoDir, windowsHide: true });
    }
    await execFileAsync('git', ['commit', '-m', 'add tracked bulk'], {
      cwd: repoDir,
      windowsHide: true,
    });

    for (let i = 0; i < 30; i += 1) {
      const body = Array.from({ length: 200 }, (_, j) => `line-${i}-${j}-padding`).join('\n');
      await fs.writeFile(path.join(repoDir, `tracked-${i}.txt`), `${body}\n`, 'utf8');
    }

    const diffResult = await runProcess('git', ['diff'], { cwd: repoDir });
    const patch = String(diffResult.stdout ?? '');
    assert.ok(patch.length > DEFAULT_MAX_OUTPUT_CHARS);

    const numstatResult = await runProcess('git', ['diff', '--numstat'], { cwd: repoDir });
    const { text } = truncateGitDiff(patch, numstatResult.stdout ?? '', {
      maxChars: DEFAULT_MAX_OUTPUT_CHARS - 2_000,
      staged: false,
    });

    const formatted = formatProcessOutput('git diff', { ...diffResult, stdout: text });
    assert.match(formatted, /Git diff summary \(unstaged\)/);
    assert.match(formatted, /Truncated: omitted/);
    assert.ok(formatted.length < patch.length);
  });
});
