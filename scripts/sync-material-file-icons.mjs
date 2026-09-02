import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'node_modules', 'material-icon-theme', 'icons');
const OUT_DIR = path.join(ROOT, 'public', 'material-icons');

async function main() {
  try {
    await fs.access(SRC_DIR);
  } catch {
    console.warn('[material-icons] Skip: material-icon-theme not installed');
    return;
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  const entries = await fs.readdir(SRC_DIR, { withFileTypes: true });
  let copied = 0;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.svg')) continue;
    const from = path.join(SRC_DIR, entry.name);
    const to = path.join(OUT_DIR, entry.name);
    await fs.copyFile(from, to);
    copied += 1;
  }

  console.log(`[material-icons] Synced ${copied} SVGs → public/material-icons/`);
}

main().catch((err) => {
  console.error('[material-icons] Sync failed:', err);
  process.exit(1);
});
