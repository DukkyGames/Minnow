/**
 * Deep Research server module — public exports for store/routes (Phase 4+).
 */

export { DeepResearcher, engineDeps, pLimit } from './engine.js';
export {
  startResearch,
  cancelResearch,
  getResearchTask,
  getResearchStatus,
  getResearchResult,
  getResearchDetail,
  listResearchLibrary,
  setResearchArchived,
  deleteResearch,
  loadResearchFromDisk,
  resolveResearchModel,
  extractSources,
  extractRawFindings,
  isResearchId,
  createResearchId,
  RESEARCH_ID_RE,
  getResearchDataDir,
  getResearchFilePath,
  addSubscriber,
  removeSubscriber,
} from './store.js';
export { createResearchMiddleware, handleResearchRequest } from './routes.js';
export { generateVisualReport } from './visual-report.js';
export { fetchAndExtract, extractorDeps, fetchResearchPageText, truncateAtParagraph } from './extractor.js';
export { llmCall, llmCallDeps, extractCompletionText } from './llm.js';
export {
  searchStructured,
  loadSearchSettings,
  buildProviderChain,
  getLastSearchError,
  getLastSearchProvider,
} from './search.js';
export { getSearch, setSearch, getPage, setPage, getResearchCacheDir, RESEARCH_CACHE_TTL_MS } from './cache.js';
export { prepareResearchFetchUrl } from './fetch-prep.js';
export {
  stripThinking,
  stripThink,
  isLowQuality,
  parseStopDecision,
  LOW_QUALITY_MARKERS,
} from './strip-thinking.js';
export { parseJsonArray, parseJsonObject, stripCodeBlock } from './json-parse.js';
export {
  currentDateContext,
  RESEARCH_PLAN_PROMPT,
  QUERY_GEN_PROMPT,
  SYNTHESIZE_PROMPT,
  STOP_PROMPT,
  FINAL_REPORT_PROMPT,
  CATEGORY_PROMPTS,
  EXTRACTOR_PROMPT,
  formatPrompt,
} from './prompts.js';
