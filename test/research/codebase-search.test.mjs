/**
 * Workspace codebase search for Deep Research (MIN-235).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, it, after } from 'node:test';

import {
  CODEBASE_SEARCH_DEFAULT_LIMIT,
  codebaseSearchDeps,
  parseCodebaseRipgrepLine,
  searchCodebaseStructured,
} from '../../server/research/search.js';

/** @type {string | undefined} */
let fixtureDir;

after(async () => {
  if (fixtureDir) {
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }
});

describe('parseCodebaseRipgrepLine', () => {
  it('parses path:line:content into workspace-relative fields', () => {
    const root = path.resolve(process.cwd());
    const parsed = parseCodebaseRipgrepLine('src/foo.ts:12:export const bar = 1;', root);
    assert.ok(parsed);
    assert.equal(parsed.relPath, 'src/foo.ts');
    assert.equal(parsed.lineNum, 12);
    assert.match(parsed.snippet, /export const bar/);
  });

  it('rejects paths outside the workspace root', () => {
    const root = path.resolve('/workspace');
    const parsed = parseCodebaseRipgrepLine('/etc/passwd:1:root', root);
    assert.equal(parsed, null);
  });
});

describe('searchCodebaseStructured', () => {
  it('returns structured file hits from a temp workspace fixture', async () => {
    fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-codebase-search-'));
    const srcDir = path.join(fixtureDir, 'src');
    await fs.mkdir(srcDir, { recursive: true });
    await fs.writeFile(
      path.join(srcDir, 'widget.ts'),
      'export function renderWidget() {\n  return "unique-minnow-widget-token";\n}\n',
      'utf8',
    );
    await fs.writeFile(
      path.join(srcDir, 'notes.md'),
      '# Notes\n\nNothing relevant here.\n',
      'utf8',
    );

    const results = await searchCodebaseStructured('unique-minnow-widget-token', fixtureDir, {
      limit: 5,
    });

    assert.ok(results.length >= 1);
    const hit = results.find((row) => row.url.includes('widget.ts'));
    assert.ok(hit, JSON.stringify(results));
    assert.match(hit.url, /^file:\/\/src\/widget\.ts#L\d+$/);
    assert.match(hit.title, /widget\.ts:\d+/);
    assert.match(hit.snippet, /unique-minnow-widget-token/);
    assert.ok(results.length <= CODEBASE_SEARCH_DEFAULT_LIMIT);
  });

  it('honors injectable ripgrep deps for deterministic unit tests', async () => {
    const originalExec = codebaseSearchDeps.execFile;
    codebaseSearchDeps.execFile = (cmd, args, opts, cb) => {
      const stdout = 'src/mock.ts:7:const NEEDLE = true;\n';
      if (typeof cb === 'function') {
        cb(null, { stdout, stderr: '' });
        return;
      }
      return Promise.resolve({ stdout, stderr: '' });
    };

    try {
      const results = await searchCodebaseStructured('NEEDLE', '/tmp/workspace', { limit: 3 });
      assert.equal(results.length, 1);
      assert.equal(results[0].url, 'file://src/mock.ts#L7');
      assert.equal(results[0].title, 'mock.ts:7');
      assert.match(results[0].snippet, /NEEDLE/);
    } finally {
      codebaseSearchDeps.execFile = originalExec;
    }
  });

  it('returns an empty array for blank queries', async () => {
    const results = await searchCodebaseStructured('   ', fixtureDir ?? os.tmpdir());
    assert.deepEqual(results, []);
  });
});
