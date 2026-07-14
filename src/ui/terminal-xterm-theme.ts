/**
 * xterm.js palette derived from Minnow --mn-* tokens (PTY ANSI contrast).
 */

import type { ITheme } from '@xterm/xterm';

function readToken(
  style: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
  const value = style.getPropertyValue(name).trim();
  return value || fallback;
}

function mixSrgb(
  a: [number, number, number],
  b: [number, number, number],
  weightAPercent: number,
): string {
  const w = weightAPercent / 100;
  const channels = a.map((v, i) => Math.round(v * w + b[i]! * (1 - w)));
  return `#${channels.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/** Resolve Minnow `color-mix(in srgb, var(--a) N%, var(--b))` selection tokens. */
function tryResolveColorMix(
  raw: string,
  style: CSSStyleDeclaration,
): string | null {
  const m =
    /^color-mix\(\s*in\s+\w+\s*,\s*var\((--[^)]+)\)\s+([\d.]+)%\s*,\s*var\((--[^)]+)\)\s*\)$/i.exec(
      raw.trim(),
    );
  if (!m) return null;
  const rgbA = parseHexOrRgb(readToken(style, m[1], ''));
  const rgbB = parseHexOrRgb(readToken(style, m[3], ''));
  if (!rgbA || !rgbB) return null;
  return mixSrgb(rgbA, rgbB, Number(m[2]));
}

/** Hidden probe for resolving color-mix()/var() tokens to rgb() for xterm. */
let colorProbe: HTMLElement | null = null;

/** Resolve a CSS token (including color-mix) to a color string xterm can parse. */
function resolveTokenColor(
  style: CSSStyleDeclaration,
  name: string,
  fallback: string,
): string {
  const raw = readToken(style, name, '');
  if (!raw) return fallback;
  if (raw.startsWith('#') || /^rgba?\(/i.test(raw)) return raw;

  const mixed = tryResolveColorMix(raw, style);
  if (mixed) return mixed;

  if (typeof document === 'undefined') return fallback;

  if (!colorProbe) {
    colorProbe = document.createElement('div');
    colorProbe.hidden = true;
    document.documentElement.appendChild(colorProbe);
  }

  colorProbe.style.backgroundColor = raw;
  const resolved = getComputedStyle(colorProbe).backgroundColor.trim();
  colorProbe.style.backgroundColor = '';
  if (resolved && resolved !== 'rgba(0, 0, 0, 0)') return resolved;
  return fallback;
}

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

/** Pick the first candidate with WCAG AA contrast on the terminal canvas. */
function pickReadable(bg: string, candidates: string[], fallback: string): string {
  for (const candidate of candidates) {
    if (contrastRatio(candidate, bg) >= 4.5) return candidate;
  }
  return fallback;
}

/** Pick the darkest gold/amber token that stays readable on the terminal canvas. */
function pickLightAnsiYellow(style: CSSStyleDeclaration, bg: string): string {
  const fg = readToken(style, '--mn-fg', '#1c2127');
  return pickReadable(
    bg,
    [
      readToken(style, '--mn-folder', '#8a7040'),
      readToken(style, '--mn-warning', '#a3722a'),
      '#7a5520',
      fg,
    ],
    fg,
  );
}

/** PTY selection tint — app token on dark; stronger accent mix on light canvas. */
function pickTerminalSelectionBackground(
  style: CSSStyleDeclaration,
  isLight: boolean,
  bg: string,
): string {
  if (!isLight) {
    return resolveTokenColor(style, '--mn-selection-bg', '#3d4f47');
  }

  const accent = parseHexOrRgb(readToken(style, '--mn-accent', '#5b8a72'));
  const surface2 = parseHexOrRgb(readToken(style, '--mn-surface-2', '#ededea'));
  if (!accent || !surface2) {
    return resolveTokenColor(style, '--mn-selection-bg', '#b8d4c4');
  }

  const minContrast = 2;
  for (const weight of [55, 60, 65, 70, 50, 45, 40]) {
    const candidate = mixSrgb(accent, surface2, weight);
    if (contrastRatio(candidate, bg) >= minContrast) return candidate;
  }

  return mixSrgb(accent, surface2, 65);
}

/** Build a full 16-color xterm theme from computed CSS variables. */
export function buildTerminalXtermTheme(style: CSSStyleDeclaration): ITheme {
  const isLight = style.colorScheme === 'light';
  const bg = readToken(style, '--mn-bg', isLight ? '#f7f7f4' : '#0f1216');
  const fg = readToken(style, '--mn-fg', isLight ? '#1c2127' : '#dfe3e8');
  const accent = readToken(style, '--mn-accent', isLight ? '#5b8a72' : '#9ec5a7');
  const selection = pickTerminalSelectionBackground(style, isLight, bg);

  const base: ITheme = {
    background: bg,
    foreground: fg,
    cursor: accent,
    cursorAccent: bg,
    selectionBackground: selection,
    selectionForeground: fg,
  };

  if (isLight) {
    const fg = readToken(style, '--mn-fg', '#1c2127');
    const fgMuted = readToken(style, '--mn-fg-muted', '#5a626c');
    const dangerInk = readToken(style, '--mn-danger-ink', '#8a2f2b');
    const danger = readToken(style, '--mn-danger', '#c75651');
    const successInk = readToken(style, '--mn-success-ink', '#2d4f3c');
    const success = readToken(style, '--mn-success', '#4f7c63');
    const accentInk = readToken(style, '--mn-accent-ink', '#2d4f3c');
    const accent = readToken(style, '--mn-accent', '#5b8a72');
    const yellow = pickLightAnsiYellow(style, bg);

    // Dark, saturated ANSI colors for shells that colorize on a light canvas.
    return {
      ...base,
      black: fg,
      red: dangerInk,
      green: successInk,
      yellow,
      blue: accentInk,
      magenta: pickReadable(bg, [dangerInk, danger, fg], fg),
      cyan: pickReadable(bg, [accent, accentInk, fg], fg),
      white: fgMuted,
      brightBlack: fgMuted,
      brightRed: pickReadable(bg, [danger, dangerInk, fg], fg),
      brightGreen: pickReadable(bg, [success, successInk, fg], fg),
      brightYellow: yellow,
      brightBlue: pickReadable(bg, [accent, accentInk, fg], fg),
      brightMagenta: dangerInk,
      brightCyan: accentInk,
      brightWhite: fg,
    };
  }

  return {
    ...base,
    black: readToken(style, '--mn-surface-2', '#1f242b'),
    red: readToken(style, '--mn-danger', '#e07a6f'),
    green: readToken(style, '--mn-success', '#9ec5a7'),
    yellow: readToken(style, '--mn-warning', '#d4a574'),
    blue: readToken(style, '--mn-accent', '#9ec5a7'),
    magenta: readToken(style, '--mn-danger-ink', '#f5b5ae'),
    cyan: readToken(style, '--mn-accent-ink', '#cfe5d4'),
    white: readToken(style, '--mn-fg-muted', '#8a929c'),
    brightBlack: readToken(style, '--mn-fg-subtle', '#5a626c'),
    brightRed: readToken(style, '--mn-danger-ink', '#f5b5ae'),
    brightGreen: readToken(style, '--mn-success-ink', '#cfe5d4'),
    brightYellow: readToken(style, '--mn-folder', '#c8b173'),
    brightBlue: readToken(style, '--mn-accent-ink', '#cfe5d4'),
    brightMagenta: readToken(style, '--mn-danger', '#e07a6f'),
    brightCyan: readToken(style, '--mn-accent', '#9ec5a7'),
    brightWhite: readToken(style, '--mn-fg', '#dfe3e8'),
  };
}
