#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'electron',
  'dist',
);

const renames = [
  ['preload.js', 'preload.mjs'],
  ['preload.js.map', 'preload.mjs.map'],
];

for (const [from, to] of renames) {
  const src = path.join(distDir, from);
  const dest = path.join(distDir, to);
  if (!fs.existsSync(src)) continue;
  fs.renameSync(src, dest);
}

const mjsPath = path.join(distDir, 'preload.mjs');
if (fs.existsSync(mjsPath)) {
  const original = fs.readFileSync(mjsPath, 'utf8');
  const patched = original.replace(
    /sourceMappingURL=preload\.js\.map/g,
    'sourceMappingURL=preload.mjs.map',
  );
  if (patched !== original) {
    fs.writeFileSync(mjsPath, patched);
  }
}
