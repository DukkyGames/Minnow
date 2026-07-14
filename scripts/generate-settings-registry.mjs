#!/usr/bin/env node
/**
 * Generate server/settings/registry-manifest.json from the client field registry.
 * Run: npm run settings-registry:generate
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exportRegistryManifest } from '../src/settings/field-registry.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '../server/settings/registry-manifest.json');

const manifest = exportRegistryManifest();
await fs.mkdir(path.dirname(outPath), { recursive: true });
await fs.writeFile(outPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(`Wrote ${manifest.length} settings fields → ${outPath}`);
