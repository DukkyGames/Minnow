/**
 * Paste classification.
 *
 * Classification has to be synchronous — `preventDefault` cannot wait on an
 * upload — so it is a pure function over the clipboard and tested as one.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  classifyPaste,
  extractTracePaths,
} from '../../src/ui/issue-editor-paste.ts';

/** Minimal DataTransfer stand-in; happy-dom does not ship a usable one. */
function clipboard(text: string, files: Array<{ type: string; name?: string }> = []): DataTransfer {
  return {
    getData: (type: string) => (type === 'text/plain' ? text : ''),
    items: files.map((file) => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => ({ type: file.type, name: file.name ?? 'x', size: 10 }),
    })),
    types: ['text/plain'],
  } as unknown as DataTransfer;
}

const TRACE = [
  'TypeError: cannot read x',
  '    at boom (src/ui/foo.ts:12:9)',
  '    at run (src/state/bar.ts:44:3)',
  '    at node:internal/main:1:1',
  '    at dep (node_modules/left-pad/index.js:2:2)',
].join('\n');

describe('classifyPaste', () => {
  test('an empty clipboard passes through', () => {
    assert.equal(classifyPaste(clipboard('')).kind, 'passthrough');
    assert.equal(classifyPaste(null).kind, 'passthrough');
  });

  test('a GitHub issue URL becomes a labelled link', () => {
    const plan = classifyPaste(clipboard('https://github.com/owner/repo/issues/412'));
    assert.equal(plan.kind, 'github');
    assert.equal(plan.kind === 'github' && plan.label, 'owner/repo#412');
  });

  test('a GitHub PR URL says so in its label', () => {
    const plan = classifyPaste(clipboard('https://github.com/o/r/pull/9'));
    assert.equal(plan.kind === 'github' && plan.label, 'o/r#9 (PR)');
  });

  test('a non-GitHub URL passes through', () => {
    assert.equal(classifyPaste(clipboard('https://example.com/issues/1')).kind, 'passthrough');
  });

  test('path:line becomes a code mention', () => {
    const plan = classifyPaste(clipboard('src/ui/foo.ts:12-34'));
    assert.equal(plan.kind, 'code-ref');
    assert.equal(plan.kind === 'code-ref' && plan.text, '@src/ui/foo.ts:12-34');
  });

  test('a bare path with no line number is left alone', () => {
    // Without a line it is more likely prose than a reference.
    assert.equal(classifyPaste(clipboard('src/ui/foo.ts')).kind, 'passthrough');
  });

  test('an image file wins over any text on the clipboard', () => {
    const plan = classifyPaste(clipboard('ignored', [{ type: 'image/png', name: 'shot.png' }]));
    assert.equal(plan.kind, 'image');
  });

  test('a non-image file is not treated as an image', () => {
    assert.equal(
      classifyPaste(clipboard('', [{ type: 'application/zip' }])).kind,
      'passthrough',
    );
  });

  test('a stack trace is recognized and its useful frames extracted', () => {
    const plan = classifyPaste(clipboard(TRACE));
    assert.equal(plan.kind, 'stack-trace');
    assert.deepEqual(plan.kind === 'stack-trace' && plan.paths, [
      'src/ui/foo.ts:12',
      'src/state/bar.ts:44',
    ]);
  });

  test('one path on one line is not a stack trace', () => {
    assert.equal(classifyPaste(clipboard('see src/a.ts:1 for details')).kind, 'passthrough');
  });
});

describe('extractTracePaths', () => {
  test('drops node internals and dependencies', () => {
    const paths = extractTracePaths(TRACE);
    assert.ok(!paths.some((p) => p.startsWith('node:')));
    assert.ok(!paths.some((p) => p.includes('node_modules')));
  });

  test('normalizes windows separators', () => {
    const paths = extractTracePaths('    at x (src\\ui\\foo.ts:3:1)\n    at y (src\\a.ts:1:1)');
    assert.deepEqual(paths, ['src/ui/foo.ts:3', 'src/a.ts:1']);
  });

  test('orders by how often a frame appears', () => {
    const paths = extractTracePaths(
      ['at a (src/hot.ts:1:1)', 'at b (src/cold.ts:2:1)', 'at c (src/hot.ts:1:1)'].join('\n'),
    );
    assert.equal(paths[0], 'src/hot.ts:1');
  });

  test('finds nothing in ordinary prose', () => {
    assert.deepEqual(extractTracePaths('just some words, version 1.2 of the thing'), []);
  });
});
