/**
 * Child-process IPC framing + reindex result summarisation.
 *
 * Regression cover for the pair of bugs that made every full reindex report failure:
 * the host parsed worker stdout per chunk (so the multi-chunk `done` frame was dropped),
 * and per-file errors never reached the caller.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createNdjsonFramer } from '../../../server/brain/code/index-host.js';
import { summarizeIndexResults } from '../../../server/brain/code/indexer.js';

/** Split a string into fixed-size pieces, mimicking pipe chunking. */
function chunked(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

describe('createNdjsonFramer', () => {
  it('reassembles a JSON frame split across many chunks', () => {
    const results = Array.from({ length: 2465 }, (_, i) => ({
      file: `src/some/path/to/file-${i}.ts`,
      symbols: 123,
      edges: 45,
    }));
    const payload = JSON.stringify({ type: 'done', result: { repo: 'minnow', results } });
    assert.ok(payload.length > 64 * 1024, 'payload should exceed a single pipe chunk');

    const lines = [];
    const framer = createNdjsonFramer((line) => lines.push(line));
    for (const chunk of chunked(`${payload}\n`, 8192)) framer.push(chunk);
    framer.flush();

    assert.equal(lines.length, 1);
    assert.equal(JSON.parse(lines[0]).result.results.length, 2465);
  });

  it('keeps interleaved progress frames intact across chunk boundaries', () => {
    const frames = Array.from({ length: 200 }, (_, i) =>
      JSON.stringify({ type: 'progress', repo: 'minnow', filesDone: i, filesTotal: 200 }),
    );
    const stream = `${frames.join('\n')}\n`;

    const seen = [];
    const framer = createNdjsonFramer((line) => seen.push(JSON.parse(line)));
    // Deliberately awkward chunk size so boundaries land mid-frame.
    for (const chunk of chunked(stream, 37)) framer.push(chunk);
    framer.flush();

    assert.equal(seen.length, 200);
    assert.equal(seen[0].filesDone, 0);
    assert.equal(seen[199].filesDone, 199);
  });

  it('delivers a final line with no trailing newline', () => {
    const seen = [];
    const framer = createNdjsonFramer((line) => seen.push(line));
    framer.push('{"type":"done"}');
    assert.equal(seen.length, 0, 'unterminated line waits for more input');
    framer.flush();
    assert.deepEqual(seen, ['{"type":"done"}']);
  });

  it('handles CRLF and ignores blank lines', () => {
    const seen = [];
    const framer = createNdjsonFramer((line) => seen.push(line));
    framer.push('{"a":1}\r\n\r\n{"b":2}\r\n');
    framer.flush();
    assert.deepEqual(seen, ['{"a":1}', '{"b":2}']);
  });
});

describe('summarizeIndexResults', () => {
  it('counts indexed files, symbols, and edges', () => {
    const summary = summarizeIndexResults([
      { file: 'a.ts', symbols: 10, edges: 2 },
      { file: 'b.ts', symbols: 5, edges: 1 },
    ]);
    assert.equal(summary.indexedFiles, 2);
    assert.equal(summary.filesProcessed, 2);
    assert.equal(summary.failedFiles, 0);
    assert.equal(summary.symbolsIndexed, 15);
    assert.equal(summary.edgesIndexed, 3);
    assert.deepEqual(summary.errorSummary, []);
  });

  it('reports failures instead of silently returning zero', () => {
    const summary = summarizeIndexResults([
      { file: 'a.rb', symbols: 0, edges: 0, error: 'No LSP server configured for a.rb' },
      { file: 'b.rb', symbols: 0, edges: 0, error: 'No LSP server configured for b.rb' },
      { file: 'c.ts', symbols: 4, edges: 0 },
    ]);

    assert.equal(summary.indexedFiles, 1);
    assert.equal(summary.failedFiles, 2);
    assert.equal(summary.errors.length, 2);
    assert.equal(summary.errors[0].file, 'a.rb');

    // Both failures share a message shape, so they collapse into one reportable group.
    assert.equal(summary.errorSummary.length, 1);
    assert.equal(summary.errorSummary[0].count, 2);
    assert.match(summary.errorSummary[0].message, /No LSP server configured/);
  });

  it('caps the per-file error list', () => {
    const results = Array.from({ length: 500 }, (_, i) => ({
      file: `f${i}.rb`,
      symbols: 0,
      edges: 0,
      error: `No LSP server configured for f${i}.rb`,
    }));
    const summary = summarizeIndexResults(results);
    assert.equal(summary.failedFiles, 500);
    assert.equal(summary.errors.length, 50);
    assert.equal(summary.errorSummary[0].count, 500);
  });
});
