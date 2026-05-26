/**
 * Regenerate multimodal-probe-image.ts from multimodal-probe-fish.png.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pngPath = path.join(root, 'src/benchmark/fixtures/multimodal-probe-fish.png');
const outPath = path.join(root, 'src/benchmark/fixtures/multimodal-probe-image.ts');

const bytes = fs.readFileSync(pngPath);
const dataUrl = `data:image/png;base64,${bytes.toString('base64')}`;
const source = `/** Fish photo used by cap-multimodal (from multimodal-probe-fish.png). */\nexport const MULTIMODAL_PROBE_IMAGE_DATA_URL = ${JSON.stringify(dataUrl)};\n`;
fs.writeFileSync(outPath, source, 'utf8');
console.log(`Wrote ${outPath} (${dataUrl.length} chars)`);
