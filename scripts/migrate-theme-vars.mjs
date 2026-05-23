/**
 * One-shot mechanical rename: legacy CSS vars → --mn-* across src/styles.
 * Run: node scripts/migrate-theme-vars.mjs
 */
import fs from 'node:fs';
import path from 'node:path';

const stylesDir = path.join(process.cwd(), 'src', 'styles');
const files = fs.readdirSync(stylesDir).filter((f) => f.endsWith('.css'));

/** Longest-first so partial names are not double-replaced. */
const VAR_RENAMES = [
  ['--text-muted', '--mn-fg-muted'],
  ['--text-hover', '--mn-fg-on-accent'],
  ['--border-strong', '--mn-border-strong'],
  ['--accent-subtle', '--mn-accent-soft'],
  ['--surface-elevated', '--mn-surface-elevated'],
  ['--send-btn-icon-stroke', '--mn-fg-on-accent'],
  ['--tool-call-status-ok-border', '--mn-success-border'],
  ['--tool-call-status-ok-bg', '--mn-success-soft'],
  ['--tool-call-status-fail-border', '--mn-danger-border'],
  ['--tool-call-status-fail-bg', '--mn-danger-soft'],
  ['--markdown-inline-code-border', '--mn-border'],
  ['--markdown-inline-code-bg', '--mn-surface-0'],
  ['--markdown-table-header-bg', '--mn-surface-2'],
  ['--settings-warn-banner-border', '--mn-warning-border'],
  ['--settings-warn-banner-bg', '--mn-warning-soft'],
  ['--banner-danger-hover-border', '--mn-danger-border'],
  ['--banner-danger-hover-text', '--mn-danger-ink'],
  ['--banner-danger-hover-bg', '--mn-danger-soft'],
  ['--banner-danger-bg', '--mn-danger-soft'],
  ['--tool-call-status-bg', '--mn-surface-1'],
  ['--tool-call-panel-bg', '--mn-surface-1'],
  ['--tool-call-pre-bg', '--mn-surface-0'],
  ['--thought-segment-bg', '--mn-surface-1'],
  ['--thought-flow-bg', '--mn-surface-0'],
  ['--thought-bubble-bg', '--mn-surface-1'],
  ['--code-inline-bg', '--mn-surface-0'],
  ['--send-btn-fg', '--mn-fg-on-accent'],
  ['--elevated-fg', '--mn-fg'],
  ['--surface-2', '--mn-surface-2'],
  ['--user-bdr', '--mn-accent-border'],
  ['--user-bg', '--mn-accent-soft'],
  ['--text-dim', '--mn-fg-subtle'],
  ['--ink-muted', '--mn-fg-subtle'],
  ['--accent-dim', '--mn-accent-soft'],
  ['--accent-ink', '--mn-accent-ink'],
  ['--border2', '--mn-border-strong'],
  ['--surface2', '--mn-surface-2'],
  ['--cyan-glow', '--mn-accent-soft'],
  ['--cyan-dim', '--mn-accent-soft'],
  ['--asst-bdr', '--mn-border'],
  ['--asst-bg', '--mn-bg'],
  ['--code-bg', '--mn-surface-0'],
  ['--muted', '--mn-fg-muted'],
  ['--overlay', '--mn-overlay'],
  ['--surface', '--mn-surface-1'],
  ['--border', '--mn-border'],
  ['--accent', '--mn-accent'],
  ['--success', '--mn-success'],
  ['--warning', '--mn-warning'],
  ['--danger', '--mn-danger'],
  ['--cyan', '--mn-accent'],
  ['--green', '--mn-success'],
  ['--yellow', '--mn-warning'],
  ['--red', '--mn-danger'],
  ['--text', '--mn-fg'],
  ['--bg', '--mn-bg'],
];

const SELECTOR_REPLACEMENTS = [
 [/html\[data-theme=['"]dark['"]\]/g, 'html[data-theme$="-dark"]'],
 [/html\[data-theme=['"]light['"]\]/g, 'html[data-theme$="-light"]'],
 [/\[data-theme=['"]dark['"]\]/g, '[data-theme$="-dark"]'],
 [/\[data-theme=['"]light['"]\]/g, '[data-theme$="-light"]'],
];

let total = 0;
for (const file of files) {
  if (file === 'tokens.css') continue;
  const fp = path.join(stylesDir, file);
  let src = fs.readFileSync(fp, 'utf8');
  const before = src;
  for (const [from, to] of VAR_RENAMES) {
    src = src.split(from).join(to);
  }
  for (const [re, to] of SELECTOR_REPLACEMENTS) {
    src = src.replace(re, to);
  }
  if (src !== before) {
    fs.writeFileSync(fp, src);
    total += 1;
    console.log('updated', file);
  }
}
console.log('done, files changed:', total);
