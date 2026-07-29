/**
 * Pre-flight user approval for browser_navigate when the URL is outside the allowlist.
 * Uses the ask_question card UI (same option ids as tool-usage/browser-allowlist prompts).
 */

import {
  approveBrowserNavigation,
  checkBrowserNavigationAllowed,
  loadBrowserMeta,
} from '../config/browser-meta';
import { isNavigationAllowed } from './browser-allowlist-match';
import { enqueueAskQuestion } from './ask-question-queue';
import {
  acquireUserPromptLock,
  releaseUserPromptLock,
} from '../ui/user-prompt-lock';
import type { ToolApprovalContext } from './approval-queue';
import type { AskQuestionArgs, AskQuestionToolResult } from './ask-question-types';
import { isLocalServerAvailable } from './config';
import type { ToolExecutionResult } from '../types';
import { blockAfkInteractionAttempt } from './permission-gate';

export const ALLOWLIST_QUESTION_ID = 'browser_allow_origin';

/** Option ids must match src/chat/prompts/tool-usage/browser-allowlist.md */
const DECISION_ONCE = 'once';
const DECISION_PERSIST = 'persist';
const DECISION_DENY = 'deny';

export type BrowserAllowlistDecision = 'once' | 'persist' | 'deny';

/** Map model/UI option ids (including "always allow" aliases) to allowlist decisions. */
export function normalizeBrowserAllowlistDecision(raw: string | undefined): BrowserAllowlistDecision | null {
  if (!raw?.trim()) return null;
  const lower = raw.trim().toLowerCase();
  if (lower === DECISION_ONCE || lower === 'allow_once' || lower === 'allow-once') {
    return DECISION_ONCE;
  }
  if (
    lower === DECISION_PERSIST ||
    lower === 'always_allow' ||
    lower === 'always-allow' ||
    lower === 'alwaysallow' ||
    lower === 'add_to_allowlist' ||
    lower === 'add-to-allowlist'
  ) {
    return DECISION_PERSIST;
  }
  if (lower === DECISION_DENY || lower === 'no' || lower === 'cancel') {
    return DECISION_DENY;
  }
  return null;
}

/** Pull an http(s) target from browser allowlist ask_question prompt text. */
export function extractBrowserAllowlistTargetUrl(prompt: string): string | null {
  const text = prompt.trim();
  if (!text) return null;

  const allowNavMatch = /allow browser navigation to\s+(.+?)\s*\??$/i.exec(text);
  if (allowNavMatch?.[1]) {
    const candidate = allowNavMatch[1].trim();
    if (candidate) {
      return candidate.includes('://') ? candidate : `https://${candidate}`;
    }
  }

  const urlMatch = /https?:\/\/[^\s'"<>]+/i.exec(text);
  return urlMatch?.[0] ?? null;
}

function questionLooksLikeBrowserAllowlist(
  questionId: string,
  optionIds: Set<string>,
): boolean {
  if (questionId === ALLOWLIST_QUESTION_ID) return true;
  return optionIds.has(DECISION_ONCE) && (optionIds.has(DECISION_PERSIST) || optionIds.has(DECISION_DENY));
}

/**
 * When ask_question collected browser allowlist consent, persist the choice immediately
 * (do not rely on the model to call request_browser_origin_access afterward).
 */
export async function applyBrowserAllowlistFromAskQuestion(
  args: AskQuestionArgs,
  result: AskQuestionToolResult,
): Promise<void> {
  if (result.status !== 'answered' || !isLocalServerAvailable()) return;

  for (const question of args.questions) {
    const entry = result.answers.find((a) => a.questionId === question.id);
    const selected = entry?.selectedIds[0];
    const decision = normalizeBrowserAllowlistDecision(selected);
    if (!decision || decision === DECISION_DENY) continue;

    const optionIds = new Set(question.options.map((o) => o.id));
    if (!questionLooksLikeBrowserAllowlist(question.id, optionIds)) continue;

    const url = extractBrowserAllowlistTargetUrl(question.prompt);
    if (!url) continue;

    const mode = decision === DECISION_PERSIST ? 'persist' : 'once';
    await approveBrowserNavigation(url, mode);
    return;
  }
}

/**
 * Shows ask_question cards for a blocked origin; returns null when navigation may proceed.
 */
export async function maybeBlockBrowserNavigation(
  url: string,
  context: ToolApprovalContext = {},
): Promise<ToolExecutionResult | null> {
  if (typeof document === 'undefined') {
    return null;
  }

  if (!isLocalServerAvailable()) {
    return null;
  }

  const meta = await loadBrowserMeta();
  if (!meta.enabled) {
    return {
      content: 'Error: browser automation is disabled in Settings → Tools → Browser.',
    };
  }
  if (!meta.allowNavigate) {
    return {
      content:
        'Error: browser navigation is disabled in Settings → Tools (enable “Allow navigation”).',
    };
  }

  if (isNavigationAllowed(url, meta.allowedOriginPatterns)) {
    return null;
  }

  const check = await checkBrowserNavigationAllowed(url);
  if (!check) {
    return {
      content:
        'Error: Could not verify browser allowlist (is npm start running?). Retry browser_navigate after the server is up.',
    };
  }
  if (check.allowed) {
    return null;
  }
  const afkBlocked = blockAfkInteractionAttempt(
    context,
    'confirmation',
    `browser_navigate requires origin approval for ${check.origin}`,
  );
  if (afkBlocked) return afkBlocked;

  acquireUserPromptLock();
  let raw: string;
  try {
    raw = await enqueueAskQuestion(
      {
        title: 'Browser navigation',
        questions: [
          {
            id: ALLOWLIST_QUESTION_ID,
            prompt: `Allow browser navigation to ${check.origin}?`,
            options: [
              {
                id: DECISION_ONCE,
                label: 'Allow once',
                description: 'Open this URL one time only',
              },
              {
                id: DECISION_PERSIST,
                label: 'Add to allowlist',
                description: `Save pattern: ${check.suggestedPattern}`,
              },
              {
                id: DECISION_DENY,
                label: 'Do not allow',
                description: 'Skip navigation',
              },
            ],
          },
        ],
      },
      { subAgentType: context.subAgentType },
      context.chatId,
    );
  } finally {
    releaseUserPromptLock();
  }

  let parsed: AskQuestionToolResult;
  try {
    parsed = JSON.parse(raw) as AskQuestionToolResult;
  } catch {
    return { content: 'Error: invalid ask_question response for browser allowlist' };
  }

  if (parsed.status === 'cancelled') {
    return {
      content:
        `Error: User cancelled browser navigation to ${url}. ` +
        'Do not retry without a new ask_question or user instruction.',
    };
  }
  if (parsed.status === 'error') {
    return { content: `Error: ${parsed.message}` };
  }

  const entry = parsed.answers.find((a) => a.questionId === ALLOWLIST_QUESTION_ID);
  const decision = normalizeBrowserAllowlistDecision(entry?.selectedIds[0]);
  if (!decision || decision === DECISION_DENY) {
    return {
      content:
        `Error: User denied browser navigation to ${url}. ` +
        'Respect the denial; do not navigate unless they ask again.',
    };
  }

  const recheck = await checkBrowserNavigationAllowed(url);
  if (!recheck?.allowed) {
    return {
      content: 'Error: Could not update browser allowlist (is npm start running?)',
    };
  }

  return null;
}

/**
 * Apply a prior ask_question decision without showing the cards again.
 */
export async function applyBrowserOriginDecision(
  url: string,
  decision: 'once' | 'persist',
): Promise<ToolExecutionResult | null> {
  const check = await checkBrowserNavigationAllowed(url);
  if (check?.allowed) {
    return null;
  }

  const ok = await approveBrowserNavigation(url, decision);
  if (!ok) {
    return {
      content: 'Error: Could not update browser allowlist (is npm start running?)',
    };
  }
  return null;
}

/**
 * Run browser_navigate after allowlist approval (shared by navigate + request tool).
 */
export async function executeBrowserNavigateWithGate(
  args: Record<string, unknown>,
  executeNavigate: (args: Record<string, unknown>) => Promise<ToolExecutionResult>,
  context: ToolApprovalContext = {},
  _modeId?: string,
): Promise<ToolExecutionResult> {
  const url = args.url;
  if (typeof url !== 'string' || !url.trim()) {
    return { content: 'Error: url is required' };
  }

  const blocked = await maybeBlockBrowserNavigation(url.trim(), context);
  if (blocked) return blocked;

  return executeNavigate(args);
}

/**
 * Apply allowlist approval from ask_question or show ask_question when decision omitted.
 */
export async function executeRequestBrowserOriginAccess(
  args: Record<string, unknown>,
  context: ToolApprovalContext = {},
): Promise<string> {
  const url = typeof args.url === 'string' ? args.url.trim() : '';
  if (!url) {
    return 'Error: "url" is required';
  }

  const rawDecision = args.decision;
  const normalizedDecision =
    typeof rawDecision === 'string' ? normalizeBrowserAllowlistDecision(rawDecision) : null;
  if (normalizedDecision === DECISION_ONCE || normalizedDecision === DECISION_PERSIST) {
    const blocked = await applyBrowserOriginDecision(url, normalizedDecision);
    if (blocked) {
      return blocked.content;
    }
    return (
      `Origin for ${url} is allowed (${normalizedDecision === DECISION_PERSIST ? 'added to allowlist' : 'once'}). ` +
      'Call browser_navigate with this URL.'
    );
  }

  if (rawDecision !== undefined && rawDecision !== null && rawDecision !== '') {
    return 'Error: decision must be "once" or "persist" when provided (after ask_question).';
  }

  const blocked = await maybeBlockBrowserNavigation(url, context);
  if (blocked) {
    return blocked.content;
  }

  return (
    `Origin for ${url} is already allowed. ` +
    'You may call browser_navigate with this URL.'
  );
}
