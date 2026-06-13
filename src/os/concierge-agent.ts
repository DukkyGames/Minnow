/**
 * Smart concierge planner — structured LLM routing with keyword fallback.
 */

import { extractMessageText } from '../api/chat';
import { extractJsonTextFromAssistantBody } from '../agents/sub-agent-structured-outcome';
import { normalizeModeId, type ModeId } from '../chat/modes/types';
import { fetchWorkspace, type WorkspaceRecentItem } from '../config/workspace-api';
import { decodeModelSelectKey } from '../lib/model-select-key';
import { createTitleProviderPort } from '../chat/titles/provider-port';
import type { TitleProviderPort } from '../chat/titles/types';
import { APPS, isAppId } from './app-registry';
import { buildConciergeMessages } from './concierge-prompt';
import { sanitizeConciergeSeed, stripSeedFiller } from './concierge-seed';
import { isCodeWorkspaceTask, routeIntent } from './intent-routing';
import type { AppId, LaunchOptions } from './types';

/** Resolved plan from the concierge agent (maps to LaunchOptions + appId). */
export interface ConciergePlan extends LaunchOptions {
  appId: AppId;
}

export interface ConciergeAgentOptions {
  /** Override LLM port (tests). */
  port?: TitleProviderPort;
  /** Override workspace fetch (tests). */
  fetchWorkspaceImpl?: typeof fetchWorkspace;
  /** Abort signal for the planner call. */
  signal?: AbortSignal;
  /** Planner timeout in ms (default 8000). */
  timeoutMs?: number;
}

interface RawConciergeResponse {
  app_id?: unknown;
  seed?: unknown;
  mode_id?: unknown;
  workspace_index?: unknown;
  auto_run?: unknown;
  settings_section?: unknown;
}

const RESEARCH_ACTION_RE =
  /(research|investigate|look into|deep dive|stock|market|compare|gather sources)/i;

const CODE_ACTION_RE = /(fix|debug|bug|implement|build|refactor|ship|find)/i;

/** Read model id from the top-bar composite select (same binding as new chats). */
function readTopBarModelId(): string | undefined {
  const raw = (document.getElementById('modelSelect') as HTMLSelectElement | null)?.value ?? '';
  const parsed = decodeModelSelectKey(raw);
  return (parsed?.modelId ?? raw).trim() || undefined;
}

/** Build indexed recent workspace list for the prompt. */
function indexRecentWorkspaces(
  recent: WorkspaceRecentItem[] | undefined,
): Array<WorkspaceRecentItem & { index: number }> {
  if (!recent?.length) return [];
  return recent.map((item, index) => ({ ...item, index }));
}

/** Match a recent workspace when the user names a project in free text. */
function matchWorkspaceFromUserText(
  userText: string,
  recent: Array<WorkspaceRecentItem & { index: number }>,
): string | undefined {
  const t = userText.toLowerCase();
  for (const ws of recent) {
    if (!ws.exists) continue;
    const label = ws.label.toLowerCase().trim();
    if (label.length >= 3 && t.includes(label)) return ws.path.trim();
    const stem = label.replace(/(?:-app|-project|\/.*)$/i, '').trim();
    if (stem.length >= 3 && t.includes(stem)) return ws.path.trim();
  }
  return undefined;
}

/** Correct misrouted Chat/Research plans and fill missing Code launch fields. */
function finalizeConciergePlan(
  plan: ConciergePlan,
  userText: string,
  recent: Array<WorkspaceRecentItem & { index: number }> = [],
): ConciergePlan {
  const trimmed = userText.trim();
  let appId = plan.appId;
  let seed = plan.seed?.trim();
  let autoRun = plan.autoRun;
  let modeId = plan.modeId;
  let workspacePath = plan.workspacePath;

  if ((appId === 'chat' || appId === 'research') && isCodeWorkspaceTask(trimmed)) {
    appId = 'code';
  }

  if (appId === 'code') {
    if (!modeId && /\b(bugs?|debug|fix|errors?)\b/i.test(trimmed)) {
      modeId = 'debug';
    }
    if (!workspacePath && recent.length > 0) {
      workspacePath = matchWorkspaceFromUserText(trimmed, recent);
    }
    if (isCodeWorkspaceTask(trimmed)) {
      if (!seed) seed = stripSeedFiller(trimmed);
      if (autoRun !== true) autoRun = true;
    }
  }

  const sanitized = sanitizeConciergeSeed({
    userText: trimmed,
    seed,
    appId,
    autoRun,
  });

  const finalized: ConciergePlan = { appId, ...sanitized };
  if (modeId && appId === 'code') finalized.modeId = modeId;
  if (workspacePath) finalized.workspacePath = workspacePath;
  return finalized;
}

/** Heuristic auto_run when falling back to keyword routing. */
function fallbackAutoRun(appId: AppId, text: string, seed?: string): boolean | undefined {
  if (appId === 'research' && seed?.trim() && RESEARCH_ACTION_RE.test(text)) return true;
  if (appId === 'code' && seed?.trim() && CODE_ACTION_RE.test(text)) return true;
  return undefined;
}

/** Keyword-only fallback plan when the LLM is unavailable or returns invalid JSON. */
export function fallbackConciergePlan(
  userText: string,
  recent: Array<WorkspaceRecentItem & { index: number }> = [],
): ConciergePlan {
  const trimmed = userText.trim();
  const appId = routeIntent(trimmed);
  let seed = trimmed || undefined;
  let autoRun = fallbackAutoRun(appId, trimmed, seed);
  const draft: ConciergePlan = { appId };

  if (seed) draft.seed = seed;
  if (autoRun !== undefined) draft.autoRun = autoRun;
  if (appId === 'code' && /\b(bugs?|debug|fix|errors?)\b/i.test(trimmed)) {
    draft.modeId = 'debug';
  }

  return finalizeConciergePlan(draft, trimmed, recent);
}

function parseRawConciergeJson(text: string): RawConciergeResponse | null {
  try {
    const jsonText = extractJsonTextFromAssistantBody(text);
    return JSON.parse(jsonText) as RawConciergeResponse;
  } catch {
    return null;
  }
}

function resolveWorkspacePath(
  index: unknown,
  recent: Array<WorkspaceRecentItem & { index: number }>,
): string | undefined {
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) return undefined;
  const entry = recent.find((w) => w.index === index);
  if (!entry?.exists || !entry.path?.trim()) return undefined;
  return entry.path.trim();
}

/** Validate raw LLM JSON into a ConciergePlan; returns null when app_id is invalid. */
export function validateConciergePlan(
  raw: RawConciergeResponse,
  recent: Array<WorkspaceRecentItem & { index: number }>,
  userText = '',
): ConciergePlan | null {
  const appRaw = typeof raw.app_id === 'string' ? raw.app_id.trim() : '';
  if (!isAppId(appRaw)) return null;

  const seed =
    typeof raw.seed === 'string' && raw.seed.trim() ? raw.seed.trim() : undefined;
  const modeId =
    typeof raw.mode_id === 'string' && raw.mode_id.trim()
      ? normalizeModeId(raw.mode_id.trim())
      : undefined;
  const workspacePath = resolveWorkspacePath(raw.workspace_index, recent);
  const settingsSection =
    typeof raw.settings_section === 'string' && raw.settings_section.trim()
      ? raw.settings_section.trim()
      : undefined;

  let autoRun: boolean | undefined;
  if (typeof raw.auto_run === 'boolean') autoRun = raw.auto_run;

  const plan: ConciergePlan = { appId: appRaw, seed };
  if (modeId && appRaw === 'code') plan.modeId = modeId;
  if (workspacePath) plan.workspacePath = workspacePath;
  if (settingsSection) plan.settingsSection = settingsSection;

  if (autoRun !== undefined) {
    plan.autoRun = autoRun;
  } else if (appRaw === 'research' && seed) {
    plan.autoRun = true;
  }

  const sanitized = sanitizeConciergeSeed({
    userText,
    seed: plan.seed,
    appId: appRaw,
    autoRun: plan.autoRun,
  });
  plan.seed = sanitized.seed;
  plan.autoRun = sanitized.autoRun;

  return plan;
}

/** Call the LLM once to produce a structured concierge plan. */
async function callConciergePlanner(
  userText: string,
  recent: Array<WorkspaceRecentItem & { index: number }>,
  port: TitleProviderPort,
  signal: AbortSignal,
): Promise<ConciergePlan | null> {
  const modelId = readTopBarModelId();
  if (!modelId) return null;

  const messages = buildConciergeMessages(userText, {
    recentWorkspaces: recent,
    modelId,
  });

  const chunk = await port.complete(
    {
      model: modelId,
      messages,
      temperature: 0.1,
      max_tokens: 256,
    },
    signal,
  );

  const body = extractMessageText(chunk.choices?.[0]?.message).trim();
  if (!body) return null;

  const raw = parseRawConciergeJson(body);
  if (!raw) return null;
  return validateConciergePlan(raw, recent, userText);
}

/**
 * Resolve a concierge plan for free-text input.
 * Falls back to keyword routing when the model, server, or JSON parse fails.
 */
export async function resolveConciergePlan(
  userText: string,
  options: ConciergeAgentOptions = {},
): Promise<ConciergePlan> {
  const trimmed = userText.trim();
  if (!trimmed) return fallbackConciergePlan('');

  const fetchImpl = options.fetchWorkspaceImpl ?? fetchWorkspace;
  const wsInfo = await fetchImpl();
  const recent = indexRecentWorkspaces(wsInfo?.recent);

  const timeoutMs = options.timeoutMs ?? 8000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const signal = options.signal ?? controller.signal;

  try {
    const port = options.port ?? createTitleProviderPort();
    const plan = await callConciergePlanner(trimmed, recent, port, signal);
    if (plan) return finalizeConciergePlan(plan, trimmed, recent);
  } catch {
    /* fall through to keyword routing */
  } finally {
    clearTimeout(timeout);
  }

  return fallbackConciergePlan(trimmed, recent);
}

/** App catalog ids exposed for tests. */
export const CONCIERGE_APP_IDS: readonly AppId[] = APPS.map((a) => a.id);

/** Normalize mode id helper re-export for tests. */
export { normalizeModeId };
export type { ModeId };
