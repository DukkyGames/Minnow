/**
 * Concierge seed refinement — strip filler, detect navigation-only intents,
 * and avoid echoing the user's raw concierge phrasing into Code/Chat sends.
 */

import type { AppId } from './types';

/** Filler prefixes common in concierge phrasing. */
const FILLER_PREFIX_RE =
  /^(?:let'?s|let us|please|can you|could you|help me|i want to|i'?d like to|we should|go ahead and)\s+/i;

/** Open research mode without a concrete topic (desktop concierge chip, etc.). */
const RESEARCH_TOPIC_PLACEHOLDER_RE =
  /^(?:research|investigate|look into|deep dive)(?:\s+(?:a|an))?\s+(?:topic|something|anything|subject)$/;

/** Bare research verbs with no topic — open mode idle. */
const RESEARCH_BARE_VERB_RE = /^(?:research|investigate|look into|deep dive)$/;

/** Open/switch workspace without a concrete task (Code app). */
const CODE_NAVIGATION_RE =
  /^(?:let'?s|i(?:'d| would) like to|please|can we|help me|want to)?\s*(?:code|work|develop|program|hack)\s+(?:in|on|inside|within)\s+(?:our|my|the)\s+/i;

const CODE_OPEN_WORKSPACE_RE =
  /^(?:open|switch to|go to|use|start)\s+(?:our|my|the)\s+.+\s+(?:app|project|repo|workspace|codebase)\b/i;

/** Concrete task verbs — navigation-only prompts lack these beyond generic "code/build". */
const ACTIONABLE_TASK_RE =
  /\b(?:bug|bugs|fix|debug|error|implement|add|create|write|refactor|ship|test|find|investigate|review|migrate|update|remove|delete|rename|extract|integrate|deploy|build\s+(?:a|the|an)\s+\w)/i;

/** Normalize text for echo / navigation comparison. */
export function normalizeConciergeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(FILLER_PREFIX_RE, '')
    .trim();
}

/** True when the user only wants to open Research without a concrete topic. */
export function isNavigationOnlyResearchRequest(userText: string): boolean {
  const norm = normalizeConciergeText(userText);
  if (!norm) return false;
  if (RESEARCH_TOPIC_PLACEHOLDER_RE.test(norm)) return true;
  return RESEARCH_BARE_VERB_RE.test(norm);
}

/** True when the user is opening Code in a workspace without a specific task. */
export function isNavigationOnlyCodeRequest(userText: string): boolean {
  const t = userText.trim();
  if (!t) return false;
  if (ACTIONABLE_TASK_RE.test(t)) return false;
  return CODE_NAVIGATION_RE.test(t) || CODE_OPEN_WORKSPACE_RE.test(t);
}

/** True when the planner seed mostly repeats the user's concierge phrasing. */
export function isEchoSeed(userText: string, seed: string): boolean {
  const userNorm = normalizeConciergeText(userText);
  const seedNorm = normalizeConciergeText(seed);
  if (!userNorm || !seedNorm) return false;
  if (userNorm === seedNorm) return true;
  const shorter = userNorm.length <= seedNorm.length ? userNorm : seedNorm;
  const longer = shorter === userNorm ? seedNorm : userNorm;
  if (longer.includes(shorter) && shorter.length / longer.length > 0.65) return true;
  return false;
}

/** Strip conversational filler from a task seed when it is kept. */
export function stripSeedFiller(seed: string): string {
  let s = seed.trim();
  while (FILLER_PREFIX_RE.test(s)) {
    s = s.replace(FILLER_PREFIX_RE, '').trim();
  }
  return s;
}

export interface SanitizeSeedInput {
  userText: string;
  seed?: string;
  appId: AppId;
  autoRun?: boolean;
}

export interface SanitizeSeedResult {
  seed?: string;
  autoRun?: boolean;
}

/**
 * Post-process planner/fallback output so navigation-only Code opens do not
 * auto-send the raw concierge sentence; actionable tasks keep a refined seed.
 */
export function sanitizeConciergeSeed(input: SanitizeSeedInput): SanitizeSeedResult {
  const userText = input.userText.trim();
  let seed = input.seed?.trim();
  let autoRun = input.autoRun;

  if (input.appId === 'code' && isNavigationOnlyCodeRequest(userText)) {
    return { seed: undefined, autoRun: false };
  }

  if (input.appId === 'research' && isNavigationOnlyResearchRequest(userText)) {
    return { seed: undefined, autoRun: false };
  }

  if (!seed) return { seed: undefined, autoRun };

  if (isEchoSeed(userText, seed)) {
    if (input.appId === 'code' && !ACTIONABLE_TASK_RE.test(userText)) {
      return { seed: undefined, autoRun: false };
    }
    seed = stripSeedFiller(seed);
  } else {
    seed = stripSeedFiller(seed);
  }

  if (!seed) return { seed: undefined, autoRun: false };

  if (input.appId === 'code' && autoRun !== true) {
    return { seed, autoRun: false };
  }

  return { seed, autoRun };
}
