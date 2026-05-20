/**
 * Minnow context loader: upstream PRODUCT/DESIGN JSON plus .impeccable/design.json.
 * Prints one JSON object to stdout for agent consumption.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadContext } from './load-context.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Minnow install root: src/skills/impeccable/scripts → four levels up. */
const APP_ROOT = path.resolve(__dirname, '../../../..');

/**
 * Workspace where PRODUCT.md, DESIGN.md, and .impeccable/ live.
 * IMPECCABLE_CONTEXT_DIR is set by Minnow's load_impeccable_context tool.
 */
function resolveWorkspaceRoot() {
  const envDir = process.env.IMPECCABLE_CONTEXT_DIR?.trim();
  if (envDir) {
    return path.isAbsolute(envDir) ? envDir : path.resolve(APP_ROOT, envDir);
  }
  return APP_ROOT;
}

/**
 * @param {string} contextDir
 * @param {string} workspaceRoot for relative paths in errors
 * @returns {Record<string, unknown>}
 */
function readDesignJson(contextDir, workspaceRoot) {
  const designJsonPath = path.join(contextDir, '.impeccable', 'design.json');
  if (!fs.existsSync(designJsonPath)) {
    throw new Error(
      `Missing ${path.relative(workspaceRoot, designJsonPath)} — run impeccable document or add design tokens`,
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
  const workspaceRoot = resolveWorkspaceRoot();
  const ctx = loadContext(workspaceRoot);
  const designJson = readDesignJson(ctx.contextDir, workspaceRoot);

  const payload = {
    ...ctx,
    designJson,
    appRoot: APP_ROOT,
    workspaceRoot,
    designJsonPath: path.relative(
      workspaceRoot,
      path.join(ctx.contextDir, '.impeccable', 'design.json'),
    ),
  };

  console.log(JSON.stringify(payload, null, 2));
}

main();
