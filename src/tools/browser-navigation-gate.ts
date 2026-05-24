/**
 * Pre-flight user approval for browser_navigate when the URL is outside the allowlist.
 * Uses the ask_question card UI (same option ids as tool-usage/browser-allowlist prompts).
 */

import {
  approveBrowserNavigation,
  checkBrowserNavigationAllowed,
  loadBrowserMeta,
} from '../config/browser-meta';
import { enqueueAskQuestion } from './ask-question-queue';
import type { ToolApprovalContext } from './approval-queue';
import type { AskQuestionToolResult } from './ask-question-types';
import { isLocalServerAvailable } from './config';
import type { ToolExecutionResult } from '../types';

const ALLOWLIST_QUESTION_ID = 'browser_allow_origin';

/** Option ids must match src/chat/prompts/tool-usage/browser-allowlist.md */
const DECISION_ONCE = 'once';
const DECISION_PERSIST = 'persist';
const DECISION_DENY = 'deny';

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
      content: 'Error: browser automation is disabled in Settings → Tools → Browser (CDP).',
    };
  }
  if (!meta.allowNavigate) {
    return {
      content:
        'Error: browser navigation is disabled in Settings → Tools (enable “Allow navigation”).',
    };
  }

  const check = await checkBrowserNavigationAllowed(url);
  if (!check) {
    return null;
  }
  if (check.allowed) {
    return null;
  }

  const raw = await enqueueAskQuestion(
    {
      title: 'Browser navigation',
      questions: [
        {
          id: ALLOWLIST_QUESTION_ID,
          prompt: `Allow CDP browser navigation to ${check.origin}?`,
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
  );

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
  const selected = entry?.selectedIds[0];
  if (!selected || selected === DECISION_DENY) {
    return {
      content:
        `Error: User denied browser navigation to ${url}. ` +
        'Respect the denial; do not navigate unless they ask again.',
    };
  }

  if (selected !== DECISION_ONCE && selected !== DECISION_PERSIST) {
    return {
      content:
        `Error: Unexpected allowlist answer "${selected}". ` +
        'Use ask_question options once, persist, or deny.',
    };
  }

  const mode = selected === DECISION_PERSIST ? 'persist' : 'once';
  const ok = await approveBrowserNavigation(url, mode);
  if (!ok) {
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
  executeServerTool: (
    name: string,
    args: Record<string, unknown>,
    modeId?: string,
  ) => Promise<ToolExecutionResult>,
  context: ToolApprovalContext = {},
  modeId?: string,
): Promise<ToolExecutionResult> {
  const url = args.url;
  if (typeof url !== 'string' || !url.trim()) {
    return { content: 'Error: url is required' };
  }

  const blocked = await maybeBlockBrowserNavigation(url.trim(), context);
  if (blocked) return blocked;

  return executeServerTool('browser_navigate', args, modeId);
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
  if (rawDecision === DECISION_ONCE || rawDecision === DECISION_PERSIST) {
    const blocked = await applyBrowserOriginDecision(url, rawDecision);
    if (blocked) {
      return blocked.content;
    }
    return (
      `Origin for ${url} is allowed (${rawDecision === DECISION_PERSIST ? 'added to allowlist' : 'once'}). ` +
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
