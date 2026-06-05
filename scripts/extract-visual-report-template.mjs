/**
 * One-off helper: extract Odysseus visual_report.py template + category CSS for Minnow port.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pyPath = 'C:/Users/dukky/Documents/Development/odysseus/src/visual_report.py';
const py = fs.readFileSync(pyPath, 'utf8');

/** @param {string} name */
function extractTripleQuoted(name) {
  const marker = `${name} = """`;
  const start = py.indexOf(marker);
  if (start < 0) {
    throw new Error(`Could not find ${name}`);
  }
  let contentStart = start + marker.length;
  if (py[contentStart] === '\\') {
    contentStart += 2; // skip backslash + newline
  }
  const end = py.indexOf('\n"""', contentStart);
  return py.slice(contentStart, end).replace(/\{\{/g, '{').replace(/\}\}/g, '}');
}

const catStart = py.indexOf('    palettes = """');
const catEnd = py.indexOf('    styles = {', catStart);
let palettes = py.slice(catStart + '    palettes = """'.length, catEnd).trim();
palettes = palettes.replace(/\{\{/g, '{').replace(/\}\}/g, '}').replace(/\n"""$/, '');

const stylesStart = py.indexOf('    styles = {');
const stylesEnd = py.indexOf('    # Always emit', stylesStart);
const stylesBlock = py.slice(stylesStart, stylesEnd);

/** @type {Record<string, string>} */
const styles = {};
for (const cat of ['product', 'comparison', 'howto', 'landscape', 'factcheck']) {
  const re = new RegExp(`"${cat}": """([\\s\\S]*?)""",`);
  const m = stylesBlock.match(re);
  if (m) {
    styles[cat] = m[1];
  }
}

const template = extractTripleQuoted('_TEMPLATE');
const outPath = path.resolve(__dirname, '../server/research/_visual-report-template-extract.json');
fs.writeFileSync(outPath, JSON.stringify({ template, palettes, styles }));
console.log('Wrote', outPath, 'template', template.length, 'chars');
