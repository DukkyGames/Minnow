#!/usr/bin/env node
/**
 * Build build/icon.ico from the Minnow logo PNG size ladder (Windows taskbar / electron-builder).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pngDir = path.join(root, 'public', 'logos', 'minnow-logo', 'minnow', 'png');
const sizes = [256, 128, 64, 48, 32, 16];
const files = sizes.map((size) => path.join(pngDir, `minnow-${size}.png`));

for (const file of files) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing logo PNG: ${file}`);
  }
}

const buf = await pngToIco(files);
const dest = path.join(root, 'build', 'icon.ico');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, buf);
console.log(`[sync-app-icon] Wrote ${dest} (${buf.length} bytes)`);
