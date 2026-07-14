/**
 * Codebase search helpers for Deep Research (MIN-175).
 */
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';

import {
  codebaseSearchDeps,
  extractFromFile,
  extractSearchTerms,
  searchCodebase,
} from '../../server/research/codebase-search.js';

describe('codebase search', () => {
  afterEach(() => {
    codebaseSearchDeps.rgSearch = null;
    codebaseSearchDeps.rgListFiles = null;
    codebaseSearchDeps.readFile = null;
    codebaseSearchDeps.llmCall = null;
  });

  test('extractSearchTerms pulls identifiers and drops stop words', () => {
    const terms = extractSearchTerms('How does DeepResearcher search the local codebase?');
    assert.ok(terms.includes('DeepResearcher'));
    assert.ok(!terms.includes('how'));
    assert.ok(!terms.includes('the'));
  });

  test('searchCodebase returns structured file hits', async () => {
    codebaseSearchDeps.rgSearch = async () =>
      'server/research/engine.js:10:export class DeepResearcher\n';
    codebaseSearchDeps.rgListFiles = async () => [];

    const rows = await searchCodebase('DeepResearcher', { root: '/workspace', maxFiles: 5 });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].path, 'server/research/engine.js');
    assert.match(rows[0].title, /engine\.js$/);
    assert.match(rows[0].snippet, /DeepResearcher/);
  });

  test('extractFromFile returns ResearchFinding with file path as url', async () => {
    codebaseSearchDeps.readFile = async () => 'export class DeepResearcher {}\n';
    codebaseSearchDeps.llmCall = async () =>
      JSON.stringify({
        rational: 'Defines the research engine class.',
        evidence: 'export class DeepResearcher {}',
        summary: 'DeepResearcher is the main engine class in engine.js.',
      });

    const finding = await extractFromFile({
      path: 'server/research/engine.js',
      question: 'What is DeepResearcher?',
      providerId: 'p1',
      model: 'm1',
      maxContentChars: 5000,
      extractionTimeoutSeconds: 30,
    });

    assert.ok(finding);
    assert.equal(finding.url, 'server/research/engine.js');
    assert.match(finding.summary, /DeepResearcher/);
  });
});
