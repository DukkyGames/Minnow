/**
 * fetch_web_content shared utilities and server handlers (BUG-011).
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatFetchNetworkError,
  rankSentencesByQuery,
  stripHtmlToPlainText,
  truncateUtf8,
  validateHttpUrl,
  WEB_TEXT_MAX_BYTES,
  fetchUrlText,
} from '../../src/lib/fetch-web-content.mjs';
import {
  toolFetchWebContent,
  toolRagWebContent,
} from '../../server/tools/fetch-web-content.js';

describe('validateHttpUrl', () => {
  it('accepts https URLs', () => {
    const result = validateHttpUrl('https://example.com/path');
    assert.equal(result.ok, true);
    assert.equal(result.url.hostname, 'example.com');
  });

  it('rejects non-http schemes', () => {
    const result = validateHttpUrl('file:///etc/passwd');
    assert.equal(result.ok, false);
    assert.match(result.error, /only http and https/);
  });

  it('rejects malformed URLs', () => {
    const result = validateHttpUrl('not a url');
    assert.equal(result.ok, false);
    assert.match(result.error, /invalid URL/);
  });
});

describe('stripHtmlToPlainText', () => {
  it('removes tags and script content', () => {
    const html =
      '<html><head><style>.x{}</style></head><body><script>alert(1)</script><p>Hello <b>world</b></p></body></html>';
    const text = stripHtmlToPlainText(html);
    assert.equal(text, 'Hello world');
  });

  it('decodes common entities', () => {
    assert.equal(stripHtmlToPlainText('<p>A &amp; B</p>'), 'A & B');
  });
});

describe('truncateUtf8', () => {
  it('leaves short text unchanged', () => {
    assert.equal(truncateUtf8('hello', 100), 'hello');
  });

  it('truncates and appends byte cap notice', () => {
    const text = 'x'.repeat(WEB_TEXT_MAX_BYTES + 50);
    const out = truncateUtf8(text, WEB_TEXT_MAX_BYTES);
    assert.match(out, /\[truncated to 8192 bytes\]/);
    assert.ok(out.length < text.length);
  });
});

describe('rankSentencesByQuery', () => {
  it('returns sentences matching query terms', () => {
    const text =
      'Minnow is a local chat client. It supports many tools. Research mode uses web fetch.';
    const hits = rankSentencesByQuery(text, 'minnow research', 3);
    assert.ok(hits.length >= 1);
    assert.ok(hits.some((s) => /minnow/i.test(s)));
  });
});

describe('formatFetchNetworkError', () => {
  it('includes URL and npm start hint when requested', () => {
    const msg = formatFetchNetworkError('https://example.com', new TypeError('Failed to fetch'), {
      suggestNpmStart: true,
    });
    assert.match(msg, /https:\/\/example\.com/);
    assert.match(msg, /npm start/);
    assert.match(msg, /CORS/i);
  });
});

describe('fetchUrlText', () => {
  it('returns HTTP error with status and URL', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('gone', { status: 404, statusText: 'Not Found' });

    try {
      const result = await fetchUrlText('https://example.com/missing');
      assert.match(result, /HTTP 404/);
      assert.match(result, /example\.com/);
    } finally {
      globalThis.fetch = original;
    }
  });

  it('strips HTML bodies', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response('<html><body><p>Page text</p></body></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    try {
      const result = await fetchUrlText('https://example.com/');
      assert.equal(result, 'Page text');
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('toolFetchWebContent', () => {
  it('requires url argument', async () => {
    const result = await toolFetchWebContent({});
    assert.match(result, /"url" is required/);
  });

  it('returns truncated plain text on success', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(`<html><body>${'word '.repeat(3000)}</body></html>`, {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });

    try {
      const result = await toolFetchWebContent({ url: 'https://example.com/' });
      assert.ok(!result.startsWith('Error:'));
      assert.match(result, /<<<UNTRUSTED_SOURCE_DATA source="web:https:\/\/example\.com\/">>>/);
      assert.ok(result.includes('[truncated to 8192 bytes]'));
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('toolRagWebContent', () => {
  it('requires query argument', async () => {
    const result = await toolRagWebContent({ url: 'https://example.com' });
    assert.match(result, /"query" is required/);
  });

  it('returns ranked excerpts', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = async () =>
      new Response(
        '<html><body><p>Minnow agents fetch pages for research.</p><p>Unrelated filler text here.</p></body></html>',
        { status: 200, headers: { 'content-type': 'text/html' } },
      );

    try {
      const result = await toolRagWebContent({
        url: 'https://example.com/docs',
        query: 'minnow research',
      });
      assert.match(result, /<<<UNTRUSTED_SOURCE_DATA source="web-rag:https:\/\/example\.com\/docs">>>/);
      assert.match(result, /Relevant excerpts/);
      assert.match(result, /1\./);
      assert.match(result, /minnow/i);
    } finally {
      globalThis.fetch = original;
    }
  });
});
