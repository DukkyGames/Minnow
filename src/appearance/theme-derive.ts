/**
 * Derive full theme token palettes from a small set of seed colors.
 */

import { formatCssColor, parseCssColorOrDefault, type RgbaColor } from './color-format';
import { CORE_THEME_TOKEN_KEYS, type CoreThemeTokenKey } from './types';

/** User-editable seed colors in simplified custom theme mode. */
export const SIMPLIFIED_THEME_KEYS = ['bg', 'fg', 'accent', 'danger'] as const;
export type SimplifiedThemeKey = (typeof SIMPLIFIED_THEME_KEYS)[number];
export type SimplifiedThemeSeeds = Record<SimplifiedThemeKey, string>;

const SIMPLIFIED_LABELS: Record<SimplifiedThemeKey, string> = {
  bg: 'Background',
  fg: 'Text',
  accent: 'Accent',
  danger: 'Danger',
};

/** Human label for a simplified seed key. */
export function labelForSimplifiedKey(key: SimplifiedThemeKey): string {
  return SIMPLIFIED_LABELS[key];
}

function clampByte(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** WCAG relative luminance (sRGB). */
export function relativeLuminance(color: RgbaColor): number {
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function mixRgba(a: RgbaColor, b: RgbaColor, t: number): RgbaColor {
  const mix = clamp01(t);
  return {
    r: clampByte(a.r + (b.r - a.r) * mix),
    g: clampByte(a.g + (b.g - a.g) * mix),
    b: clampByte(a.b + (b.b - a.b) * mix),
    a: a.a + (b.a - a.a) * mix,
  };
}

function rgbaWithAlpha(color: RgbaColor, alpha: number): string {
  return formatCssColor({ ...color, a: clamp01(alpha) });
}

function lighten(color: RgbaColor, amount: number): RgbaColor {
  return mixRgba(color, { r: 255, g: 255, b: 255, a: 1 }, amount);
}

function darken(color: RgbaColor, amount: number): RgbaColor {
  return mixRgba(color, { r: 0, g: 0, b: 0, a: 1 }, amount);
}

interface HslColor {
  h: number;
  s: number;
  l: number;
}

function rgbToHsl(color: RgbaColor): HslColor {
  const r = color.r / 255;
  const g = color.g / 255;
  const b = color.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const d = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  if (delta > 0) {
    switch (max) {
      case r:
        h = ((g - b) / delta + (g < b ? 6 : 0)) / 6;
        break;
      case g:
        h = ((b - r) / delta + 2) / 6;
        break;
      default:
        h = ((r - g) / delta + 4) / 6;
        break;
    }
  }

  return { h: h * 360, s: d, l };
}

function hueToRgb(p: number, q: number, t: number): number {
  let hue = t;
  if (hue < 0) hue += 1;
  if (hue > 1) hue -= 1;
  if (hue < 1 / 6) return p + (q - p) * 6 * hue;
  if (hue < 1 / 2) return q;
  if (hue < 2 / 3) return p + (q - p) * (2 / 3 - hue) * 6;
  return p;
}

function hslToRgb(hsl: HslColor): RgbaColor {
  const h = ((hsl.h % 360) + 360) % 360 / 360;
  const s = clamp01(hsl.s);
  const l = clamp01(hsl.l);

  if (s === 0) {
    const gray = clampByte(l * 255);
    return { r: gray, g: gray, b: gray, a: 1 };
  }

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: clampByte(hueToRgb(p, q, h + 1 / 3) * 255),
    g: clampByte(hueToRgb(p, q, h) * 255),
    b: clampByte(hueToRgb(p, q, h - 1 / 3) * 255),
    a: 1,
  };
}

/** Rotate hue while preserving saturation and lightness. */
function shiftHue(color: RgbaColor, degrees: number): RgbaColor {
  const hsl = rgbToHsl(color);
  return hslToRgb({ ...hsl, h: hsl.h + degrees });
}

const BLACK: RgbaColor = { r: 0, g: 0, b: 0, a: 1 };
const WHITE: RgbaColor = { r: 255, g: 255, b: 255, a: 1 };

/** Build a complete token map from four seed colors. */
export function deriveThemeTokensFromSeeds(seeds: SimplifiedThemeSeeds): Record<CoreThemeTokenKey, string> {
  const bg = parseCssColorOrDefault(seeds.bg);
  const fg = parseCssColorOrDefault(seeds.fg);
  const accent = parseCssColorOrDefault(seeds.accent);
  const danger = parseCssColorOrDefault(seeds.danger);

  const dark = relativeLuminance(bg) < 0.45;
  const borderBase = dark ? WHITE : fg;

  const surface0 = dark ? darken(bg, 0.18) : darken(bg, 0.04);
  const surface1 = dark ? lighten(bg, 0.08) : lighten(bg, 0.35);
  const surface2 = dark ? lighten(bg, 0.16) : darken(bg, 0.05);

  const fgMuted = mixRgba(fg, bg, 0.55);
  const fgSubtle = mixRgba(fg, bg, 0.72);
  const fgOnAccent =
    relativeLuminance(accent) > 0.55 ? darken(accent, 0.82) : lighten(accent, 0.9);

  const accentSoft = rgbaWithAlpha(accent, 0.14);
  const accentBorder = rgbaWithAlpha(accent, 0.28);
  const accentInk = dark ? lighten(accent, 0.35) : darken(accent, 0.35);

  const warning = shiftHue(accent, 32);
  const folder = shiftHue(accent, 48);

  const dangerSoft = rgbaWithAlpha(danger, 0.18);
  const dangerBorder = rgbaWithAlpha(danger, 0.35);
  const dangerInk = lighten(danger, 0.35);

  const shadow = rgbaWithAlpha(BLACK, dark ? 0.45 : 0.12);

  const tokens: Record<CoreThemeTokenKey, string> = {
    bg: formatCssColor(bg),
    'surface-0': formatCssColor(surface0),
    'surface-1': formatCssColor(surface1),
    'surface-2': formatCssColor(surface2),
    border: rgbaWithAlpha(borderBase, dark ? 0.06 : 0.08),
    'border-strong': rgbaWithAlpha(borderBase, dark ? 0.12 : 0.16),
    fg: formatCssColor(fg),
    'fg-muted': formatCssColor(fgMuted),
    'fg-subtle': formatCssColor(fgSubtle),
    'fg-on-accent': formatCssColor(fgOnAccent),
    accent: formatCssColor(accent),
    'accent-soft': accentSoft,
    'accent-border': accentBorder,
    'accent-ink': formatCssColor(accentInk),
    success: formatCssColor(accent),
    'success-soft': accentSoft,
    'success-border': accentBorder,
    'success-ink': formatCssColor(accentInk),
    warning: formatCssColor(warning),
    danger: formatCssColor(danger),
    'danger-soft': dangerSoft,
    'danger-border': dangerBorder,
    'danger-ink': formatCssColor(dangerInk),
    'focus-ring': formatCssColor(accent),
    shadow,
    folder: formatCssColor(folder),
  };

  for (const key of CORE_THEME_TOKEN_KEYS) {
    if (!tokens[key]) {
      throw new Error(`Missing derived token: ${key}`);
    }
  }

  return tokens;
}

/** Pull simplified seeds from an existing token map (or preset defaults). */
export function extractSimplifiedSeeds(
  tokens: Partial<Record<CoreThemeTokenKey, string>>,
  fallback?: Partial<Record<SimplifiedThemeKey, string>>,
): SimplifiedThemeSeeds {
  const defaults: SimplifiedThemeSeeds = {
    bg: fallback?.bg ?? '#0f1216',
    fg: fallback?.fg ?? '#dfe3e8',
    accent: fallback?.accent ?? '#9ec5a7',
    danger: fallback?.danger ?? '#e07a6f',
  };

  return {
    bg: tokens.bg?.trim() || defaults.bg,
    fg: tokens.fg?.trim() || defaults.fg,
    accent: tokens.accent?.trim() || defaults.accent,
    danger: tokens.danger?.trim() || defaults.danger,
  };
}
