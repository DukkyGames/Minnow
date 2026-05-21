/**
 * Guard against unquoted CSS variables in JSX style objects.
 * Models often emit `color: var(--text)` which is invalid JS (`var` is reserved).
 */

/** Match `color: var(--token)` not already wrapped in quotes after the colon. */
const UNQUOTED_VAR_IN_STYLE_RE = /:\s*var\((--[\w-]+)\)/g;

export interface QuoteUnquotedCssVarsResult {
  /** Script body after auto-quoting. */
  text: string;
  /** How many replacements were applied. */
  fixCount: number;
}

/**
 * Quote bare `var(--token)` values after object-style colons.
 * Example: `color: var(--text)` → `color: 'var(--text)'`.
 */
export function quoteUnquotedCssVarsInJsxScript(scriptText: string): QuoteUnquotedCssVarsResult {
  let fixCount = 0;
  const text = scriptText.replace(UNQUOTED_VAR_IN_STYLE_RE, (_match, token: string) => {
    fixCount += 1;
    return `: 'var(${token})'`;
  });
  return { text, fixCount };
}

/** Console message when the host auto-fixes widget JSX (shown in iframe devtools). */
export const REEF_JSX_CSS_VAR_GUARD_NOTE =
  '[reef] Quoted unquoted var(--*) in JSX style={{ }} — use strings (e.g. color: \'var(--text)\'). ' +
  'Bare var(--token) is valid only inside <style> CSS, not in React style objects.';
