/**
 * Deep Research engine loop with mocked LLM + search.
 */
import assert from 'node:assert/strict';
import { describe, test, afterEach } from 'node:test';

import { DeepResearcher, engineDeps } from '../../server/research/engine.js';

/** @type {typeof engineDeps.llmCall} */
let originalLlmCall;
/** @type {typeof engineDeps.searchStructured} */
let originalSearch;
/** @type {typeof engineDeps.fetchAndExtract} */
let originalExtract;

afterEach(() => {
  engineDeps.llmCall = originalLlmCall;
  engineDeps.searchStructured = originalSearch;
  engineDeps.fetchAndExtract = originalExtract;
});

/**
 * @param {Record<string, string | string[] | ((msg: string) => string)>} routes
 * @returns {typeof engineDeps.llmCall}
 */
function mockLlmCall(routes) {
  return async ({ messages }) => {
    const content = messages.map((m) => m.content).join('\n');
    for (const [needle, value] of Object.entries(routes)) {
      if (!content.includes(needle)) {
        continue;
      }
      if (typeof value === 'function') {
        return value(content);
      }
      if (Array.isArray(value)) {
        const idx = value.findIndex((v) => v !== '__USED__');
        if (idx === -1) {
          return value[value.length - 1] === '__USED__' ? '' : String(value[value.length - 1]);
        }
        const next = value[idx];
        value[idx] = '__USED__';
        return next;
      }
      return value;
    }
    return '';
  };
}

function mockSearch(resultsPerQuery = 1) {
  return async (query) => {
    const rows = [];
    for (let i = 0; i < resultsPerQuery; i += 1) {
      rows.push({
        title: `Result ${i + 1} for ${query}`,
        url: `https://example.com/${encodeURIComponent(query)}-${i}`,
        snippet: 'snippet',
      });
    }
    return rows;
  };
}

function mockExtract() {
  return async ({ url, title }) => ({
    url,
    title: title || 'Page',
    rational: 'Relevant section',
    evidence: 'Evidence text',
    summary: 'Useful summary about the topic.',
  });
}

describe('DeepResearcher', () => {
  test('does not stop before minRounds even when the model says YES early', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;

    const stopCalls = { count: 0 };

    engineDeps.llmCall = mockLlmCall({
      'research strategist': '{"sub_questions":["a"],"key_topics":["b"],"success_criteria":"ok"}',
      'planning web searches': (content) => {
        if (content.includes('**Round:** 1')) {
          return '["alpha", "beta"]';
        }
        if (content.includes('**Round:** 2')) {
          return '["gamma", "delta"]';
        }
        return '["epsilon", "zeta"]';
      },
      'evolving research report': '## Draft report\n\nBody with citations.',
      'comprehensive enough': () => {
        stopCalls.count += 1;
        return 'YES — enough coverage.';
      },
      'long, detailed, comprehensive': '# Final\n\nExpanded final report body.',
    });
    engineDeps.searchStructured = mockSearch(1);
    engineDeps.fetchAndExtract = mockExtract();

    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      minRounds: 3,
      maxRounds: 5,
      maxEmptyRounds: 2,
    });

    const result = await researcher.research({ question: 'What is Minnow?' });
    assert.match(result, /Final/);
    assert.equal(researcher.roundCount, 3);
    assert.equal(stopCalls.count, 1);
  });

  test('terminates after consecutive empty search rounds', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;

    engineDeps.llmCall = mockLlmCall({
      'research strategist': '{"sub_questions":["a"],"key_topics":["b"],"success_criteria":"ok"}',
      'planning web searches': (content) => {
        if (content.includes('**Round:** 1')) {
          return '["one", "two"]';
        }
        return '["three", "four"]';
      },
    });
    engineDeps.searchStructured = async () => [];
    engineDeps.fetchAndExtract = mockExtract();

    const events = [];
    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      minRounds: 1,
      maxRounds: 10,
      maxEmptyRounds: 2,
      progressCallback: (event) => events.push(event),
    });

    const result = await researcher.research({ question: 'Offline topic?' });
    assert.match(result, /Search unavailable/);
    const errorEvents = events.filter((e) => e.phase === 'error');
    assert.equal(errorEvents.length, 1);
    assert.match(String(errorEvents[0].message), /search unavailable/i);
  });

  test('returns fallback report when synthesis stays empty but findings exist', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;

    engineDeps.llmCall = mockLlmCall({
      'research strategist': '{"sub_questions":["a"],"key_topics":["b"],"success_criteria":"ok"}',
      'planning web searches': '["only-query"]',
      'evolving research report': '',
      'comprehensive enough': 'NO — still gathering.',
      'long, detailed, comprehensive': 'should-not-reach',
    });
    engineDeps.searchStructured = mockSearch(1);
    engineDeps.fetchAndExtract = mockExtract();

    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      minRounds: 1,
      maxRounds: 2,
      maxEmptyRounds: 2,
    });

    const result = await researcher.research({ question: 'Fallback topic?' });
    assert.match(result, /Automatic synthesis did not complete/);
    assert.match(result, /Finding 1/);
  });

  test('parses YES after redacted_thinking in stop decision', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;

    engineDeps.llmCall = mockLlmCall({
      'research strategist': '{"sub_questions":["a"],"key_topics":["b"],"success_criteria":"ok"}',
      'planning web searches': '["q"]',
      'evolving research report': '## Enough\n\nDone.',
      'comprehensive enough':
        '<think>reasoning</think>YES — report is complete.',
      'long, detailed, comprehensive': '# Polished\n\nFinal body.',
    });
    engineDeps.searchStructured = mockSearch(1);
    engineDeps.fetchAndExtract = mockExtract();

    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      minRounds: 1,
      maxRounds: 4,
    });

    const result = await researcher.research({ question: 'Stop parse topic?' });
    assert.match(result, /Polished/);
    assert.equal(researcher.roundCount, 1);
  });

  test('continues from prior report, findings, and URLs', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;

    engineDeps.llmCall = mockLlmCall({
      'research strategist': 'Sub-questions: follow-up',
      'planning web searches': '["follow-up query"]',
      'evolving research report': '## Prior\n\nUpdated with new info.',
      'comprehensive enough': 'YES — done.',
      'long, detailed, comprehensive': '# Continued\n\nFinal.',
    });
    engineDeps.searchStructured = mockSearch(1);
    engineDeps.fetchAndExtract = mockExtract();

    const priorUrl = 'https://example.com/already-read';
    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      minRounds: 1,
      maxRounds: 2,
    });

    await researcher.research({
      question: 'Refine this?',
      priorReport: '## Prior report',
      priorFindings: [
        {
          url: priorUrl,
          title: 'Old',
          summary: 'Existing finding.',
          evidence: 'Old evidence',
          rational: 'Prior',
        },
      ],
      priorUrls: new Set([priorUrl]),
    });

    assert.ok(researcher.urlsFetched.has(priorUrl));
    assert.ok(researcher.findings.length >= 1);
    assert.equal(researcher.findings[0]?.url, priorUrl);
  });
});
