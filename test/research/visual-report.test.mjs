/**
 * Visual report HTML generation — sanitize, TOC ids, tables, category theming.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  applyHeadingIds,
  extractHeadings,
  generateVisualReport,
  mdToHtml,
  sanitizeReportHtml,
} from '../../server/research/visual-report.js';

describe('visual report sanitize', () => {
  it('strips script tags and inline handlers from untrusted markdown HTML', () => {
    const malicious =
      '## Findings\n\nNormal text.\n\n<script>alert("xss")</script>\n\n' +
      '<img src=x onerror="alert(1)">\n\n[javascript:evil](javascript:alert(1))';
    const html = mdToHtml(malicious);
    assert.doesNotMatch(html, /<script/i);
    assert.doesNotMatch(html, /onerror\s*=/i);
    assert.doesNotMatch(html, /href\s*=\s*["']javascript:/i);

    const page = generateVisualReport('Test query', malicious, [], {}, 'general', 'rs-abc123');
    assert.doesNotMatch(page, /<script[^>]*>alert/i);
    assert.match(page, /<script>\n\(function\(\)/);
  });

  it('sanitizeReportHtml removes event handlers from raw HTML', () => {
    const cleaned = sanitizeReportHtml('<p onclick="steal()">Hi</p><details><summary>More</summary></details>');
    assert.doesNotMatch(cleaned, /onclick/i);
    assert.match(cleaned, /<details>/);
    assert.match(cleaned, /<summary>/);
  });
});

describe('visual report TOC', () => {
  it('assigns stable heading ids that match TOC links', () => {
    const markdown = [
      '# Widget Market Analysis',
      '',
      '## First Section',
      '',
      'Intro paragraph.',
      '',
      '### Nested Topic',
      '',
      'Details here.',
    ].join('\n');

    const headings = extractHeadings(markdown);
    assert.equal(headings.length, 2);
    assert.equal(headings[0].slug, 'first-section');
    assert.equal(headings[1].slug, 'nested-topic');

    const withIds = applyHeadingIds(mdToHtml(markdown), headings);
    assert.match(withIds, /<h2[^>]*id="first-section"/);
    assert.match(withIds, /<h3[^>]*id="nested-topic"/);

    const page = generateVisualReport('Query', markdown, [], { Rounds: 2 }, null, 'rs-deadbeef00');
    assert.match(page, /<a href="#first-section" class="depth-2">First Section<\/a>/);
    assert.match(page, /<a href="#nested-topic" class="depth-3">Nested Topic<\/a>/);
    assert.match(page, /<h2[^>]*id="first-section"/);
    assert.match(page, /<h3[^>]*id="nested-topic"/);
  });

  it('deduplicates slug collisions', () => {
    const markdown = '## Overview\n\nA\n\n## Overview\n\nB';
    const headings = extractHeadings(markdown);
    assert.equal(headings[0].slug, 'overview');
    assert.equal(headings[1].slug, 'overview-1');
  });
});

describe('visual report tables', () => {
  it('renders GFM tables in report content', () => {
    const markdown = [
      '## Comparison',
      '',
      '| Feature | A | B |',
      '| --- | --- | --- |',
      '| Speed | Fast | Slow |',
    ].join('\n');

    const page = generateVisualReport('Compare A and B', markdown, [], {}, 'comparison', null);
    assert.match(page, /<table>/);
    assert.match(page, /<th[^>]*>Feature<\/th>/);
    assert.match(page, /<td[^>]*>Fast<\/td>/);
    assert.match(page, /<td[^>]*>Slow<\/td>/);
  });
});

describe('visual report category class', () => {
  it('applies category body class and category CSS block', () => {
    const page = generateVisualReport(
      'Best widgets',
      '## Widget Roundup\n\nContent.',
      [{ url: 'https://example.com', title: 'Example' }],
      { Duration: '2m', Model: 'test-model' },
      'product',
      'rs-111111111111',
    );

    assert.match(page, /<body class="category-product">/);
    assert.match(page, /body\.category-product \{/);
    assert.match(page, /\.category-product \.content table th/);
    assert.match(page, /Sources \(1\)/);
    assert.match(page, /<span class="stat-value">2m<\/span> Duration/);
    assert.match(page, /Phase 5b: hero image/);
    assert.doesNotMatch(page, /<div class="hero-image"/);
    assert.doesNotMatch(page, /<figure class="section-image"/);
  });

  it('includes hardened export dropdown script', () => {
    const page = generateVisualReport('Export test', '## Section\n\nBody.', [], {}, null, null);
    assert.match(page, /if \(!exportBtn \|\| !exportMenu\) return;/);
    assert.match(page, /exportMenu\.addEventListener\('click', function\(e\) \{ e\.stopPropagation\(\); \}\)/);
  });
});
