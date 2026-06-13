import type { AppId } from './types';

/** Keyword rules — first match wins; default is chat. */
const INTENT_RULES: ReadonlyArray<{ id: AppId; re: RegExp }> = [
  {
    id: 'code',
    re: /(code|build|implement|workspace|dev server|repo|fix|debug|refactor|component|feature|ship)/,
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
    id: 'bench',
    re: /(benchmark|measure|throughput|latency|speed|tok\/s|compare models|fastest)/,
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
  for (const rule of INTENT_RULES) {
    if (rule.re.test(t)) return rule.id;
  }
  return 'chat';
}
