/**
 * SearXNG structured search parsing and fetch behavior.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  mapSearxngResults,
  searchSearxngStructured,
} from '../../server/tools/web-search-searxng.js';

describe('mapSearxngResults', () => {
  it('maps title, url, and content to snippet', () => {
    const rows = mapSearxngResults(
      {
        results: [
          { title: 'Example', url: 'https://example.com', content: 'A snippet' },
          { title: 'No URL', url: '', content: 'skip' },
        ],
      },
      10,
    );
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], {
      title: 'Example',
      url: 'https://example.com',
      snippet: 'A snippet',
    });
  });
});

describe('searchSearxngStructured', () => {
  /** @type {typeof globalThis.fetch | undefined} */
  let originalFetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    if (originalFetch) {
      globalThis.fetch = originalFetch;
    }
  });

  it('returns structured rows from SearXNG JSON', async () => {
    globalThis.fetch = async (input) => {
      const url = String(input);
      assert.match(url, /\/search\?q=test&format=json$/);
      return {
        ok: true,
        status: 200,
        json: async () => ({
          results: [{ title: 'Hit', url: 'https://hit.test', content: 'Body' }],
        }),
      };
    };

    const { results, error } = await searchSearxngStructured('test', 'http://127.0.0.1:8080');
    assert.equal(error, undefined);
    assert.equal(results.length, 1);
    assert.equal(results[0].title, 'Hit');
  });

  it('returns error when SearXNG URL is missing', async () => {
    const { results, error } = await searchSearxngStructured('test', '');
    assert.equal(results.length, 0);
    assert.match(error ?? '', /SearXNG URL not configured/);
  });
});
