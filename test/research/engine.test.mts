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
/** @type {typeof engineDeps.searchCodebase} */
let originalCodebaseSearch;
/** @type {typeof engineDeps.extractFromFile} */
let originalExtractFromFile;

afterEach(() => {
  engineDeps.llmCall = originalLlmCall;
  engineDeps.searchStructured = originalSearch;
  engineDeps.fetchAndExtract = originalExtract;
  engineDeps.searchCodebase = originalCodebaseSearch;
  engineDeps.extractFromFile = originalExtractFromFile;
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
    assert.match(String(errorEvents[0].message), /Search engine unavailable/);
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

  test('codebase scope produces file-grounded findings without web search', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;
    originalCodebaseSearch = engineDeps.searchCodebase;
    originalExtractFromFile = engineDeps.extractFromFile;

    let webSearchCalls = 0;
    engineDeps.searchStructured = async () => {
      webSearchCalls += 1;
      return [];
    };
    engineDeps.fetchAndExtract = async () => {
      throw new Error('web extract should not run');
    };
    engineDeps.searchCodebase = async (query) => [
      {
        path: `server/research/${query}.js`,
        title: `${query}.js`,
        snippet: 'class DeepResearcher',
      },
    ];
    engineDeps.extractFromFile = async ({ path }) => ({
      url: path,
      title: path,
      rational: 'Local source',
      evidence: 'export class DeepResearcher',
      summary: 'DeepResearcher lives in the research engine module.',
    });

    engineDeps.llmCall = mockLlmCall({
      'research strategist': '{"sub_questions":["a"],"key_topics":["engine"],"success_criteria":"ok"}',
      'local codebase searches': '["DeepResearcher"]',
      'evolving research report': '## Draft\n\nCode-grounded body.',
      'comprehensive enough': 'YES — enough coverage.',
      'long, detailed, comprehensive': '# Final\n\nCodebase final report.',
    });

    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      scope: 'codebase',
      minRounds: 1,
      maxRounds: 2,
      maxEmptyRounds: 2,
    });

    const result = await researcher.research({ question: 'Where is DeepResearcher defined?' });
    assert.match(result, /Final/);
    assert.equal(webSearchCalls, 0);
    assert.ok(researcher.findings.some((f) => f.url.includes('server/research/')));
  });

  test('codebase scope passes workspaceRoot to searchCodebase', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;
    originalCodebaseSearch = engineDeps.searchCodebase;
    originalExtractFromFile = engineDeps.extractFromFile;

    /** @type {string[]} */
    const roots = [];
    engineDeps.searchStructured = async () => [];
    engineDeps.fetchAndExtract = async () => null;
    engineDeps.searchCodebase = async (_query, opts = {}) => {
      roots.push(String(opts.root ?? ''));
      return [];
    };
    engineDeps.extractFromFile = async () => null;

    engineDeps.llmCall = mockLlmCall({
      'research strategist': '{"sub_questions":["a"],"key_topics":["engine"],"success_criteria":"ok"}',
      'local codebase searches': '["DeepResearcher"]',
      'evolving research report': '## Draft\n\nCode-grounded body.',
      'comprehensive enough': 'YES — enough coverage.',
      'long, detailed, comprehensive': '# Final\n\nCodebase final report.',
    });

    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      scope: 'codebase',
      workspaceRoot: '/tmp/custom-workspace',
      minRounds: 1,
      maxRounds: 1,
      maxEmptyRounds: 2,
    });

    await researcher.research({ question: 'Where is DeepResearcher defined?' });
    assert.ok(roots.some((root) => root.includes('custom-workspace')));
  });

  test('web scope keeps existing web-only behavior', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;
    originalCodebaseSearch = engineDeps.searchCodebase;
    originalExtractFromFile = engineDeps.extractFromFile;

    let codebaseSearchCalls = 0;
    engineDeps.searchCodebase = async () => {
      codebaseSearchCalls += 1;
      return [];
    };
    engineDeps.extractFromFile = async () => {
      throw new Error('codebase extract should not run');
    };
    engineDeps.llmCall = mockLlmCall({
      'research strategist': '{"sub_questions":["a"],"key_topics":["b"],"success_criteria":"ok"}',
      'planning web searches': '["web-only-query"]',
      'evolving research report': '## Draft\n\nWeb body.',
      'comprehensive enough': 'YES — enough coverage.',
      'long, detailed, comprehensive': '# Final\n\nWeb final report.',
    });
    engineDeps.searchStructured = mockSearch(1);
    engineDeps.fetchAndExtract = mockExtract();

    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      scope: 'web',
      minRounds: 1,
      maxRounds: 2,
    });

    const result = await researcher.research({ question: 'Web topic?' });
    assert.match(result, /Web final report/);
    assert.equal(codebaseSearchCalls, 0);
    assert.ok(researcher.urlsFetched.has('https://example.com/web-only-query-0'));
  });

  test('emits planSummary, queryList, and decision events for activity log', async () => {
    originalLlmCall = engineDeps.llmCall;
    originalSearch = engineDeps.searchStructured;
    originalExtract = engineDeps.fetchAndExtract;

    engineDeps.llmCall = mockLlmCall({
      'research strategist':
        '{"sub_questions":["What is it?"],"key_topics":["minnow"],"success_criteria":"clear answer"}',
      Classify: 'general',
      'planning web searches': '["alpha", "beta"]',
      'evolving research report': '## Draft report\n\nBody with citations.',
      'comprehensive enough': 'YES — enough coverage.',
      'long, detailed, comprehensive': '# Final\n\nExpanded final report body.',
    });
    engineDeps.searchStructured = mockSearch(1);
    engineDeps.fetchAndExtract = mockExtract();

    const events = [];
    const researcher = new DeepResearcher({
      providerId: 'p1',
      model: 'm1',
      minRounds: 1,
      maxRounds: 2,
      progressCallback: (event) => events.push(event),
    });

    await researcher.research({ question: 'What is Minnow?' });

    const planningWithSummary = events.find(
      (e) => e.phase === 'planning' && typeof e.planSummary === 'string' && e.planSummary.length > 0,
    );
    assert.ok(planningWithSummary);

    const searchingWithQueries = events.find(
      (e) => e.phase === 'searching' && Array.isArray(e.queryList) && e.queryList.length === 2,
    );
    assert.ok(searchingWithQueries);
    assert.deepEqual(searchingWithQueries.queryList, ['alpha', 'beta']);

    const decision = events.find((e) => e.phase === 'decision');
    assert.ok(decision);
    assert.match(String(decision.message), /Stopping/);
  });
});
