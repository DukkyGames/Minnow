/**
 * Relevance guard — discards anti-scraping decoy result sets (MIN-618).
 *
 * Fixtures are shaped after real captures: Bing answers long-tail queries with HTTP 200,
 * the correct page title, and 10 well-formed results belonging to unrelated queries.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import {
  applyRelevanceGuard,
  HEALTHY_COVERAGE_THRESHOLD,
  looksUnrelated,
  resultSetCoverage,
  tokenizeQuery,
} from '../../server/tools/search-result.js';
import { searchSearxngStructured } from '../../server/tools/web-search-searxng.js';

/** Verbatim shape of an observed decoy SERP for "chokidar v4 watch options changes". */
const DECOY_RESULTS = [
  { title: 'Anmelden bei Hotmail | Microsoft Support', url: 'https://support.microsoft.com/hotmail', snippet: 'Hotmail anmelden' },
  { title: 'Convert m to cm', url: 'https://www.unitconverters.net/length/m-to-cm.htm', snippet: 'Meters to centimeters' },
  { title: 'Nick Jr. | Homepage', url: 'https://www.nickjr.com/', snippet: 'Games and videos for preschoolers' },
  { title: 'Speedtest by Ookla', url: 'https://www.speedtest.net/', snippet: 'Test your internet speed' },
  { title: 'Booking.com | Official site', url: 'https://www.booking.com/', snippet: 'Hotels, flights, car rentals' },
  { title: 'Italy Population (2026) - Worldometer', url: 'https://www.worldometers.info/world-population/italy-population/', snippet: 'Population of Italy' },
  { title: 'Fisherman’s Wharf San Francisco', url: 'https://www.fishermanswharf.org/', snippet: 'Visit the wharf' },
];

/** A genuine result set for the same query. */
const GENUINE_RESULTS = [
  { title: 'GitHub - paulmillr/chokidar: Minimal and efficient file watching', url: 'https://github.com/paulmillr/chokidar', snippet: 'Minimal and efficient cross-platform file watching library' },
  { title: 'chokidar - npm', url: 'https://www.npmjs.com/package/chokidar', snippet: 'Neat wrapper around node.js fs.watch / fs.watchFile' },
  { title: 'Chokidar v4 release notes', url: 'https://github.com/paulmillr/chokidar/releases', snippet: 'Dropped glob support, new watch options' },
  { title: 'Migrating to chokidar 4', url: 'https://example.dev/blog/chokidar-4-migration', snippet: 'What changed in the v4 API' },
];

describe('tokenizeQuery', () => {
  it('keeps distinctive tokens and drops stopwords and short tokens', () => {
    assert.deepEqual(tokenizeQuery('chokidar v4 watch options changes'), [
      'chokidar',
      'watch',
      'options',
      'changes',
    ]);
  });

  it('preserves punctuation that carries meaning', () => {
    assert.deepEqual(tokenizeQuery('happy-dom vs node.js and c++'), [
      'happy-dom',
      'node.js',
      'c++',
    ]);
  });

  it('returns nothing for a query with no distinctive tokens', () => {
    assert.deepEqual(tokenizeQuery('how do I use it'), []);
    assert.deepEqual(tokenizeQuery('   '), []);
  });
});

describe('resultSetCoverage', () => {
  it('scores a genuine result set at 1', () => {
    assert.equal(resultSetCoverage('chokidar v4 watch options changes', GENUINE_RESULTS), 1);
  });

  it('scores a decoy result set near zero', () => {
    const coverage = resultSetCoverage('chokidar v4 watch options changes', DECOY_RESULTS);
    assert.ok(coverage < 0.15, `expected near-zero coverage, got ${coverage}`);
  });

  it('matches tokens appearing only in the URL', () => {
    const rows = [
      { title: 'Minimal and efficient file watching', url: 'https://github.com/paulmillr/chokidar', snippet: '' },
    ];
    assert.equal(resultSetCoverage('chokidar', rows), 1);
  });
});

describe('looksUnrelated', () => {
  it('rejects a wholly unrelated result set', () => {
    assert.equal(looksUnrelated('chokidar v4 watch options changes', DECOY_RESULTS), true);
  });

  it('accepts a genuine result set', () => {
    assert.equal(looksUnrelated('chokidar v4 watch options changes', GENUINE_RESULTS), false);
  });

  it('keeps a set that still holds one relevant row', () => {
    const salvageable = [...DECOY_RESULTS, GENUINE_RESULTS[0]];
    assert.equal(looksUnrelated('chokidar v4 watch options changes', salvageable), false);
  });

  it('does not judge result sets too thin to be a decoy', () => {
    assert.equal(looksUnrelated('chokidar watch options', DECOY_RESULTS.slice(0, 2)), false);
  });

  it('does not judge queries with no distinctive tokens', () => {
    assert.equal(looksUnrelated('how do I use it', DECOY_RESULTS), false);
  });
});

describe('applyRelevanceGuard', () => {
  it('passes a healthy result set through untouched', () => {
    const outcome = applyRelevanceGuard('SearXNG', 'chokidar v4 watch options', GENUINE_RESULTS);
    assert.equal(outcome.error, undefined);
    assert.deepEqual(outcome.results, GENUINE_RESULTS);
  });

  it('discards an all-decoy set and explains why', () => {
    const outcome = applyRelevanceGuard('SearXNG', 'chokidar v4 watch options', DECOY_RESULTS);
    assert.deepEqual(outcome.results, []);
    assert.match(outcome.error ?? '', /unrelated to "chokidar v4 watch options"/);
    assert.match(outcome.error ?? '', /decoy/);
  });

  it('salvages the relevant rows from a contaminated set', () => {
    // Shaped after a real capture: 3 relevant Stack Overflow rows among 10 Bing decoys
    // scored 0.23 coverage, which a set-level discard would have thrown away entirely.
    const contaminated = [
      GENUINE_RESULTS[0],
      ...DECOY_RESULTS,
      GENUINE_RESULTS[1],
      GENUINE_RESULTS[2],
    ];
    const coverage = resultSetCoverage('chokidar v4 watch options', contaminated);
    assert.ok(coverage < HEALTHY_COVERAGE_THRESHOLD, `expected contaminated set, got ${coverage}`);

    const outcome = applyRelevanceGuard('SearXNG', 'chokidar v4 watch options', contaminated);
    assert.equal(outcome.error, undefined);
    assert.deepEqual(outcome.results, [
      GENUINE_RESULTS[0],
      GENUINE_RESULTS[1],
      GENUINE_RESULTS[2],
    ]);
  });

  it('leaves a healthy set alone even when one row is off-topic', () => {
    // Filtering a healthy set would drop relevant results phrased differently.
    const mostlyGood = [...GENUINE_RESULTS, DECOY_RESULTS[0]];
    const outcome = applyRelevanceGuard('SearXNG', 'chokidar v4 watch options', mostlyGood);
    assert.equal(outcome.results.length, mostlyGood.length);
  });
});

describe('searchSearxngStructured relevance guard', () => {
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

  it('discards a decoy SERP so callers fall through to the next provider', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: DECOY_RESULTS.map((row) => ({
          title: row.title,
          url: row.url,
          content: row.snippet,
        })),
      }),
    });

    const { results, error } = await searchSearxngStructured(
      'chokidar v4 watch options changes',
      'http://127.0.0.1:8899',
    );
    assert.deepEqual(results, []);
    assert.match(error ?? '', /unrelated/);
  });

  it('keeps a genuine SERP', async () => {
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        results: GENUINE_RESULTS.map((row) => ({
          title: row.title,
          url: row.url,
          content: row.snippet,
        })),
      }),
    });

    const { results, error } = await searchSearxngStructured(
      'chokidar v4 watch options changes',
      'http://127.0.0.1:8899',
    );
    assert.equal(error, undefined);
    assert.equal(results.length, GENUINE_RESULTS.length);
  });
});
