/**
 * Search enrichment — ranked page excerpts appended to a result listing.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  appendResultExcerpts,
  formatResultExcerpts,
} from '../../server/tools/search-enrich.js';

const RESULT = {
  title: 'chokidar - npm',
  url: 'https://www.npmjs.com/package/chokidar',
  snippet: 'Neat wrapper around fs.watch',
};

describe('formatResultExcerpts', () => {
  it('renders title, url, and ranked passages', () => {
    const text = formatResultExcerpts('chokidar watch options', [
      { result: RESULT, excerpts: ['awaitWriteFinish stabilises writes.', 'usePolling falls back to stat polling.'] },
    ]);

    assert.match(text, /Page excerpts for "chokidar watch options"/);
    assert.match(text, /\[1\] chokidar - npm/);
    assert.match(text, /https:\/\/www\.npmjs\.com\/package\/chokidar/);
    assert.match(text, /- awaitWriteFinish stabilises writes\./);
    assert.match(text, /- usePolling falls back to stat polling\./);
  });

  it('reports an unreadable page inline instead of dropping it', () => {
    const text = formatResultExcerpts('chokidar', [
      { result: RESULT, excerpts: [], error: 'Error: HTTP 403' },
    ]);
    assert.match(text, /could not read page: Error: HTTP 403/);
  });

  it('notes when a page yielded no matching passages', () => {
    const text = formatResultExcerpts('chokidar', [{ result: RESULT, excerpts: [] }]);
    assert.match(text, /no passages matched the query/);
  });

  it('returns empty string when there is nothing to render', () => {
    assert.equal(formatResultExcerpts('chokidar', []), '');
  });
});

describe('appendResultExcerpts', () => {
  it('returns the listing unchanged when there are no results', async () => {
    const listing = 'No SearXNG results found for: chokidar';
    assert.equal(await appendResultExcerpts('chokidar', [], listing), listing);
  });

  it('appends excerpts below the original listing', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/html' }),
      text: async () =>
        '<html><body><p>Chokidar exposes awaitWriteFinish to stabilise partial writes.</p></body></html>',
    });

    try {
      const listing = 'SearXNG search results for "chokidar":\n\n1. chokidar - npm';
      const text = await appendResultExcerpts('chokidar awaitWriteFinish', [RESULT], listing, {
        pageLimit: 1,
      });
      assert.ok(text.startsWith(listing), 'original listing must be preserved');
      assert.match(text, /Page excerpts for "chokidar awaitWriteFinish"/);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
