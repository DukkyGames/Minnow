/**
 * Resolve Minnow palette theme for standalone research report HTML.
 * Inlines one theme block from src/styles/tokens.css so exports are self-contained.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DEFAULT_THEME_ID = 'swamp-dark';

const THEME_ID_RE = /^(swamp|desert|ocean|coral|mono|matrix|human|mint)-(dark|light)$/;

const LEGACY_FAMILY_ALIASES = {
  sage: 'swamp',
  amber: 'desert',
  cyan: 'ocean',
  salt: 'mono',
  retro: 'matrix',
  ember: 'human',
};

/** Core Minnow token keys (storage names without --mn- prefix). */
export const CORE_THEME_TOKEN_KEYS = [
  'bg',
  'surface-0',
  'surface-1',
  'surface-2',
  'border',
  'border-strong',
  'fg',
  'fg-muted',
  'fg-subtle',
  'fg-on-accent',
  'accent',
  'accent-soft',
  'accent-border',
  'accent-ink',
  'success',
  'success-soft',
  'success-border',
  'success-ink',
  'warning',
  'danger',
  'danger-soft',
  'danger-border',
  'danger-ink',
  'focus-ring',
  'shadow',
  'folder',
];

const CORE_KEY_SET = new Set(CORE_THEME_TOKEN_KEYS);

/** Meta theme-color per palette (matches index.html boot script). */
export const THEME_BG = {
  'swamp-dark': '#0f1216',
  'swamp-light': '#f7f7f4',
  'desert-dark': '#16140f',
  'desert-light': '#f7f4ec',
  'ocean-dark': '#0d1117',
  'ocean-light': '#f4f6f9',
  'coral-dark': '#141416',
  'coral-light': '#fafaf8',
  'mono-dark': '#2b2b2b',
  'mono-light': '#f7f7f7',
  'matrix-dark': '#040604',
  'matrix-light': '#eef2ee',
  'human-dark': '#0f0f0f',
  'human-light': '#fbf1ea',
  'mint-dark': '#141615',
  'mint-light': '#f2faf6',
};

let cachedTokensCss = '';

function readTokensCss() {
  if (!cachedTokensCss) {
    const tokensPath = path.resolve(__dirname, '../../src/styles/tokens.css');
    cachedTokensCss = fs.readFileSync(tokensPath, 'utf8');
  }
  return cachedTokensCss;
}

/**
 * @param {string | null | undefined} raw
 * @returns {string}
 */
export function normalizeThemeId(raw) {
  const value = String(raw ?? '').trim();
  if (!value) {
    return DEFAULT_THEME_ID;
  }
  if (value === 'light') {
    return 'swamp-light';
  }
  if (value === 'dark') {
    return 'swamp-dark';
  }
  if (THEME_ID_RE.test(value)) {
    return value;
  }
  const legacy = /^(sage|amber|cyan|salt|retro|ember)-(dark|light)$/.exec(value);
  if (legacy) {
    const family = LEGACY_FAMILY_ALIASES[legacy[1]] ?? 'swamp';
    return `${family}-${legacy[2]}`;
  }
  return DEFAULT_THEME_ID;
}

/**
 * @param {string} value
 * @returns {boolean}
 */
function isSafeCssColor(value) {
  const s = String(value).trim();
  if (!s || s.length > 160) {
    return false;
  }
  if (/[;{}]|url\s*\(|expression\s*\(|@import|javascript:/i.test(s)) {
    return false;
  }
  return true;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, string> | null}
 */
export function sanitizeCustomTokens(raw) {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  /** @type {Record<string, string>} */
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!CORE_KEY_SET.has(key) || typeof value !== 'string') {
      continue;
    }
    const trimmed = value.trim();
    if (!isSafeCssColor(trimmed)) {
      continue;
    }
    out[key] = trimmed;
  }
  return Object.keys(out).length ? out : null;
}

/**
 * Decode base64url custom token payload from report URL query param.
 * @param {string | null | undefined} encoded
 * @returns {Record<string, string> | null}
 */
export function parseCustomTokensParam(encoded) {
  const raw = String(encoded ?? '').trim();
  if (!raw) {
    return null;
  }
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLen);
    const json = Buffer.from(base64, 'base64').toString('utf8');
    const parsed = JSON.parse(json);
    return sanitizeCustomTokens(parsed);
  } catch {
    return null;
  }
}

/**
 * @param {Record<string, string>} tokens
 * @returns {string}
 */
export function buildCustomTokenOverrideCss(tokens) {
  const lines = Object.entries(tokens).map(([key, value]) => `  --mn-${key}: ${value};`);
  return `:root {\n${lines.join('\n')}\n}`;
}

/**
 * Extract and flatten a single theme block from tokens.css for :root in standalone HTML.
 * @param {string} themeId
 * @returns {string}
 */
export function extractThemeTokensCss(themeId) {
  const css = readTokensCss();
  const marker = `:root[data-theme="${themeId}"]`;
  const start = css.indexOf(marker);
  if (start < 0) {
    return extractThemeTokensCss(DEFAULT_THEME_ID);
  }

  const nextTheme = css.indexOf(':root[data-theme="', start + marker.length);
  const block = css.slice(start, nextTheme < 0 ? css.length : nextTheme).trim();

  return block.replace(
    /^:root\[data-theme="[^"]+"\],\s*\.settings-theme-preview\[data-theme="[^"]+"\]\s*\{/,
    ':root {',
  );
}

/**
 * @param {string | null | undefined} themeId
 * @param {Record<string, string> | null | undefined} [customTokens]
 * @returns {{ themeId: string, themeColor: string, themeTokensCss: string, colorScheme: 'dark' | 'light', customTokens: Record<string, string> | null }}
 */
export function resolveReportTheme(themeId, customTokens = null) {
  const resolved = normalizeThemeId(themeId);
  const colorScheme = resolved.endsWith('-light') ? 'light' : 'dark';
  const sanitized = sanitizeCustomTokens(customTokens);
  let themeTokensCss = extractThemeTokensCss(resolved);
  let themeColor = THEME_BG[resolved] ?? THEME_BG[DEFAULT_THEME_ID];

  if (sanitized) {
    themeTokensCss = `${themeTokensCss}\n\n${buildCustomTokenOverrideCss(sanitized)}`;
    if (sanitized.bg) {
      themeColor = sanitized.bg;
    }
  }

  return {
    themeId: resolved,
    themeColor,
    themeTokensCss,
    colorScheme,
    customTokens: sanitized,
  };
}
