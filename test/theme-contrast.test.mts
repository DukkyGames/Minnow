/**
 * WCAG AA contrast for core --mn-* pairs (static palette table from Color Scheme Exploration).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import path from 'node:path';

const THEME_IDS = [
  'swamp-dark',
  'swamp-light',
  'desert-dark',
  'desert-light',
  'ocean-dark',
  'ocean-light',
  'coral-dark',
  'coral-light',
  'mono-dark',
  'mono-light',
  'matrix-dark',
  'matrix-light',
  'human-dark',
  'human-light',
  'mint-dark',
  'mint-light',
] as const;

function parseHexOrRgb(color: string): [number, number, number] | null {
  const hex = color.trim();
  if (hex.startsWith('#')) {
    const h = hex.slice(1);
    const full =
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h.length >= 6
          ? h.slice(0, 6)
          : null;
    if (!full) return null;
    const n = Number.parseInt(full, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(hex);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3])];
  return null;
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const f = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrastRatio(fg: string, bg: string): number {
  const a = parseHexOrRgb(fg);
  const b = parseHexOrRgb(bg);
  if (!a || !b) return 0;
  const l1 = relativeLuminance(a);
  const l2 = relativeLuminance(b);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function readThemeBlock(css: string, themeId: string): Record<string, string> {
  const re = new RegExp(
    `:root\\[data-theme="${themeId}"\\](?:,\\s*\\.settings-theme-preview\\[data-theme="${themeId}"\\])?\\s*\\{([\\s\\S]*?)\\n\\}`,
    'm',
  );
  const m = re.exec(css);
  assert.ok(m, `missing block for ${themeId}`);
  const vars: Record<string, string> = {};
  for (const line of m[1].split('\n')) {
    const vm = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line);
    if (vm) vars[vm[1]] = vm[2].trim();
  }
  return vars;
}

describe('theme-contrast', () => {
  const css = readFileSync(path.join(process.cwd(), 'src/styles/tokens.css'), 'utf8');

  for (const themeId of THEME_IDS) {
    test(`${themeId}: fg on bg and fg on surface-1 meet WCAG AA`, () => {
      const vars = readThemeBlock(css, themeId);
      const fg = vars['--mn-fg'];
      const bg = vars['--mn-bg'];
      const surface1 = vars['--mn-surface-1'];
      assert.ok(fg && bg && surface1, `missing core tokens for ${themeId}`);
      assert.ok(contrastRatio(fg, bg) >= 4.5, `fg on bg contrast too low for ${themeId}`);
      assert.ok(contrastRatio(fg, surface1) >= 4.5, `fg on surface-1 contrast too low for ${themeId}`);
    });
  }
});
