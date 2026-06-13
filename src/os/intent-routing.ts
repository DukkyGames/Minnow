import type { AppId } from './types';

/** Bug hunts, fixes, and repo work belong in Code — not Chat or Research. */
export const CODE_WORKSPACE_TASK_RE =
  /\b(bugs?|errors?|issues?|fix|debug|refactor|implement|dev server|repo|codebase|component|feature)\b/i;

export const CODE_BUG_HUNT_RE =
  /\b(find|look for|hunt for|scan for|check for)\s+(bugs?|issues?|errors?|problems?)\b/i;

/** True when the user wants workspace tooling (Code app), not general Chat Q&A. */
export function isCodeWorkspaceTask(text: string | null | undefined): boolean {
  const t = (text ?? '').trim();
  if (!t) return false;
  return CODE_WORKSPACE_TASK_RE.test(t) || CODE_BUG_HUNT_RE.test(t);
}

/** Keyword rules — first match wins; default is chat. */
const INTENT_RULES: ReadonlyArray<{ id: AppId; re: RegExp }> = [
  {
    id: 'code',
    re: /(code|build|implement|workspace|dev server|repo|fix|debug|bugs?|errors?|refactor|component|feature|ship)/,
  },
  {
    id: 'research',
    re: /(research|investigate|find out|sources|deep dive|look into|compare papers|gather)/,
  },
  {
    id: 'experts',
    re: /(expert|persona|agent|lab|harness|eval|prompt design)/,
  },
  {
    id: 'compare',
    re: /(blind compare|a\/b test|side.by.side|model preference|which (model|response)|vote on|prefer)/,
  },
  {
    id: 'bench',
    re: /(benchmark|measure|throughput|latency|speed|tok\/s|fastest)/,
  },
  {
    id: 'settings',
    re: /(settings|theme|appearance|provider|model|api key|palette|dark|light)/,
  },
  {
    id: 'chat',
    re: /(chat|talk|ask|explain|brainstorm|tell me|what is|how do)/,
  },
];

/** Whimsical concierge status lines shown while routing intent. */
export const CONCIERGE_LINES: readonly string[] = [
  'Casting a line…',
  'Reading the current…',
  'Following the school…',
  'Swimming toward the right app…',
  'Surfacing what you need…',
];

/** Map free-text concierge input to a target app id. */
export function routeIntent(text: string | null | undefined): AppId {
  const t = (text ?? '').toLowerCase();
  if (isCodeWorkspaceTask(t)) return 'code';
  for (const rule of INTENT_RULES) {
    if (rule.re.test(t)) return rule.id;
  }
  return 'chat';
}
