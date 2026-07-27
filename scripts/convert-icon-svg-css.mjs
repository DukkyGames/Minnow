#!/usr/bin/env node
/**
 * Convert `.icon-svg { width: Npx; height: Npx; }` to `--mn-icon-size` in stylesheets.
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const stylesDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'styles');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (name.endsWith('.css')) out.push(p);
  }
  return out;
}

let filesChanged = 0;
let rulesChanged = 0;

for (const file of walk(stylesDir)) {
  let css = readFileSync(file, 'utf8');
  const before = css;

  // width + height on .icon-svg (allow other properties between)
  css = css.replace(
    /(\.icon-svg\s*\{[^}]*?)width:\s*(\d+(?:\.\d+)?)px;\s*height:\s*\2px;([^}]*\})/g,
    '$1--mn-icon-size: $2px;$3',
  );
  css = css.replace(
    /(\.icon-svg\s*\{[^}]*?)height:\s*(\d+(?:\.\d+)?)px;\s*width:\s*\2px;([^}]*\})/g,
    '$1--mn-icon-size: $2px;$3',
  );

  // Remove stroke rules targeting .icon-svg children
  css = css.replace(/\s*stroke:\s*[^;]+;/g, (m, offset, str) => {
    const slice = str.slice(Math.max(0, offset - 120), offset);
    if (slice.includes('.icon-svg') || slice.includes('icon-btn')) return m;
    return m;
  });

  if (css !== before) {
    writeFileSync(file, css);
    filesChanged++;
    rulesChanged++;
  }
}

console.log(`icon-svg-css: updated ${filesChanged} files`);
