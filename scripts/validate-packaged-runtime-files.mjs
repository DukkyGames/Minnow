#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const serverRoot = path.join(repoRoot, 'server');

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
  'src/agents/defaults/sub-agents.json',
  'src/styles/tokens.css',
  'build/icon.ico',
];

const REQUIRED_RUNTIME_DIRS = [
  'src/skills',
  'src/chat/prompts',
  'src/evals/packs',
  'src/models',
];

/** @returns {string[]} */
function loadElectronBuilderFilePatterns() {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
  return pkg.build?.files ?? [];
}

/**
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
 * @param {string} dir
 * @returns {{ src: string[], scripts: string[] }}
 */
function collectServerRuntimeImports(dir) {
/** @type {string[]} */
  const src = [];
/** @type {string[]} */
  const scripts = [];
  const importRe = /from\s+['"]((?:\.\.\/)+(?:src|scripts)\/[^'"]+)['"]/g;
  const importMetaUrlRe =
    /new\s+URL\(\s*['"]((?:\.\.\/)+(?:src|scripts)\/[^'"]+)['"]\s*,\s*import\.meta\.url\s*\)/g;
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
    const recordHit = (specifier) => {
      const resolved = path
        .relative(repoRoot, path.resolve(path.dirname(full), specifier))
        .replace(/\\/g, '/');
      if (resolved.startsWith('src/')) src.push(resolved);
      else if (resolved.startsWith('scripts/')) scripts.push(resolved);
    };
    let match;
    while ((match = importRe.exec(text)) !== null) {
      recordHit(match[1]);
    }
    while ((match = importMetaUrlRe.exec(text)) !== null) {
      recordHit(match[1]);
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
