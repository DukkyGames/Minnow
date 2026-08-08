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
  'src/product-wiki/path-filter.mjs',
  'src/styles/tokens.css',
  'build/icon.ico',
];

/** Directory trees read recursively by server scan helpers. */
const REQUIRED_RUNTIME_DIRS = [
  'src/skills',
  'src/chat/prompts',
  'src/evals/packs',
];

/** @returns {string[]} */
function loadElectronBuilderFilePatterns() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  return pkg.build?.files ?? [];
}

/**
 * Whether a repo-relative path is included by electron-builder "files" (negation patterns ignored).
 * @param {string} relativePath
 * @param {string[]} patterns
 */
function isIncludedInElectronFiles(relativePath, patterns) {
  const normalized = relativePath.replace(/\\/g, '/');
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue;
    const p = pattern.replace(/\\/g, '/');
    if (p.endsWith('/**')) {
      const prefix = p.slice(0, -3);
      if (normalized === prefix || normalized.startsWith(`${prefix}/`)) return true;
      continue;
    }
    if (p.includes('*')) continue;
    if (normalized === p) return true;
  }
  return false;
}

/**
 * Collect repo-relative imports from server .js files under src/ or scripts/.
 * @param {string} dir
 * @returns {{ src: string[], scripts: string[] }}
 */
function collectServerRuntimeImports(dir) {
  /** @type {string[]} */
  const src = [];
  /** @type {string[]} */
  const scripts = [];
  const importRe = /from\s+['"]((?:\.\.\/)+(?:src|scripts)\/[^'"]+)['"]/g;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = collectServerRuntimeImports(full);
      src.push(...nested.src);
      scripts.push(...nested.scripts);
      continue;
    }
    if (!entry.name.endsWith('.js')) continue;
    const text = fs.readFileSync(full, 'utf8');
    let match;
    while ((match = importRe.exec(text)) !== null) {
      const resolved = path
        .relative(repoRoot, path.resolve(path.dirname(full), match[1]))
        .replace(/\\/g, '/');
      if (resolved.startsWith('src/')) src.push(resolved);
      else if (resolved.startsWith('scripts/')) scripts.push(resolved);
    }
  }
  return { src, scripts };
}

function assertExists(relPath) {
  const normalized = relPath.replace(/^(\.\.[\\/])+/, '');
  const full = path.join(repoRoot, normalized);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing packaged runtime file: ${normalized}`);
  }
}

function main() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  const asarUnpack = pkg.build?.asarUnpack ?? [];
  for (const required of [
    'node_modules/@vscode/ripgrep/**',
    'node_modules/@vscode/ripgrep-*/**',
  ]) {
    if (!asarUnpack.includes(required)) {
      throw new Error(
        `electron-builder asarUnpack missing ripgrep pattern: ${required}`,
      );
    }
  }

  for (const rel of REQUIRED_RUNTIME_PATHS) {
    assertExists(rel);
  }
  for (const rel of REQUIRED_RUNTIME_DIRS) {
    assertExists(rel);
  }

  const electronFiles = loadElectronBuilderFilePatterns();
  const dynamicImports = collectServerRuntimeImports(serverRoot);
  const uniqueSrc = [...new Set(dynamicImports.src)];
  const uniqueScripts = [...new Set(dynamicImports.scripts)];

  for (const relImport of uniqueSrc) {
    assertExists(relImport);
    if (!isIncludedInElectronFiles(relImport, electronFiles)) {
      throw new Error(
        `Server src import is not listed in electron-builder files: ${relImport}`,
      );
    }
  }

  const unpackagedScripts = uniqueScripts.filter(
    (relImport) => !isIncludedInElectronFiles(relImport, electronFiles),
  );
  if (unpackagedScripts.length) {
    throw new Error(
      `Server scripts imports missing from electron-builder files: ${unpackagedScripts.join(', ')}`,
    );
  }

  console.log(
    `[validate-packaged-runtime-files] OK — ${REQUIRED_RUNTIME_PATHS.length} files, ${REQUIRED_RUNTIME_DIRS.length} trees, ${uniqueSrc.length} server src imports, ${uniqueScripts.length} server scripts imports`,
  );
}

main();
