import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  classifyDdgHtml,
  DDG_BOT_CHALLENGE_MESSAGE,
  parseDdgHtmlResults,
} from '../../server/tools/web-search-ddg.js';

describe('classifyDdgHtml', () => {
  it('detects HTTP 202 bot challenge', () => {
    assert.equal(classifyDdgHtml(202, '<html></html>'), 'challenge');
  });

  it('detects anomaly-modal markup', () => {
    const html = '<div class="anomaly-modal">blocked</div>';
    assert.equal(classifyDdgHtml(200, html), 'challenge');
  });

  it('detects bots use DuckDuckGo copy', () => {
    const html = '<p>Bots use DuckDuckGo too.</p>';
    assert.equal(classifyDdgHtml(200, html), 'challenge');
  });

  it('detects anomaly.js form action', () => {
    const html = '<form action="/anomaly.js?x=1"></form>';
    assert.equal(classifyDdgHtml(200, html), 'challenge');
  });

  it('returns results when result__a links exist', () => {
    const html = `
      <div class="result ">
        <a class="result__a" href="https://example.com">Example</a>
        <a class="result__snippet">Snippet text</a>
      </div>`;
    assert.equal(classifyDdgHtml(200, html), 'results');
  });

  it('returns empty when no results or challenge', () => {
    assert.equal(classifyDdgHtml(200, '<html><body>no hits</body></html>'), 'empty');
  });
});

describe('parseDdgHtmlResults', () => {
  it('formats titles, urls, and snippets', () => {
    const html = `
      <div class="result ">
        <a class="result__a" href="https://example.com">Example &amp; Co</a>
        <a class="result__snippet">A short snippet</a>
      </div>`;
    const rows = parseDdgHtmlResults(html, 'test query');
    assert.equal(rows.length, 1);
    assert.match(rows[0], /1\. Example & Co/);
    assert.match(rows[0], /https:\/\/example\.com/);
    assert.match(rows[0], /A short snippet/);
  });
});

describe('DDG_BOT_CHALLENGE_MESSAGE', () => {
  it('mentions Brave and Tavily configuration', () => {
    assert.match(DDG_BOT_CHALLENGE_MESSAGE, /Brave/i);
    assert.match(DDG_BOT_CHALLENGE_MESSAGE, /Tavily/i);
  });
});
