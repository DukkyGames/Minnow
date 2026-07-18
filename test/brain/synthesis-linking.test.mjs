/**
 * Linking floors — similarTo edges and retirement need absolute evidence.
 *
 * Regression: findRelatedPagePaths took the top 3 pages with no minimum score,
 * so one shared generic title word (or merely existing, via the hybrid
 * retriever's recent/pinned fallback) drew an edge between unrelated pages.
 * titlesAreSameTopic had the same problem at 1 shared word / 40% overlap and
 * retired pages that had nothing to do with each other.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  findRelatedPagePaths,
  titlesAreSameTopic,
} from '../../server/brain/synthesis.js';
import { DEFAULT_LINKING_CONFIG } from '../../server/brain/linking-config.js';

const EMB_OFF = { embeddings: { enabled: false } };
const EMB_ON = {
  embeddings: { enabled: true, backend: 'local', modelId: 'test-model', queryTimeoutMs: 100 },
};

let idSeq = 0;
function page(title, path) {
  idSeq += 1;
  const id = `1111111${idSeq}-1111-4111-8111-111111111111`;
  return { meta: { id, title, path: path ?? `facts/${id}.md` }, body: title };
}

/** Vector deps that hand back a fixed cosine per page path. */
function makeDeps(cosineByPath, pages) {
  const vectors = {};
  for (const row of pages) {
    const cosine = cosineByPath[row.meta.path] ?? 0;
    // Unit vectors in 2D: cosine against [1, 0] is exactly the first component.
    vectors[row.meta.id] = [cosine, Math.sqrt(Math.max(0, 1 - cosine * cosine))];
  }
  return {
    getEmbedder: async () => ({ id: 'test-model', dim: 2 }),
    embedTexts: async () => [[1, 0]],
    loadVectorStore: async () => ({
      model: 'test-model',
      backend: 'local',
      dim: 2,
      vectors,
    }),
    getEntryVector: async () => null,
  };
}

describe('titlesAreSameTopic', () => {
  test('one shared generic word is not the same topic', () => {
    assert.equal(
      titlesAreSameTopic('Vite preview port pinning', 'Electron devtools port conflict'),
      false,
    );
  });

  test('two shared keywords with majority overlap is the same topic', () => {
    // The point of the title signal: a semantic update keeps most of the title.
    assert.equal(titlesAreSameTopic('Prefers dark mode', 'Prefers light mode'), true);
    assert.equal(
      titlesAreSameTopic('Vite preview port', 'Vite preview port pinning'),
      true,
    );
  });

  test('two-keyword titles need both words to match', () => {
    assert.equal(titlesAreSameTopic('Redis cache', 'Redis cluster'), false);
    assert.equal(titlesAreSameTopic('Redis cache', 'Redis cache warmup'), true);
  });

  test('single-keyword titles match on that keyword', () => {
    assert.equal(titlesAreSameTopic('Neovim', 'Neovim'), true);
    assert.equal(titlesAreSameTopic('Neovim', 'Emacs'), false);
  });

  test('empty or stop-word-only titles never match', () => {
    assert.equal(titlesAreSameTopic('', 'Neovim'), false);
    assert.equal(titlesAreSameTopic('the of a', 'the of a'), false);
  });
});

describe('findRelatedPagePaths', () => {
  test('one shared title keyword does not qualify', async () => {
    const existing = [
      page('Electron devtools port conflict'),
      page('Server port allocation'),
    ];
    const related = await findRelatedPagePaths(
      { title: 'Vite preview port pinning', body: 'pin the port' },
      existing,
      EMB_OFF,
    );
    assert.deepEqual(related, []);
  });

  test('two shared title keywords qualify', async () => {
    const target = page('Vite preview autoPort behavior');
    const existing = [page('Unrelated editor preference'), target];
    const related = await findRelatedPagePaths(
      { title: 'Vite preview port pinning', body: 'pin the port' },
      existing,
      EMB_OFF,
    );
    assert.deepEqual(related, [target.meta.path]);
  });

  test('returns [] rather than linking to whatever exists', async () => {
    const existing = [page('Lives in Berlin'), page('Prefers Neovim'), page('Uses pnpm')];
    const related = await findRelatedPagePaths(
      { title: 'Postgres connection pooling', body: 'pool size tuning' },
      existing,
      EMB_OFF,
    );
    assert.deepEqual(related, []);
  });

  test('cosine above the floor qualifies without shared keywords', async () => {
    const strong = page('Completely different wording', 'facts/strong.md');
    const weak = page('Also different wording', 'facts/weak.md');
    const existing = [strong, weak];
    const related = await findRelatedPagePaths(
      { title: 'Postgres connection pooling', body: 'pool size tuning' },
      existing,
      EMB_ON,
      makeDeps({ 'facts/strong.md': 0.9, 'facts/weak.md': 0.5 }, existing),
    );
    assert.deepEqual(related, ['facts/strong.md']);
  });

  test('cosine below the floor does not qualify', async () => {
    const existing = [page('Unrelated page', 'facts/a.md')];
    const related = await findRelatedPagePaths(
      { title: 'Postgres connection pooling', body: 'pool size tuning' },
      existing,
      EMB_ON,
      makeDeps({ 'facts/a.md': DEFAULT_LINKING_CONFIG.minCosine - 0.1 }, existing),
    );
    assert.deepEqual(related, []);
  });

  test('caps at maxLinks, highest scoring first', async () => {
    const existing = [
      page('Vite preview port one', 'facts/one.md'),
      page('Vite preview port two', 'facts/two.md'),
      page('Vite preview port three', 'facts/three.md'),
      page('Vite preview port four', 'facts/four.md'),
    ];
    const related = await findRelatedPagePaths(
      { title: 'Vite preview port pinning', body: 'pin the port' },
      existing,
      EMB_ON,
      makeDeps(
        {
          'facts/one.md': 0.2,
          'facts/two.md': 0.95,
          'facts/three.md': 0.4,
          'facts/four.md': 0.1,
        },
        existing,
      ),
    );
    assert.equal(related.length, DEFAULT_LINKING_CONFIG.maxLinks);
    assert.equal(related[0], 'facts/two.md');
  });

  test('respects a custom linking block', async () => {
    const target = page('Electron devtools port conflict');
    const related = await findRelatedPagePaths(
      { title: 'Vite preview port pinning', body: 'pin the port' },
      [target],
      { ...EMB_OFF, linking: { minSharedTitleKeywords: 1 } },
    );
    assert.deepEqual(related, [target.meta.path]);
  });

  test('empty fact links to nothing', async () => {
    const related = await findRelatedPagePaths({ title: '', body: '' }, [page('x')], EMB_OFF);
    assert.deepEqual(related, []);
  });
});
