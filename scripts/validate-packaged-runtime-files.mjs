#!/usr/bin/env node
/**
 * Ensure electron-builder "files" includes every src/ path the Node server reads at runtime.
 * Run before package / package:dir so packaged Minnow does not exit silently on boot.
 *
 * After MIN-354 Stage 3, runtime Session Engine TypeScript must not be imported from
 * server loaders — only server/session/engine-module.js may reference src/*.ts
 * (tsx path). Packaged builds load the gitignored engine-bundle.mjs instead.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(repoRoot, 'server');
const ENGINE_MODULE_REL = path.join('server', 'session', 'engine-module.js');

/** Paths under repo root that must ship inside the Electron asar. */
const REQUIRED_RUNTIME_PATHS = [
  'src/lsp/merge-config.mjs',
  'src/lsp/defaults.json',
  'src/lsp/bundles.json',
  'src/lib/fetch-web-content.mjs',
  'src/lib/untrusted.mjs',
  'src/lib/assert-public-url.mjs',
  'src/attachments/document-extensions.mjs',
  'src/skills/builtin-manifest.json',
  'src/chat/prompts/work-agents/registry.json',
  'src/state/session-schema.mjs',
  'build/icon.ico',
  // Session Engine bundle (built by build-engine-bundle.mjs, gitignored)
  'server/session/engine-bundle/engine-bundle.mjs',
];

/** Directory trees read recursively by server scan helpers. */
const REQUIRED_RUNTIME_DIRS = [
  'src/skills',
  'src/chat/prompts',
  'src/evals/packs',
];

/**
 * Strip block + line comments so JSDoc `import('../../src/…')` type refs are ignored.
 * @param {string} text
 * @returns {string}
 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * Collect runtime import specifiers from server .js/.mjs that reference ../../src/.
 * @param {string} dir
 * @returns {Array<{ file: string, spec: string }>}
 */
function collectServerSrcImports(dir) {
  /** @type {Array<{ file: string, spec: string }>} */
  const imports = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip the generated bundle — it is validated via REQUIRED_RUNTIME_PATHS.
      if (entry.name === 'engine-bundle') continue;
      imports.push(...collectServerSrcImports(full));
      continue;
    }
    if (!entry.name.endsWith('.js') && !entry.name.endsWith('.mjs')) continue;
    const text = stripComments(fs.readFileSync(full, 'utf8'));
    const staticRe = /from\s+['"]((?:\.\.\/)+src\/[^'"]+)['"]/g;
    const dynamicRe = /import\s*\(\s*['"]((?:\.\.\/)+src\/[^'"]+)['"]\s*\)/g;
    for (const re of [staticRe, dynamicRe]) {
      let match;
      while ((match = re.exec(text)) !== null) {
        imports.push({
          file: path.relative(repoRoot, full),
          spec: match[1].replace(/\//g, path.sep),
        });
      }
    }
  }
  return imports;
}

function assertExists(relPath) {
  const normalized = relPath.replace(/^(\.\.[\\/])+/, '');
  const full = path.join(repoRoot, normalized);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing packaged runtime file: ${normalized}`);
  }
}

function main() {
  for (const rel of REQUIRED_RUNTIME_PATHS) {
    assertExists(rel);
  }
  for (const rel of REQUIRED_RUNTIME_DIRS) {
    assertExists(rel);
  }

  const collected = collectServerSrcImports(serverRoot);

  // Sole resolution point may keep .ts imports for the tsx/dev path.
  const forbiddenTs = collected.filter((row) => {
    const isTs = row.spec.endsWith('.ts') || row.spec.endsWith('.tsx');
    if (!isTs) return false;
    const normFile = row.file.replace(/\\/g, '/');
    return normFile !== ENGINE_MODULE_REL.replace(/\\/g, '/');
  });
  if (forbiddenTs.length > 0) {
    const detail = forbiddenTs.map((r) => `  ${r.file} → ${r.spec}`).join('\n');
    throw new Error(
      `server files still hold direct TypeScript imports (must go through engine-module.js):\n${detail}`,
    );
  }

  // Non-TS src imports must exist on disk (and be covered by build.files).
  let checked = 0;
  for (const row of collected) {
    if (row.spec.endsWith('.ts') || row.spec.endsWith('.tsx')) continue;
    assertExists(row.spec);
    checked += 1;
  }

  console.log(
    `[validate-packaged-runtime-files] OK — ${REQUIRED_RUNTIME_PATHS.length} files, ${REQUIRED_RUNTIME_DIRS.length} trees, ${checked} server src imports (${collected.length - checked} tsx-only via engine-module)`,
  );
}

main();
