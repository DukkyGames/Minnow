/**
 * Email HTML sanitizer tests.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { sanitizeEmailHtml, sanitizeInboundEmailHtml } from '../../server/email/sanitize-html.js';
import { countBlockedRemoteRefs } from '../../server/email/remote-content.js';

describe('sanitizeEmailHtml', () => {
  test('strips script tags and keeps safe markup', () => {
    const out = sanitizeEmailHtml(
      '<p>Hello</p><script>alert(1)</script><a href="https://example.com">Link</a>',
    );
    assert.ok(out);
    assert.match(out, /Hello/);
    assert.match(out, /example\.com/);
    assert.doesNotMatch(out, /script/i);
    assert.doesNotMatch(out, /alert/);
  });

  test('returns undefined for empty input', () => {
    assert.equal(sanitizeEmailHtml(''), undefined);
    assert.equal(sanitizeEmailHtml('   '), undefined);
    assert.equal(sanitizeEmailHtml(null), undefined);
  });

  test('blocks javascript: hrefs', () => {
    const out = sanitizeEmailHtml('<a href="javascript:alert(1)">Click</a>');
    assert.ok(out);
    assert.doesNotMatch(out, /javascript:/i);
  });

  test('leaves remote images alone for outbound mail', () => {
    const out = sanitizeEmailHtml('<img src="https://cdn.example.com/logo.png">');
    assert.ok(out);
    assert.match(out, /src="https:\/\/cdn\.example\.com\/logo\.png"/);
    assert.equal(countBlockedRemoteRefs(out), 0);
  });
});

describe('sanitizeInboundEmailHtml', () => {
  /** Every URL a rendered body could dereference on its own. */
  const TRACKING_FIXTURE = [
    '<img src="https://tracker.example/pixel.gif" width="1" height="1">',
    '<img srcset="https://tracker.example/a.png 1x, https://tracker.example/b.png 2x">',
    '<table><tr><td background="https://tracker.example/bg.gif">cell</td></tr></table>',
    '<video poster="https://tracker.example/poster.jpg"></video>',
    '<div style="background: url(https://tracker.example/css.png); color: red">styled</div>',
  ].join('');

  test('parks every remote reference so the body cannot beacon', () => {
    const out = sanitizeInboundEmailHtml(TRACKING_FIXTURE);
    assert.ok(out);
    assert.equal(countBlockedRemoteRefs(out), 5);

    // The exit criterion: with the parked originals removed, nothing the
    // renderer would dereference mentions the tracker at all.
    const live = out.replace(/\sdata-minnow-remote-[a-z]+="[^"]*"/gi, '');
    assert.doesNotMatch(live, /tracker\.example/);
  });

  test('keeps the original URLs recoverable for "load images"', () => {
    const out = sanitizeInboundEmailHtml('<img src="https://tracker.example/pixel.gif">');
    assert.ok(out);
    assert.match(out, /data-minnow-remote-src="https:\/\/tracker\.example\/pixel\.gif"/);
  });

  test('preserves non-network cid: and data: sources', () => {
    const out = sanitizeInboundEmailHtml(
      '<img src="cid:logo@inline"><img src="data:image/gif;base64,R0lGOD">',
    );
    assert.ok(out);
    assert.match(out, /src="cid:logo@inline"/);
    assert.match(out, /src="data:image\/gif/);
    assert.equal(countBlockedRemoteRefs(out), 0);
  });

  test('blocks protocol-relative URLs', () => {
    const out = sanitizeInboundEmailHtml('<img src="//tracker.example/pixel.gif">');
    assert.ok(out);
    assert.doesNotMatch(out, /(?<!data-minnow-remote-)src="\/\//);
    assert.equal(countBlockedRemoteRefs(out), 1);
  });

  test('keeps surviving style declarations when stripping a remote url()', () => {
    const out = sanitizeInboundEmailHtml(
      '<div style="background: url(https://t/x.png); color: red">hi</div>',
    );
    assert.ok(out);
    // The live style keeps `color` but loses the fetch; the original is parked.
    const live = /(?<!remote-)style="([^"]*)"/.exec(out)?.[1] ?? '';
    assert.match(live, /color:\s*red/);
    assert.doesNotMatch(live, /url\(/);
    assert.match(out, /data-minnow-remote-style="[^"]*https:\/\/t\/x\.png/);
  });

  test('does not leak its hook into later outbound sanitizing', () => {
    sanitizeInboundEmailHtml('<img src="https://tracker.example/pixel.gif">');
    const outbound = sanitizeEmailHtml('<img src="https://cdn.example.com/logo.png">');
    assert.ok(outbound);
    assert.match(outbound, /src="https:\/\/cdn\.example\.com\/logo\.png"/);
  });
});
