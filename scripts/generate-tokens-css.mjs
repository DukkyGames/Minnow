import fs from 'node:fs';
import path from 'node:path';

// ── Palettes ─────────────────────────────────────────────────────────────────

const PALETTES = {
  sage: {
    dark: {
      bg: '#0f1216',
      surface0: '#0b0d11',
      surface1: '#161a20',
      surface2: '#1f242b',
      border: 'rgba(255,255,255,0.06)',
      borderStrong: 'rgba(255,255,255,0.12)',
      fg: '#dfe3e8',
      fgMuted: '#8a929c',
      fgSubtle: '#5a626c',
      fgOnAccent: '#0b1410',
      accent: '#9ec5a7',
      accentSoft: 'rgba(158,197,167,0.14)',
      accentBorder: 'rgba(158,197,167,0.28)',
      accentInk: '#cfe5d4',
      success: '#9ec5a7',
      successSoft: 'rgba(158,197,167,0.14)',
      successBorder: 'rgba(158,197,167,0.28)',
      successInk: '#cfe5d4',
      warning: '#d4a574',
      folder: '#c8b173',
      focusRing: '#9ec5a7',
      shadow: 'rgba(0,0,0,0.45)',
      danger: '#e07a6f',
      dangerSoft: 'rgba(224,122,111,0.18)',
      dangerBorder: 'rgba(224,122,111,0.35)',
      dangerInk: '#f5b5ae',
    },
    light: {
      bg: '#f7f7f4',
      surface0: '#f1f1ec',
      surface1: '#fbfbf9',
      surface2: '#ededea',
      border: 'rgba(15,18,22,0.08)',
      borderStrong: 'rgba(15,18,22,0.16)',
      fg: '#1c2127',
      fgMuted: '#5a626c',
      fgSubtle: '#8a929c',
      fgOnAccent: '#0d1a13',
      accent: '#5b8a72',
      accentSoft: 'rgba(91,138,114,0.15)',
      accentBorder: 'rgba(91,138,114,0.30)',
      accentInk: '#2d4f3c',
      success: '#4f7c63',
      successSoft: 'rgba(79,124,99,0.15)',
      successBorder: 'rgba(79,124,99,0.28)',
      successInk: '#2d4f3c',
      warning: '#a3722a',
      folder: '#a8893d',
      focusRing: '#5b8a72',
      shadow: 'rgba(15,18,22,0.12)',
      danger: '#c75651',
      dangerSoft: 'rgba(199,86,81,0.12)',
      dangerBorder: 'rgba(199,86,81,0.28)',
      dangerInk: '#8a2f2b',
    },
  },
  amber: {
    dark: {
      bg: '#16140f',
      surface0: '#100e0a',
      surface1: '#1d1a14',
      surface2: '#27231b',
      border: 'rgba(232,210,170,0.07)',
      borderStrong: 'rgba(232,210,170,0.14)',
      fg: '#e8dcc6',
      fgMuted: '#9a8d76',
      fgSubtle: '#665d4d',
      fgOnAccent: '#1a1308',
      accent: '#d4a574',
      accentSoft: 'rgba(212,165,116,0.15)',
      accentBorder: 'rgba(212,165,116,0.28)',
      accentInk: '#e8c89a',
      success: '#a8c48a',
      successSoft: 'rgba(168,196,138,0.14)',
      successBorder: 'rgba(168,196,138,0.26)',
      successInk: '#c6dcae',
      warning: '#d4a574',
      folder: '#c89a5a',
      focusRing: '#d4a574',
      shadow: 'rgba(0,0,0,0.5)',
      danger: '#e08a6a',
      dangerSoft: 'rgba(224,138,106,0.2)',
      dangerBorder: 'rgba(224,138,106,0.35)',
      dangerInk: '#f0b89a',
    },
    light: {
      bg: '#f7f4ec',
      surface0: '#f1ede2',
      surface1: '#fbf9f3',
      surface2: '#ebe6d8',
      border: 'rgba(45,35,18,0.08)',
      borderStrong: 'rgba(45,35,18,0.16)',
      fg: '#2a2418',
      fgMuted: '#766c54',
      fgSubtle: '#a89e84',
      fgOnAccent: '#1f1505',
      accent: '#a36f2a',
      accentSoft: 'rgba(163,111,42,0.14)',
      accentBorder: 'rgba(163,111,42,0.30)',
      accentInk: '#6a4615',
      success: '#5d7c3d',
      successSoft: 'rgba(93,124,61,0.14)',
      successBorder: 'rgba(93,124,61,0.28)',
      successInk: '#3e5526',
      warning: '#a3722a',
      folder: '#8a6b1f',
      focusRing: '#a36f2a',
      shadow: 'rgba(45,35,18,0.12)',
      danger: '#b85a3a',
      dangerSoft: 'rgba(184,90,58,0.14)',
      dangerBorder: 'rgba(184,90,58,0.30)',
      dangerInk: '#6e3218',
    },
  },
  cyan: {
    dark: {
      bg: '#0d1117',
      surface0: '#090c12',
      surface1: '#151b24',
      surface2: '#1d2632',
      border: 'rgba(160,190,220,0.08)',
      borderStrong: 'rgba(160,190,220,0.18)',
      fg: '#dde4ed',
      fgMuted: '#8693a6',
      fgSubtle: '#566273',
      fgOnAccent: '#062029',
      accent: '#7dd3e8',
      accentSoft: 'rgba(125,211,232,0.13)',
      accentBorder: 'rgba(125,211,232,0.30)',
      accentInk: '#a8e0ee',
      success: '#86d4a4',
      successSoft: 'rgba(134,212,164,0.13)',
      successBorder: 'rgba(134,212,164,0.28)',
      successInk: '#a8dec0',
      warning: '#e8b87d',
      folder: '#d4b56a',
      focusRing: '#7dd3e8',
      shadow: 'rgba(0,0,0,0.5)',
      danger: '#f08a7a',
      dangerSoft: 'rgba(240,138,122,0.16)',
      dangerBorder: 'rgba(240,138,122,0.32)',
      dangerInk: '#f8c4bc',
    },
    light: {
      bg: '#f4f6f9',
      surface0: '#eaeef3',
      surface1: '#fbfcfd',
      surface2: '#e4e9f0',
      border: 'rgba(13,17,23,0.08)',
      borderStrong: 'rgba(13,17,23,0.16)',
      fg: '#1a2230',
      fgMuted: '#5d6b80',
      fgSubtle: '#8693a6',
      fgOnAccent: '#f4fafd',
      accent: '#2b7a96',
      accentSoft: 'rgba(43,122,150,0.13)',
      accentBorder: 'rgba(43,122,150,0.28)',
      accentInk: '#155269',
      success: '#3e8a5e',
      successSoft: 'rgba(62,138,94,0.14)',
      successBorder: 'rgba(62,138,94,0.26)',
      successInk: '#235b3d',
      warning: '#a3722a',
      folder: '#8a6b1f',
      focusRing: '#2b7a96',
      shadow: 'rgba(13,17,23,0.12)',
      danger: '#c75651',
      dangerSoft: 'rgba(199,86,81,0.12)',
      dangerBorder: 'rgba(199,86,81,0.28)',
      dangerInk: '#8a2f2b',
    },
  },
  coral: {
    dark: {
      bg: '#141416',
      surface0: '#0e0e10',
      surface1: '#1c1c1f',
      surface2: '#27272b',
      border: 'rgba(255,255,255,0.06)',
      borderStrong: 'rgba(255,255,255,0.14)',
      fg: '#e6e4e1',
      fgMuted: '#92908c',
      fgSubtle: '#5e5c58',
      fgOnAccent: '#2a0e10',
      accent: '#f5a3a0',
      accentSoft: 'rgba(245,163,160,0.12)',
      accentBorder: 'rgba(245,163,160,0.28)',
      accentInk: '#f8c4c1',
      success: '#a8c48a',
      successSoft: 'rgba(168,196,138,0.14)',
      successBorder: 'rgba(168,196,138,0.26)',
      successInk: '#c6dcae',
      warning: '#e8c47d',
      folder: '#d4b56a',
      focusRing: '#f5a3a0',
      shadow: 'rgba(0,0,0,0.48)',
      danger: '#f5a3a0',
      dangerSoft: 'rgba(245,163,160,0.14)',
      dangerBorder: 'rgba(245,163,160,0.30)',
      dangerInk: '#f8c4c1',
    },
    light: {
      bg: '#fafaf8',
      surface0: '#f3f3f1',
      surface1: '#ffffff',
      surface2: '#ededea',
      border: 'rgba(20,20,22,0.08)',
      borderStrong: 'rgba(20,20,22,0.16)',
      fg: '#1c1c1f',
      fgMuted: '#62605c',
      fgSubtle: '#92908c',
      fgOnAccent: '#fdf2f1',
      accent: '#c75651',
      accentSoft: 'rgba(199,86,81,0.10)',
      accentBorder: 'rgba(199,86,81,0.28)',
      accentInk: '#8a2f2b',
      success: '#4f7c3d',
      successSoft: 'rgba(79,124,61,0.12)',
      successBorder: 'rgba(79,124,61,0.26)',
      successInk: '#365824',
      warning: '#a3722a',
      folder: '#8a6b1f',
      focusRing: '#c75651',
      shadow: 'rgba(20,20,22,0.10)',
      danger: '#c75651',
      dangerSoft: 'rgba(199,86,81,0.10)',
      dangerBorder: 'rgba(199,86,81,0.28)',
      dangerInk: '#8a2f2b',
    },
  },
};

// ── Theme CSS ────────────────────────────────────────────────────────────────

function block(themeId, p, mode) {
  const elevated =
    mode === 'dark'
      ? 'color-mix(in srgb, var(--mn-fg) 10%, transparent)'
      : 'color-mix(in srgb, var(--mn-fg) 6%, transparent)';
  const overlay =
    mode === 'dark' ? 'color-mix(in srgb, var(--mn-bg) 72%, transparent)' : 'color-mix(in srgb, var(--mn-bg) 35%, transparent)';
  return `
:root[data-theme="${themeId}"],
.settings-theme-preview[data-theme="${themeId}"] {
  color-scheme: ${mode};

  --mn-bg: ${p.bg};
  --mn-surface-0: ${p.surface0};
  --mn-surface-1: ${p.surface1};
  --mn-surface-2: ${p.surface2};
  --mn-border: ${p.border};
  --mn-border-strong: ${p.borderStrong};
  --mn-fg: ${p.fg};
  --mn-fg-muted: ${p.fgMuted};
  --mn-fg-subtle: ${p.fgSubtle};
  --mn-fg-on-accent: ${p.fgOnAccent};
  --mn-accent: ${p.accent};
  --mn-accent-soft: ${p.accentSoft};
  --mn-accent-border: ${p.accentBorder};
  --mn-accent-ink: ${p.accentInk};
  --mn-success: ${p.success};
  --mn-success-soft: ${p.successSoft};
  --mn-success-border: ${p.successBorder};
  --mn-success-ink: ${p.successInk};
  --mn-warning: ${p.warning};
  --mn-focus-ring: ${p.focusRing};
  --mn-shadow: ${p.shadow};
  --mn-folder: ${p.folder};

  --mn-danger: ${p.danger};
  --mn-danger-soft: ${p.dangerSoft};
  --mn-danger-border: ${p.dangerBorder};
  --mn-danger-ink: ${p.dangerInk};
  --mn-warning-soft: color-mix(in srgb, var(--mn-warning) 18%, transparent);
  --mn-warning-border: color-mix(in srgb, var(--mn-warning) 32%, transparent);
  --mn-overlay: ${overlay};
  --mn-surface-elevated: ${elevated};

  --asst-bg: var(--mn-bg);
  --asst-bdr: var(--mn-border);
  --shadow-popover: 0 8px 28px var(--mn-shadow);
  --shadow-popover-soft: 0 4px 20px var(--mn-shadow);
  --shadow-popover-tall: 0 10px 32px var(--mn-shadow);
  --shadow-lift: 0 8px 24px var(--mn-shadow);
  --shadow-sidebar: 4px 0 24px var(--mn-shadow);
  --shadow-sidebar-left: -4px 0 24px var(--mn-shadow);
  --shadow-card: 0 2px 14px var(--mn-shadow);
  --shadow-drawer: -8px 0 36px var(--mn-shadow);

  --tool-call-panel-bg: var(--mn-surface-1);
  --tool-call-status-bg: var(--mn-surface-1);
  --tool-call-pre-bg: var(--mn-surface-0);
  --tool-call-status-ok-border: var(--mn-success-border);
  --tool-call-status-ok-bg: var(--mn-success-soft);
  --tool-call-status-fail-border: var(--mn-danger-border);
  --tool-call-status-fail-bg: var(--mn-danger-soft);

  --banner-danger-bg: var(--mn-danger-soft);
  --banner-danger-hover-bg: color-mix(in srgb, var(--mn-danger) 14%, var(--mn-surface-1));
  --banner-danger-hover-border: var(--mn-danger-border);
  --banner-danger-hover-text: var(--mn-danger-ink);

  --thought-bubble-bg: color-mix(in srgb, var(--mn-surface-1) 88%, transparent);
  --thought-flow-bg: var(--mn-surface-0);
  --thought-segment-bg: var(--mn-surface-1);

  --settings-warn-banner-border: var(--mn-warning-border);
  --settings-warn-banner-bg: var(--mn-warning-soft);

  --cm-keyword: var(--mn-danger);
  --cm-title: var(--mn-accent-ink);
  --cm-attr: var(--mn-accent);
  --cm-string: var(--mn-fg-muted);
}
`;
}

// ── Write file ───────────────────────────────────────────────────────────────

const families = Object.keys(PALETTES);
const themeBlocks = [];
for (const family of families) {
  themeBlocks.push(block(`${family}-dark`, PALETTES[family].dark, 'dark'));
  themeBlocks.push(block(`${family}-light`, PALETTES[family].light, 'light'));
}

const out = `/* Minnow palette tokens — hex/rgba only in theme blocks below. */

html,
body {
  background: var(--mn-bg);
  color: var(--mn-fg);
}

*,
*::before,
*::after {
  border-color: var(--mn-border);
}

:focus-visible {
  outline: 2px solid var(--mn-focus-ring);
  outline-offset: 2px;
}

:root {
  --radius-sm: 6px;
  --radius-md: 10px;
  --radius-lg: 14px;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: 0.15s;
  --duration-normal: 0.22s;
  --duration-slow: 0.35s;
  --font-ui: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --bp-compact: 600px;
  --bp-mobile: 640px;
  --bp-wide: 900px;
  --topbar-h: 52px;
  --sidebar-w: 240px;
  --sidebar-rail: 48px;
  --file-sidebar-w: 260px;
  --file-sidebar-rail: 48px;
  --viewer-min-w: 280px;
  --split-ratio: 0.55;
  --touch-min: 44px;
}
${themeBlocks.join('\n')}
`;

const dest = path.join(process.cwd(), 'src', 'styles', 'tokens.css');
fs.writeFileSync(dest, out.trim() + '\n');
console.log('wrote', dest);
