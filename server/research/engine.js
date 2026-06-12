/**
 * IterResearch-style deep research engine (port of Odysseus `DeepResearcher`).
 */

import { fetchAndExtract as defaultFetchAndExtract } from './extractor.js';
import { parseJsonArray, parseJsonObject } from './json-parse.js';
import { llmCall as defaultLlmCall } from './llm.js';
import {
  CATEGORY_PROMPTS,
  normalizeResearchCategory,
  QUERY_GEN_PROMPT,
  RESEARCH_PLAN_PROMPT,
  SYNTHESIZE_PROMPT,
  STOP_PROMPT,
  FINAL_REPORT_PROMPT,
  currentDateContext,
  formatPrompt,
} from './prompts.js';
import { getLastSearchError, getLastSearchProvider, searchStructured as defaultSearchStructured } from './search.js';
import { parseStopDecision } from './strip-thinking.js';

/** Default round cap when research.json `maxRounds` is 0 ("Auto"). */
const AUTO_MAX_ROUNDS = 8;

/** Injectable deps for unit tests. */
export const engineDeps = {
  llmCall: defaultLlmCall,
  searchStructured: defaultSearchStructured,
  fetchAndExtract: defaultFetchAndExtract,
};

/**
 * Bounded concurrency helper (asyncio.Semaphore equivalent).
 * @param {number} concurrency
 * @returns {(fn: () => Promise<unknown>) => Promise<unknown>}
 */
export function pLimit(concurrency) {
  const limit = Math.max(1, concurrency);
  let activeCount = 0;
  /** @type {Array<{ fn: () => Promise<unknown>; resolve: (v: unknown) => void; reject: (e: unknown) => void }>} */
  const queue = [];

  const next = () => {
    while (activeCount < limit && queue.length > 0) {
      activeCount += 1;
      const job = queue.shift();
      if (!job) {
        break;
      }
      Promise.resolve()
        .then(() => job.fn())
        .then(
          (value) => {
            activeCount -= 1;
            job.resolve(value);
            next();
          },
          (error) => {
            activeCount -= 1;
            job.reject(error);
            next();
          },
        );
    }
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

/**
 * @typedef {import('./extractor.js').ResearchFinding} ResearchFinding
 */

/**
 * @typedef {object} DeepResearcherOptions
 * @property {string} providerId
 * @property {string} model
 * @property {number} [maxRounds]
 * @property {number} [maxTimeSeconds]
 * @property {number} [maxUrlsPerRound]
 * @property {number} [maxContentChars]
 * @property {number} [maxReportTokens]
 * @property {number} [extractionTimeoutSeconds]
 * @property {number} [planningTimeoutSeconds]
 * @property {number} [queryTimeoutSeconds]
 * @property {number} [extractionConcurrency]
 * @property {number} [minRounds]
 * @property {number} [maxEmptyRounds]
 * @property {number} [synthesisWindow]
 * @property {(event: Record<string, unknown>) => void} [progressCallback]
 * @property {string} [searchProvider]
 * @property {string} [category]
 */

export class DeepResearcher {
  /**
   * @param {DeepResearcherOptions} options
   */
  constructor(options) {
    this.providerId = options.providerId;
    this.model = options.model;
    this.searchProviderOverride = options.searchProvider?.trim() ?? '';
    this.category = normalizeResearchCategory(options.category?.trim() ?? '');
    this.maxRounds =
      options.maxRounds && options.maxRounds > 0 ? options.maxRounds : AUTO_MAX_ROUNDS;
    this.maxTime = options.maxTimeSeconds ?? 300;
    this.maxUrlsPerRound = options.maxUrlsPerRound ?? 3;
    this.maxContentChars = options.maxContentChars ?? 15_000;
    this.maxReportTokens = options.maxReportTokens ?? 8192;
    this.extractionTimeout = Math.min(
      3600,
      Math.max(15, Number(options.extractionTimeoutSeconds ?? 90)),
    );
    this.planningTimeout = Math.min(3600, Math.max(15, Number(options.planningTimeoutSeconds ?? 90)));
    this.queryTimeout = Math.min(3600, Math.max(15, Number(options.queryTimeoutSeconds ?? 120)));
    this.extractionConcurrency = Math.min(
      12,
      Math.max(1, Number(options.extractionConcurrency ?? 3)),
    );
    this.minRounds = options.minRounds ?? 3;
    this.maxEmptyRounds = options.maxEmptyRounds ?? 2;
    this.synthesisWindow = options.synthesisWindow ?? 10;
    this._progress = options.progressCallback ?? null;

    this._cancelled = false;
    /** @type {number} */
    this._startTime = 0;
    /** @type {Set<string>} */
    this.queriesUsed = new Set();
    /** @type {Set<string>} */
    this.urlsFetched = new Set();
    this.roundCount = 0;
    /** @type {string[]} */
    this.providersUsed = [];
    /** @type {ResearchFinding[]} */
    this.findings = [];
    this.evolvingReport = '';
    this.researchPlan = '';
    this._lastSearchError = '';
  }

  cancel() {
    this._cancelled = true;
  }

  /**
   * @param {Record<string, unknown>} event
   */
  emitProgress(event) {
    if (!this._progress) {
      return;
    }
    try {
      this._progress(event);
    } catch {
      /* ignore callback errors */
    }
  }

  /**
   * @param {Record<string, unknown>} kwargs Odysseus-style snake_case keys from the port
   */
  _emit(kwargs) {
    /** @type {Record<string, unknown>} */
    const event = { phase: kwargs.phase };
    if (kwargs.round !== undefined) {
      event.round = kwargs.round;
    }
    if (kwargs.queries !== undefined) {
      event.queries = kwargs.queries;
    }
    if (kwargs.query_preview !== undefined) {
      event.queryPreview = kwargs.query_preview;
    }
    if (kwargs.total_sources !== undefined) {
      event.totalSources = kwargs.total_sources;
    }
    if (kwargs.new_sources !== undefined) {
      event.newSources = kwargs.new_sources;
    }
    if (kwargs.total_findings !== undefined) {
      event.totalFindings = kwargs.total_findings;
    }
    if (kwargs.url !== undefined) {
      event.url = kwargs.url;
    }
    if (kwargs.title !== undefined) {
      event.title = kwargs.title;
    }
    if (kwargs.message !== undefined) {
      event.message = kwargs.message;
    }
    this.emitProgress(event);
  }

  _timeExceeded() {
    return Date.now() / 1000 - this._startTime > this.maxTime;
  }

  /**
   * @param {Array<{ role: string, content: string }>} messages
   * @param {object} [opts]
   * @param {number} [opts.temperature]
   * @param {number} [opts.maxTokens]
   * @param {number} [opts.timeoutSeconds]
   * @param {AbortSignal} [opts.signal]
   * @returns {Promise<string>}
   */
  async _llm(messages, opts = {}) {
    const {
      temperature = 0.3,
      maxTokens = 4096,
      timeoutSeconds = 60,
      signal,
    } = opts;
    return engineDeps.llmCall({
      providerId: this.providerId,
      model: this.model,
      messages,
      temperature,
      maxTokens,
      timeoutMs: timeoutSeconds * 1000,
      signal,
    });
  }

  /**
   * @param {object} params
   * @param {string} params.question
   * @param {string} [params.priorReport]
   * @param {ResearchFinding[]} [params.priorFindings]
   * @param {Set<string> | string[]} [params.priorUrls]
   * @param {AbortSignal} [params.signal]
   * @returns {Promise<string>}
   */
  async research({
    question,
    priorReport = '',
    priorFindings = null,
    priorUrls = null,
    signal,
  }) {
    this._startTime = Date.now() / 1000;
    /** @type {ResearchFinding[]} */
    const findings = priorFindings ? [...priorFindings] : [];
    let report = priorReport || '';

    this._emit({ phase: 'planning' });
    this.researchPlan = await this.createPlan(question, signal);
    if (!priorReport && !this.category) {
      const detected = await this.classifyCategory(question, signal);
      if (detected) {
        this.category = detected;
      }
    }

    if (priorUrls) {
      for (const url of priorUrls) {
        this.urlsFetched.add(url);
      }
    }

    this.findings = findings;
    let consecutiveEmptyRounds = 0;

    for (let roundNum = 1; roundNum <= this.maxRounds; roundNum += 1) {
      this.roundCount = roundNum;
      if (this._cancelled) {
        break;
      }
      if (this._timeExceeded()) {
        break;
      }

      this._emit({
        phase: 'searching',
        round: roundNum,
        total_sources: this.urlsFetched.size,
      });

      const queries = await this.generateQueries(question, report, roundNum, signal);
      if (!queries.length) {
        break;
      }

      this._emit({
        phase: 'searching',
        round: roundNum,
        queries: queries.length,
        query_preview: queries[0] ?? '',
        total_sources: this.urlsFetched.size,
      });

      const roundFindings = await this.searchAndExtract(queries, question, signal);
      if (roundFindings.length) {
        findings.push(...roundFindings);
        consecutiveEmptyRounds = 0;
        this._emit({
          phase: 'reading',
          round: roundNum,
          new_sources: roundFindings.length,
          total_sources: this.urlsFetched.size,
          total_findings: findings.length,
        });
      } else {
        consecutiveEmptyRounds += 1;
        if (consecutiveEmptyRounds >= this.maxEmptyRounds) {
          const errDetail = this._lastSearchError || getLastSearchError() || 'unknown error';
          this._emit({
            phase: 'error',
            message: `Search engine unavailable: ${errDetail}`,
          });
          if (!findings.length) {
            return (
              `**Search unavailable** — Web search failed after ` +
              `${roundNum} rounds. Error: ${errDetail}\n\n` +
              'Please check your search provider settings and ensure the service is running.'
            );
          }
          break;
        }
      }

      if (findings.length) {
        this._emit({
          phase: 'analyzing',
          round: roundNum,
          total_sources: this.urlsFetched.size,
          total_findings: findings.length,
        });
        report = await this.synthesize(question, findings, report, signal);
      }

      if (roundNum >= this.minRounds) {
        const stop = await this.shouldStop(question, report, roundNum, signal);
        if (stop) {
          break;
        }
      }
    }

    this._emit({
      phase: 'writing',
      total_sources: this.urlsFetched.size,
      total_findings: findings.length,
    });

    if (!report) {
      if (findings.length) {
        return this.fallbackReport(question, findings);
      }
      return 'No information could be gathered for this question.';
    }

    this.evolvingReport = report;
    return this.finalReport(question, report, signal);
  }

  /**
   * @param {string} question
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async createPlan(question, signal) {
    const prompt = currentDateContext() + formatPrompt(RESEARCH_PLAN_PROMPT, { question });
    try {
      const response = await this._llm([{ role: 'user', content: prompt }], {
        temperature: 0.3,
        maxTokens: 1024,
        timeoutSeconds: this.planningTimeout,
        signal,
      });
      const parsed = parseJsonObject(response);
      if (parsed) {
        /** @type {string[]} */
        const parts = [];
        if (Array.isArray(parsed.sub_questions)) {
          parts.push(`Sub-questions: ${parsed.sub_questions.map(String).join('; ')}`);
        }
        if (Array.isArray(parsed.key_topics)) {
          parts.push(`Key topics: ${parsed.key_topics.map(String).join(', ')}`);
        }
        if (parsed.success_criteria) {
          parts.push(`Success: ${String(parsed.success_criteria)}`);
        }
        return parts.length ? parts.join('\n') : response;
      }
      return response;
    } catch {
      this._emit({
        phase: 'warning',
        message: 'Planning step failed, proceeding with direct search',
      });
      return '';
    }
  }

  /**
   * @param {string} question
   * @param {AbortSignal} [signal]
   * @returns {Promise<string | null>}
   */
  async classifyCategory(question, signal) {
    const valid = Object.keys(CATEGORY_PROMPTS).join(', ');
    const prompt =
      `Classify this research question into exactly ONE category.\n` +
      `Categories: ${valid}\n` +
      `Valid categories: technical, academic, news, market, general.\n` +
      `If none fit well, respond with: general\n\n` +
      `Question: ${question}\n\n` +
      `Respond with ONLY the category name, nothing else.`;

    try {
      const result = await this._llm([{ role: 'user', content: prompt }], {
        temperature: 0,
        maxTokens: 20,
        timeoutSeconds: 15,
        signal,
      });
      const cat = (result || '').trim().toLowerCase();
      const first = cat.split(/\s+/)[0]?.replace(/[.,"'*:]/g, '') ?? '';
      return normalizeResearchCategory(first || cat) || 'general';
    } catch {
      return null;
    }
  }

  /**
   * @param {string} question
   * @param {string} report
   * @param {number} roundNum
   * @param {AbortSignal} [signal]
   * @returns {Promise<string[]>}
   */
  async generateQueries(question, report, roundNum, signal) {
    const numQueries = roundNum === 1 ? 4 : 3;
    const roundInstruction =
      roundNum === 1
        ? 'This is the first round — generate broad, diverse queries that explore the key facets of the question.'
        : 'We already have partial findings.  Generate targeted follow-up queries to fill gaps, verify claims, or explore specific aspects that the report does not yet cover well.';

    const prompt =
      currentDateContext() +
      formatPrompt(QUERY_GEN_PROMPT, {
        question,
        research_plan: this.researchPlan || '(No plan — search broadly.)',
        report: report || '(No findings yet.)',
        round_num: roundNum,
        num_queries: numQueries,
        round_instruction: roundInstruction,
      });

    try {
      const response = await this._llm([{ role: 'user', content: prompt }], {
        temperature: 0.5,
        maxTokens: 4096,
        timeoutSeconds: this.queryTimeout,
        signal,
      });
      const queries = parseJsonArray(response);
      const newQueries = queries.filter((q) => !this.queriesUsed.has(q));
      for (const q of newQueries) {
        this.queriesUsed.add(q);
      }
      return newQueries;
    } catch (err) {
      this._emit({
        phase: 'warning',
        message: `Query generation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return [];
    }
  }

  /**
   * @param {string} query
   * @param {AbortSignal} [signal]
   * @returns {Promise<import('../tools/search-result.js').SearchResult[]>}
   */
  async search(query) {
    const provider = this.searchProviderOverride || undefined;
    const results = await engineDeps.searchStructured(query, {
      provider: /** @type {import('./search.js').SearchProviderId | undefined} */ (provider),
    });
    const used = getLastSearchProvider();
    if (results.length && used && !this.providersUsed.includes(used)) {
      this.providersUsed.push(used);
    }
    if (!results.length) {
      this._lastSearchError = getLastSearchError() || this._lastSearchError;
    }
    return results;
  }

  /**
   * @param {string[]} queries
   * @param {string} question
   * @param {AbortSignal} [signal]
   * @returns {Promise<ResearchFinding[]>}
   */
  async searchAndExtract(queries, question, signal) {
    /** @type {ResearchFinding[]} */
    const allFindings = [];

    const searchResults = await Promise.all(
      queries.map((q) =>
        this.search(q).catch((err) => {
          this._lastSearchError = err instanceof Error ? err.message : String(err);
          return [];
        }),
      ),
    );

    /** @type {import('../tools/search-result.js').SearchResult[]} */
    const urlsToFetch = [];
    for (const result of searchResults) {
      if (!result?.length) {
        continue;
      }
      for (const row of result) {
        const url = row.url || '';
        if (url && !this.urlsFetched.has(url)) {
          urlsToFetch.push(row);
          this.urlsFetched.add(url);
        }
        if (urlsToFetch.length >= this.maxUrlsPerRound * queries.length) {
          break;
        }
      }
    }

    if (this._cancelled || this._timeExceeded()) {
      return allFindings;
    }

    const limit = pLimit(this.extractionConcurrency);
    const extractResults = await Promise.all(
      urlsToFetch.map((row) =>
        limit(async () => {
          const display = row.title || row.url;
          this._emit({
            phase: 'reading',
            url: row.url,
            title: display,
            total_sources: this.urlsFetched.size,
          });
          return engineDeps.fetchAndExtract({
            url: row.url,
            question,
            title: row.title,
            providerId: this.providerId,
            model: this.model,
            maxContentChars: this.maxContentChars,
            extractionTimeoutSeconds: this.extractionTimeout,
            signal,
          });
        }),
      ),
    );

    for (const result of extractResults) {
      if (result) {
        allFindings.push(result);
      }
    }

    return allFindings;
  }

  /**
   * @param {string} question
   * @param {ResearchFinding[]} findings
   * @param {string} currentReport
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async synthesize(question, findings, currentReport, signal) {
    const window = findings.slice(-this.synthesisWindow);
    const findingsText = this.formatFindings(window);

    const prompt = formatPrompt(SYNTHESIZE_PROMPT, {
      question,
      report: currentReport || '(First round — no report yet.)',
      new_findings: findingsText,
    });

    try {
      return await this._llm([{ role: 'user', content: prompt }], {
        temperature: 0.3,
        maxTokens: this.maxReportTokens,
        timeoutSeconds: 180,
        signal,
      });
    } catch {
      this._emit({
        phase: 'warning',
        message: 'Synthesis failed, keeping previous report',
      });
      return currentReport;
    }
  }

  /**
   * @param {string} question
   * @param {string} report
   * @param {number} roundNum
   * @param {AbortSignal} [signal]
   * @returns {Promise<boolean>}
   */
  async shouldStop(question, report, roundNum, signal) {
    const prompt = formatPrompt(STOP_PROMPT, {
      question,
      report,
      round_num: roundNum,
    });

    try {
      const response = await this._llm([{ role: 'user', content: prompt }], {
        temperature: 0.1,
        maxTokens: 128,
        timeoutSeconds: 60,
        signal,
      });
      return parseStopDecision(response);
    } catch {
      return false;
    }
  }

  /**
   * @param {string} question
   * @param {string} report
   * @param {AbortSignal} [signal]
   * @returns {Promise<string>}
   */
  async finalReport(question, report, signal) {
    let prompt = formatPrompt(FINAL_REPORT_PROMPT, { question, report });
    const catExtra = CATEGORY_PROMPTS[this.category] ?? '';
    if (catExtra) {
      prompt += `\n\n${catExtra}`;
    }

    try {
      let result = await this._llm([{ role: 'user', content: prompt }], {
        temperature: 0.3,
        maxTokens: this.maxReportTokens,
        timeoutSeconds: 180,
        signal,
      });

      if (result.split(/\s+/).filter(Boolean).length < 400) {
        this._emit({
          phase: 'writing',
          message: 'Expanding report...',
          total_sources: this.urlsFetched.size,
          total_findings: this.findings.length,
        });
        const expanded = await this._llm(
          [
            { role: 'user', content: prompt },
            { role: 'assistant', content: result },
            {
              role: 'user',
              content:
                'This report is too brief. Please expand it significantly:\n' +
                '- Add detailed paragraphs for each section (not just bullet points)\n' +
                '- Include specific data, numbers, and comparisons from the evidence\n' +
                "- Explain context and significance — don't just list facts\n" +
                '- Use ## headings and ### subheadings\n' +
                '- Target at least 1000 words\n' +
                'Write the full expanded report now.',
            },
          ],
          {
            temperature: 0.4,
            maxTokens: this.maxReportTokens,
            timeoutSeconds: 180,
            signal,
          },
        );
        if (expanded.split(/\s+/).filter(Boolean).length > result.split(/\s+/).filter(Boolean).length) {
          result = expanded;
        }
      }

      return result;
    } catch {
      return report;
    }
  }

  /**
   * @param {ResearchFinding[]} findings
   * @returns {string}
   */
  formatFindings(findings) {
    const parts = [];
    for (let i = 0; i < findings.length; i += 1) {
      const f = findings[i];
      const url = f.url || 'unknown';
      const title = f.title || '';
      const summary = f.summary || '';
      const evidence = f.evidence || '';
      const content = summary || (evidence ? evidence.slice(0, 1000) : '(no content)');
      parts.push(`**Finding ${i + 1}** — [${title}](${url})\n${content}`);
    }
    return parts.join('\n\n');
  }

  /**
   * @param {string} question
   * @param {ResearchFinding[]} findings
   * @returns {string}
   */
  fallbackReport(question, findings) {
    return (
      `# ${question}\n\n` +
      '_Automatic synthesis did not complete, so this report lists the ' +
      `${findings.length} finding(s) gathered during research._\n\n` +
      `${this.formatFindings(findings)}`
    );
  }

  /**
   * @returns {Record<string, string | number>}
   */
  getStats() {
    const elapsed = this._startTime ? Date.now() / 1000 - this._startTime : 0;
    /** @type {Record<string, string | number>} */
    const stats = {
      Duration: `${elapsed.toFixed(1)}s`,
      Rounds: this.roundCount,
      Queries: this.queriesUsed.size,
      URLs: this.urlsFetched.size,
      Model: this.model,
    };
    if (this.providersUsed.length) {
      stats.Search = this.providersUsed.join(', ');
    }
    if (this.category) {
      const label = this.category.charAt(0).toUpperCase() + this.category.slice(1);
      stats.Category = label;
    }
    return stats;
  }
}
