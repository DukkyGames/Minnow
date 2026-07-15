/**
 * Deep Research panel — shared types aligned with server progress + API payloads.
 */

/** Research run lifecycle on the server. */
export type ResearchStatus = 'running' | 'done' | 'error' | 'cancelled';

/** Report category override or auto-detect (empty = auto). */
export type ResearchCategory =
  | ''
  | 'technical'
  | 'academic'
  | 'news'
  | 'market'
  | 'general';

/** Where Deep Research gathers evidence. */
export type ResearchScope = 'web' | 'codebase' | 'both';

/** SSE progress events from `server/research/engine.js` `_emit`. */
export type ResearchProgress =
  | { phase: 'probing'; model: string }
  | { phase: 'planning'; planSummary?: string }
  | {
      phase: 'searching';
      round: number;
      queries?: number;
      queryList?: string[];
      queryCount?: number;
      queryPreview?: string;
      totalSources: number;
    }
  | {
      phase: 'reading';
      round?: number;
      url?: string;
      title?: string;
      summary?: string;
      newSources?: number;
      totalSources: number;
      totalFindings?: number;
    }
  | {
      phase: 'analyzing';
      round: number;
      message?: string;
      totalSources: number;
      totalFindings: number;
    }
  | { phase: 'category'; category: string }
  | { phase: 'decision'; message: string }
  | {
      phase: 'writing';
      message?: string;
      totalSources: number;
      totalFindings: number;
    }
  | { phase: 'warning'; message: string }
  | { phase: 'error'; message: string };

/** Terminal SSE payload when the research stream ends. */
export interface ResearchStreamEndEvent {
  status: 'done' | 'error' | 'cancelled';
  final: true;
  message?: string;
}

/** POST /api/research/start body. */
export interface ResearchStartRequest {
  query: string;
  maxRounds?: number;
  searchProvider?: string;
  category?: ResearchCategory;
  scope?: ResearchScope;
  providerId?: string;
  model?: string;
  continueFrom?: string;
}

/** POST /api/research/start response. */
export interface ResearchStartResponse {
  researchId: string;
}

/** GET /api/research/status/:id response. */
export interface ResearchStatusResponse {
  id: string;
  status: ResearchStatus;
  query?: string;
  progress?: ResearchProgress | null;
  category?: string;
  startedAt?: string;
  completedAt?: string;
}

/** GET /api/research/result/:id response. */
export interface ResearchResultResponse {
  result: string;
  sources: ResearchSource[];
  rawFindings?: unknown[];
  category?: string;
  stats?: ResearchStats;
}

export interface ResearchSource {
  url: string;
  title?: string;
  snippet?: string;
}

export interface ResearchStats {
  rounds?: number;
  sources?: number;
  findings?: number;
  durationSeconds?: number;
}

/** GET /api/research/library list item. */
export interface ResearchLibraryItem {
  id: string;
  query: string;
  status: ResearchStatus;
  category?: string;
  archived?: boolean;
  startedAt?: string;
  completedAt?: string;
  summary?: string;
  sourceCount?: number;
  rounds?: number | string;
  duration?: string;
}

/** GET /api/research/library response. */
export interface ResearchLibraryResponse {
  items: ResearchLibraryItem[];
}

/** GET /api/research/detail/:id — full persisted record. */
export interface ResearchDetailResponse extends ResearchResultResponse {
  id: string;
  query: string;
  status: ResearchStatus;
  archived?: boolean;
  rawReport?: string;
  startedAt?: string;
  completedAt?: string;
  activityLog?: ResearchProgress[];
}

export type ResearchLibrarySort = 'newest' | 'oldest' | 'query';
