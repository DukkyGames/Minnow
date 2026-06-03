import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

const { rankSettingsSearch } = await import(
  '../../src/ui/settings-search-rank.ts'
);

const SAMPLE = [
  {
    id: 'section:features',
    label: 'Orchestration',
    sectionId: 'features',
    kind: 'section',
    keywords: ['orchestration', 'orchestrate'],
    hint: 'Section',
  },
  {
    id: 'section:general',
    label: 'General',
    sectionId: 'general',
    kind: 'section',
    keywords: ['general'],
    hint: 'Section',
  },
  {
    id: 'tool:web_search',
    label: 'Web search',
    sectionId: 'tools',
    kind: 'tool',
    keywords: ['web_search', 'brave'],
    hint: 'Tool',
  },
];

describe('settings-search-rank', () => {
  test('exact label prefix ranks above substring', () => {
    const ranked = rankSettingsSearch('gen', SAMPLE);
    assert.equal(ranked[0]?.id, 'section:general');
  });

  test('orchestration matches features via keyword', () => {
    const ranked = rankSettingsSearch('orchestration', SAMPLE);
    assert.equal(ranked[0]?.id, 'section:features');
  });

  test('tool id substring matches tool entry', () => {
    const ranked = rankSettingsSearch('web_search', SAMPLE);
    assert.ok(ranked.some((e) => e.id === 'tool:web_search'));
  });

  test('empty query returns no results', () => {
    assert.deepEqual(rankSettingsSearch('', SAMPLE), []);
    assert.deepEqual(rankSettingsSearch('   ', SAMPLE), []);
  });
});
