/**
 * Minnow context loader: upstream PRODUCT/DESIGN JSON plus .impeccable/design.json.
 * Prints one JSON object to stdout for agent consumption.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext } from './load-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: src/skills/impeccable/scripts → four levels up. */
const PROJECT_ROOT = path.resolve(__dirname, '../../../..');

/**
 * @param {string} contextDir
 * @returns {Record<string, unknown>}
 */
function readDesignJson(contextDir) {
  const designJsonPath = path.join(contextDir, '.impeccable', 'design.json');
  if (!fs.existsSync(designJsonPath)) {
    throw new Error(
      `Missing ${path.relative(PROJECT_ROOT, designJsonPath)} — run impeccable document or add design tokens`,
    );
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(designJsonPath, 'utf8'));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Invalid .impeccable/design.json: ${message}`);
  }

  if (parsed.schemaVersion !== 2) {
    throw new Error(
      `Expected design.json schemaVersion 2, got ${String(parsed.schemaVersion)}`,
    );
  }

  return parsed;
}

function main() {
  const prevCwd = process.cwd();
  try {
    process.chdir(PROJECT_ROOT);
    const ctx = loadContext(PROJECT_ROOT);
    const designJson = readDesignJson(ctx.contextDir);

    const payload = {
      ...ctx,
      designJson,
      designJsonPath: path.relative(PROJECT_ROOT, path.join(ctx.contextDir, '.impeccable', 'design.json')),
    };

    console.log(JSON.stringify(payload, null, 2));
  } finally {
    process.chdir(prevCwd);
  }
}

main();
