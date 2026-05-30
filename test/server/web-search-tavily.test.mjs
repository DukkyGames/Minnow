import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatTavilySearchResults } from '../../server/tools/web-search-tavily.js';

describe('formatTavilySearchResults', () => {
  it('formats non-empty Tavily result rows', () => {
    const text = formatTavilySearchResults('minnow chat', [
      {
        title: 'Minnow',
        url: 'https://example.com/minnow',
        content: 'Local AI chat client.',
      },
    ]);
    assert.match(text, /Tavily search results for "minnow chat"/);
    assert.match(text, /1\. Minnow/);
    assert.match(text, /https:\/\/example\.com\/minnow/);
    assert.match(text, /Local AI chat client/);
  });

  it('returns explicit empty message when results array is empty', () => {
    const text = formatTavilySearchResults('nothing here', []);
    assert.equal(text, 'No Tavily results found for: nothing here');
  });
});
