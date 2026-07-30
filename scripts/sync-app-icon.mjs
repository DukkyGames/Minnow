#!/usr/bin/env node
/**
 * Build build/icon.ico and build/tray/* from Minnow logo assets.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pngToIco from 'png-to-ico';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pngDir = path.join(root, 'public', 'logos', 'minnow-logo', 'minnow', 'png');
const glyphSvg = path.join(root, 'public', 'logos', 'minnow-glyph.svg');
const trayDir = path.join(root, 'build', 'tray');
const sizes = [256, 128, 64, 48, 32, 16];
const files = sizes.map((size) => path.join(pngDir, `minnow-${size}.png`));

for (const file of files) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing logo PNG: ${file}`);
  }
}

if (!fs.existsSync(glyphSvg)) {
  throw new Error(`Missing tray glyph SVG: ${glyphSvg}`);
}

const buf = await pngToIco(files);
const dest = path.join(root, 'build', 'icon.ico');
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, buf);
console.log(`[sync-app-icon] Wrote ${dest} (${buf.length} bytes)`);

/** Render monochrome glyph PNGs for macOS template tray and Linux panel icons. */
async function writeTrayPng(outName, size) {
  const outPath = path.join(trayDir, outName);
  await sharp(glyphSvg, { density: 300 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(outPath);
  console.log(`[sync-app-icon] Wrote ${outPath} (${size}px)`);
}

fs.mkdirSync(trayDir, { recursive: true });
await writeTrayPng('trayTemplate.png', 22);
await writeTrayPng('trayTemplate@2x.png', 44);
await writeTrayPng('tray-linux.png', 24);
