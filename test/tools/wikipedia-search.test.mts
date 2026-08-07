/**
 * wikipedia_search browser tool — opensearch + query API descriptions.
 */

import assert from 'node:assert/strict';
import { afterEach, describe, mock, test } from 'node:test';
import { executeBrowserTool } from '../../src/tools/browser-executor.ts';

const OPENSEARCH_PAYLOAD = [
  'python',
  ['Python (programming language)', 'Monty Python'],
  ['', ''],
  [
    'https://en.wikipedia.org/wiki/Python_(programming_language)',
    'https://en.wikipedia.org/wiki/Monty_Python',
  ],
];

const QUERY_PAYLOAD = {
  query: {
    pages: {
      '23862': {
        pageid: 23862,
        ns: 0,
        title: 'Python (programming language)',
        description: 'General-purpose programming language',
        extract:
          'Python is a high-level, general-purpose programming language. Its design philosophy emphasizes code readability.',
      },
      '18879': {
        pageid: 18879,
        ns: 0,
        title: 'Monty Python',
        extract:
          'Monty Python were a British surreal comedy troupe. They created the sketch comedy television show Monty Python\'s Flying Circus.',
      },
    },
  },
};

describe('wikipedia_search', () => {
  afterEach(() => {
    mock.restoreAll();
  });

  test('requires query', async () => {
    const result = await executeBrowserTool('wikipedia_search', {});
    assert.equal(result, 'Error: "query" is required');
  });

  test('maps query API descriptions by title after opensearch', async () => {
    const fetchUrls: string[] = [];

    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      fetchUrls.push(url);

      if (url.includes('action=opensearch')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          async json() {
            return OPENSEARCH_PAYLOAD;
          },
        };
      }

      if (url.includes('action=query')) {
        assert.match(url, /titles=Python\+/);
        assert.match(url, /prop=description%7Cextracts/);
        assert.match(url, /exintro=1/);
        assert.match(url, /explaintext=1/);
        assert.match(url, /exsentences=2/);
        assert.match(url, /origin=(\*|%2A)/);
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          async json() {
            return QUERY_PAYLOAD;
          },
        };
      }

      throw new Error(`unexpected fetch: ${url}`);
    });

    const result = await executeBrowserTool('wikipedia_search', { query: 'python' });

    assert.equal(fetchUrls.length, 2);
    assert.match(fetchUrls[0] ?? '', /action=opensearch/);
    assert.match(fetchUrls[1] ?? '', /action=query/);

    assert.match(result, /^Wikipedia results for "python":/);
    assert.match(result, /1\. Python \(programming language\)/);
    assert.match(result, /General-purpose programming language/);
    assert.match(result, /2\. Monty Python/);
    assert.match(result, /British surreal comedy troupe/);
  });

  test('falls back to opensearch snippets when query fetch fails', async () => {
    mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('action=opensearch')) {
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          async json() {
            return [
              'test',
              ['Test article'],
              ['Opensearch snippet text'],
              ['https://en.wikipedia.org/wiki/Test_article'],
            ];
          },
        };
      }
      return { ok: false, status: 500, statusText: 'Server Error' };
    });

    const result = await executeBrowserTool('wikipedia_search', { query: 'test' });
    assert.match(result, /Opensearch snippet text/);
  });
});
