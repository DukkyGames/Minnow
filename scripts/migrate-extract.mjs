/**
 * One-time extractor: splits index.html into CSS, HTML body, and raw app JS.
 * Run from repo root: node scripts/migrate-extract.mjs
 */
import fs from 'fs';
import path from 'path';

const root = path.resolve(import.meta.dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(/<body>([\s\S]*?)<!-- Markdown \+/);
const stateMarker = '// ── State ──';
const stateIdx = html.indexOf(stateMarker);
const scriptOpen = stateIdx >= 0 ? html.lastIndexOf('<script>', stateIdx) : -1;
const scriptEnd = html.lastIndexOf('</script>');
const appJs =
  scriptOpen >= 0 && scriptEnd > scriptOpen
    ? html.slice(scriptOpen + '<script>'.length, scriptEnd).replace(/^\s+/, '')
    : null;

if (!styleMatch || !bodyMatch || !appJs) {
  console.error('Could not parse index.html sections');
  process.exit(1);
}

let css = styleMatch[1].trim();
// Drop Google Fonts @import; Vite will load via link in index.html
css = css.replace(/@import url\([^)]+\);\s*\n?/, '');

const cssSections = [
  { file: 'tokens.css', start: ':root', end: '/* ─── TOPBAR' },
  { file: 'global.css', start: '/* ─── TOPBAR', end: '/* ─── TOPBAR' }, // fixed below
];

const markers = [
  { file: 'tokens.css', from: 0, toMarker: '/* ─── TOPBAR' },
  { file: 'global.css', fromMarker: '* { box-sizing', toMarker: '/* ─── TOPBAR' },
  { file: 'topbar.css', fromMarker: '/* ─── TOPBAR', toMarker: '/* ─── APP BODY' },
  { file: 'sidebar.css', fromMarker: '/* ─── APP BODY', toMarker: '/* ─── SETTINGS DRAWER' },
  { file: 'settings.css', fromMarker: '/* ─── SETTINGS DRAWER', toMarker: '/* ─── CHAT AREA' },
  { file: 'messages.css', fromMarker: '/* ─── CHAT AREA', toMarker: '/* ─── INPUT BAR' },
  { file: 'input.css', fromMarker: '/* ─── INPUT BAR', toMarker: '/* ─── STATS STRIP' },
  { file: 'stats.css', fromMarker: '/* ─── STATS STRIP', toMarker: '/* ─── Responsive adapt' },
  { file: 'responsive.css', fromMarker: '/* ─── Responsive adapt', toMarker: null },
];

function sliceCss(fromMarker, toMarker) {
  const start = css.indexOf(fromMarker);
  if (start < 0) throw new Error(`Marker not found: ${fromMarker}`);
  const end = toMarker ? css.indexOf(toMarker, start + 1) : css.length;
  if (toMarker && end < 0) throw new Error(`End marker not found: ${toMarker}`);
  return css.slice(start, end < 0 ? css.length : end).trim() + '\n';
}

const stylesDir = path.join(root, 'src', 'styles');
fs.mkdirSync(stylesDir, { recursive: true });

for (const { file, fromMarker, toMarker } of markers) {
  const chunk =
    file === 'tokens.css'
      ? css.slice(0, css.indexOf('/* ─── TOPBAR')).trim() + '\n'
      : sliceCss(fromMarker, toMarker);
  fs.writeFileSync(path.join(stylesDir, file), chunk);
  console.log('Wrote', file, chunk.length, 'chars');
}

// HTML body without CDN scripts at end
let body = bodyMatch[1].trim();
body = body.replace(
  /<!-- Markdown[\s\S]*$/,
  ''
).trim();

fs.writeFileSync(path.join(root, 'scripts', '_extracted-body.html'), body);
fs.writeFileSync(path.join(root, 'scripts', '_extracted-app.js'), appJs);
console.log('Wrote scripts/_extracted-body.html and scripts/_extracted-app.js');
