/**
 * Heuristic: does the build touch UI surfaces (triggers impeccable / ui-designer pass)?
 */

const UI_SIGNALS =
  /\b(src\/ui|src\/styles|src\/os|\.css|component|react|tsx|jsx|dom|layout|modal|button|form|tailwind|stylesheet|minnowos|reef|canvas|popover|sidebar|menubar|dock|frontend|ux|impeccable|design\s+system|--mn-)\b/i;

/** True when spec/research/draft text suggests UI work. */
export function buildTouchesUi(
  spec: string,
  research?: string,
  draft?: string,
): boolean {
  const blob = [spec, research ?? '', draft ?? ''].join('\n');
  return UI_SIGNALS.test(blob);
}
