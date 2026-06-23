/**
 * Indexer symbol extraction — stable ids and signatures (MIN-B7).
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { DEFAULT_BRAIN_CODE_CONFIG } from '../../../server/brain/code/config.js';
import {
  buildSymbolId,
  elideSignature,
  flattenDocumentSymbols,
  hashSymbolSpan,
  listIndexableFiles,
  symbolKindName,
} from '../../../server/brain/code/indexer.js';

describe('code indexer helpers', () => {
  it('buildSymbolId uses repo:qualified.name without line numbers', () => {
    assert.equal(buildSymbolId('minnow', 'retrieveMemoryBlock'), 'minnow:retrieveMemoryBlock');
    assert.equal(buildSymbolId('minnow', 'Outer.Inner'), 'minnow:Outer.Inner');
  });

  it('flattenDocumentSymbols produces hierarchical ids and content hashes', () => {
    const lines = [
      'export const MY_EXPORT = 42;',
      'function callee() { return 1; }',
      'function caller() { callee(); }',
    ];
    const tree = [
      {
        name: 'MY_EXPORT',
        kind: 14,
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 24 } },
        selectionRange: { start: { line: 0, character: 13 }, end: { line: 0, character: 22 } },
        children: [
          {
            name: 'callee',
            kind: 12,
            range: { start: { line: 1, character: 0 }, end: { line: 1, character: 20 } },
            selectionRange: { start: { line: 1, character: 9 }, end: { line: 1, character: 15 } },
          },
        ],
      },
      {
        name: 'caller',
        kind: 12,
        range: { start: { line: 2, character: 0 }, end: { line: 2, character: 28 } },
        selectionRange: { start: { line: 2, character: 9 }, end: { line: 2, character: 15 } },
      },
    ];

    const flat = flattenDocumentSymbols(tree, 'fixture', 'sample.fake', lines);
    assert.equal(flat.length, 3);
    assert.equal(flat[0].id, 'fixture:MY_EXPORT');
    assert.equal(flat[1].id, 'fixture:MY_EXPORT.callee');
    assert.equal(flat[2].id, 'fixture:caller');
    assert.equal(symbolKindName(flat[0].kind), 'constant');
    assert.match(flat[0].signature, /constant MY_EXPORT/);
    assert.equal(flat[0].content_hash, hashSymbolSpan(lines, tree[0].range));
    assert.equal(flat[0].line_start, 1);
  });

  it('elideSignature truncates very long signatures', () => {
    const long = 'x'.repeat(200);
    const sig = elideSignature('foo', 'function', long);
    assert.ok(sig.length <= 120);
    assert.match(sig, /…$/);
  });
});

describe('listIndexableFiles', () => {
  /** @type {string} */
  let tempRoot;

  before(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'minnow-brain-indexer-'));
  });

  after(async () => {
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it('returns empty array when no files match include globs (ripgrep exit 1)', async () => {
    const root = path.join(tempRoot, 'markdown-only');
    await fs.mkdir(path.join(root, 'documentation', 'plans'), { recursive: true });
    await fs.writeFile(
      path.join(root, 'documentation', 'plans', 'notes.md'),
      '# Notes\n',
      'utf8',
    );

    const files = await listIndexableFiles(
      root,
      DEFAULT_BRAIN_CODE_CONFIG.includeGlobs,
      DEFAULT_BRAIN_CODE_CONFIG.excludeGlobs,
    );
    assert.deepEqual(files, []);
  });
});
