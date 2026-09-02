import fs from 'node:fs';
import path from 'node:path';

const roots = [path.join('src', 'styles')];

let n = 0;
for (const root of roots) {
  const dir = path.join(process.cwd(), root);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.css') && !file.endsWith('.md')) continue;
    const fp = path.join(dir, file);
    let src = fs.readFileSync(fp, 'utf8');
    const next = src.replaceAll('color-mix(in oklch', 'color-mix(in srgb');
    if (next !== src) {
      fs.writeFileSync(fp, next);
      n++;
      console.log('fixed', path.join(root, file));
    }
  }
}
console.log('files updated:', n);
