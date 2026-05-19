/**
 * Replace {{token}} placeholders in composed prompt bodies.
 */

import type { InterpolationVars } from './types';

const TOKEN_RE = /\{\{([a-z_]+)\}\}/g;

const warnedUnknown = new Set<string>();

/** Substitute known interpolation tokens; unknown tokens stay literal. */
export function interpolatePromptBody(template: string, vars: InterpolationVars): string {
  return template.replace(TOKEN_RE, (match, token: string) => {
    if (token in vars) {
      return vars[token as keyof InterpolationVars] ?? '';
    }
    if (typeof console !== 'undefined' && !warnedUnknown.has(token)) {
      warnedUnknown.add(token);
      console.warn(`[prompts] Unknown interpolation token: {{${token}}}`);
    }
    return match;
  });
}

/** Reset unknown-token warnings (tests). */
export function resetInterpolationWarnings(): void {
  warnedUnknown.clear();
}
