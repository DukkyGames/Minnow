/**
 * WCAG AA contrast for core --mn-* pairs (static palette table from Color Scheme Exploration).
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import path from 'node:path';

const THEME_IDS = [
  'sage-dark',
  'sage-light',
  'amber-dark',
  'amber-light',
  'cyan-dark',
  'cyan-light',
  'coral-dark',
  'coral-light',
  'salt-dark',
  'salt-light',
  'retro-dark',
  'retro-light',
] as const;

const LIGHT_THEME_IDS = THEME_IDS.filter((id) => id.endsWith('-light'));

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

/** Resolve one level of var(--token) aliases to a hex/rgb literal. */
function resolveToken(vars: Record<string, string>, name: string, depth = 0): string | null {
  if (depth > 4) return null;
  const raw = vars[name];
  if (!raw) return null;
  const alias = /^var\((--[\w-]+)\)$/.exec(raw);
  if (alias) return resolveToken(vars, alias[1], depth + 1);
  if (parseHexOrRgb(raw)) return raw;
  return null;
}

describe('theme-contrast', () => {
  const tokensPath = path.join(process.cwd(), 'src', 'styles', 'tokens.css');
  const css = readFileSync(tokensPath, 'utf8');

  for (const id of THEME_IDS) {
    test(`${id}: fg on bg and fg on surface-1 meet WCAG AA`, () => {
      const vars = readThemeBlock(css, id);
      const fg = vars['--mn-fg'];
      const bg = vars['--mn-bg'];
      const s1 = vars['--mn-surface-1'];
      const selectionBg = vars['--mn-selection-bg'];
      assert.ok(fg && bg && s1 && selectionBg, 'core tokens present');
      assert.ok(
        contrastRatio(fg, bg) >= 4.5,
        `fg/bg ${contrastRatio(fg, bg).toFixed(2)} < 4.5`,
      );
      assert.ok(
        contrastRatio(fg, s1) >= 4.5,
        `fg/surface-1 ${contrastRatio(fg, s1).toFixed(2)} < 4.5`,
      );
    });
  }

  for (const id of LIGHT_THEME_IDS) {
    test(`${id}: syntax highlights meet WCAG AA on code surfaces`, () => {
      const vars = readThemeBlock(css, id);
      const s0 = vars['--mn-surface-0'];
      const bg = vars['--mn-bg'];
      assert.ok(s0 && bg, 'surface tokens present');

      const pairs: Array<[string, string]> = [
        ['--mn-syntax-command', s0],
        ['--mn-syntax-name', s0],
        ['--mn-syntax-inline', s0],
        ['--mn-syntax-link', bg],
        ['--cm-attr', s0],
        ['--cm-title', s0],
        ['--cm-string', s0],
        ['--mn-fg-muted', s0],
      ];

      for (const [token, surface] of pairs) {
        const fg = resolveToken(vars, token);
        assert.ok(fg, `${token} resolves to a color`);
        assert.ok(
          contrastRatio(fg!, surface) >= 4.5,
          `${token} on ${surface} ${contrastRatio(fg!, surface).toFixed(2)} < 4.5`,
        );
      }
    });
  }
});
