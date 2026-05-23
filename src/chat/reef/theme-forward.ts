/**
 * Read Minnow theme CSS variables from the host document and build iframe prelude CSS.
 */

/** Token names forwarded into reef widget iframes. */
export const REEF_THEME_TOKEN_NAMES = [
  '--mn-bg',
  '--mn-surface-1',
  '--mn-surface-2',
  '--mn-fg',
  '--mn-fg-muted',
  '--mn-border',
  '--mn-border-strong',
  '--mn-accent',
  '--mn-accent-soft',
  '--radius-sm',
  '--radius-md',
  '--radius-lg',
  '--font-ui',
  '--font-mono',
] as const;

export type ReefThemeTokenName = (typeof REEF_THEME_TOKEN_NAMES)[number];

/** Snapshot of computed theme variables from a host element (usually documentElement). */
export function readThemeVarsFromElement(el: HTMLElement): Record<string, string> {
  const style = getComputedStyle(el);
  const vars: Record<string, string> = {};
  for (const name of REEF_THEME_TOKEN_NAMES) {
    const computed = style.getPropertyValue(name).trim();
    const inline = el.style.getPropertyValue(name).trim();
    const value = computed || inline;
    if (value) vars[name] = value;
  }
  return vars;
}

/** Read theme tokens from the live app root. */
export function readThemeVarsFromHost(): Record<string, string> {
  return readThemeVarsFromElement(document.documentElement);
}

/** Emit a :root block for injection into widget srcdoc. */
export function buildThemeCssBlock(vars: Record<string, string>): string {
  const lines = Object.entries(vars).map(([k, v]) => `  ${k}: ${v};`);
  if (lines.length === 0) return ':root {}';
  return `:root {\n${lines.join('\n')}\n}`;
}

let themeObserver: MutationObserver | null = null;

/**
 * Watch `html[data-theme]` and invoke callback when effective theme changes.
 */
export function subscribeThemeChanges(callback: (vars: Record<string, string>) => void): () => void {
  if (themeObserver) {
    themeObserver.disconnect();
    themeObserver = null;
  }

  const root = document.documentElement;
  let last = root.getAttribute('data-theme') ?? '';

  const notify = (): void => {
    callback(readThemeVarsFromHost());
  };

  themeObserver = new MutationObserver(() => {
    const next = root.getAttribute('data-theme') ?? '';
    if (next === last) return;
    last = next;
    notify();
  });

  themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  notify();

  return () => {
    themeObserver?.disconnect();
    themeObserver = null;
  };
}
