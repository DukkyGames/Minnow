#!/usr/bin/env node
/**
 * Ensure electron-builder "files" includes every src/ path the Node server reads at runtime.
 * Run before package / package:dir so packaged Minnow does not exit silently on boot.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(repoRoot, 'server');

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
];

/** Directory trees read recursively by server scan helpers. */
const REQUIRED_RUNTIME_DIRS = [
  'src/skills',
  'src/chat/prompts',
  'src/evals/packs',
];

/**
 * Collect import specifiers from server .js files that reference ../../src/.
 * @param {string} dir
 * @returns {string[]}
 */
function collectServerSrcImports(dir) {
  /** @type {string[]} */
  const imports = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      imports.push(...collectServerSrcImports(full));
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const text = fs.readFileSync(full, 'utf8');
    const re = /from\s+['"](\.\.\/\.\.\/src\/[^'"]+)['"]/g;
    let match;
    while ((match = re.exec(text)) !== null) {
      imports.push(match[1].replace(/\//g, path.sep));
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

  const dynamicImports = collectServerSrcImports(serverRoot);
  for (const relImport of dynamicImports) {
    assertExists(relImport);
  }

  console.log(
    `[validate-packaged-runtime-files] OK — ${REQUIRED_RUNTIME_PATHS.length} files, ${REQUIRED_RUNTIME_DIRS.length} trees, ${dynamicImports.length} server src imports`,
  );
}

main();
