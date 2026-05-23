/**
 * Rename legacy CSS vars in reef widget markdown templates.
 */
import fs from 'node:fs';
import path from 'node:path';

const dirs = [
  path.join('src', 'chat', 'reef', 'widgets'),
  path.join('src', 'agents', 'prompts', 'sub-agents'),
  path.join('src', 'chat', 'prompts', 'modes'),
];

const REPLACES = [
  ['--text-muted', '--mn-fg-muted'],
  ['--text-hover', '--mn-fg-on-accent'],
  ['--border-strong', '--mn-border-strong'],
  ['--accent-subtle', '--mn-accent-soft'],
  ['--surface-elevated', '--mn-surface-elevated'],
  ['--surface-2', '--mn-surface-2'],
  ['--surface-1', '--mn-surface-1'],
  ['--surface-0', '--mn-surface-0'],
  ['--text-dim', '--mn-fg-subtle'],
  ['--user-bg', '--mn-accent-soft'],
  ['--user-bdr', '--mn-accent-border'],
  ['--accent-dim', '--mn-accent-soft'],
  ['--border', '--mn-border'],
  ['--accent', '--mn-accent'],
  ['--success', '--mn-success'],
  ['--warning', '--mn-warning'],
  ['--danger', '--mn-danger'],
  ['--surface', '--mn-surface-1'],
  ['--text', '--mn-fg'],
  ['--bg', '--mn-bg'],
];

let n = 0;
for (const dir of dirs) {
  const full = path.join(process.cwd(), dir);
  if (!fs.existsSync(full)) continue;
  for (const file of fs.readdirSync(full)) {
    if (!file.endsWith('.md')) continue;
    const fp = path.join(full, file);
    let src = fs.readFileSync(fp, 'utf8');
    const before = src;
    for (const [from, to] of REPLACES) {
      src = src.split(from).join(to);
    }
    if (src !== before) {
      fs.writeFileSync(fp, src);
      n++;
      console.log('updated', path.join(dir, file));
    }
  }
}

const errorUi = path.join(process.cwd(), 'src', 'chat', 'reef', 'widget-error-ui.ts');
if (fs.existsSync(errorUi)) {
  let src = fs.readFileSync(errorUi, 'utf8');
  const before = src;
  for (const [from, to] of REPLACES) {
    src = src.split(from).join(to);
  }
  if (src !== before) {
    fs.writeFileSync(errorUi, src);
    console.log('updated widget-error-ui.ts');
  }
}

console.log('reef files changed:', n);
