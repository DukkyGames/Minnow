#!/usr/bin/env node
/**
 * Postinstall patches for third-party packages that still pull deprecated deps.
 * Complements package.json overrides for packages where npm linking is unreliable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {string} relativePath
 * @returns {string | null}
 */
function readIfExists(relativePath) {
  const absolutePath = path.join(root, relativePath);
  if (!fs.existsSync(absolutePath)) {
    return null;
  }
  return fs.readFileSync(absolutePath, 'utf8');
}

/**
 * @param {string} relativePath
 * @param {string} contents
 */
function writeIfChanged(relativePath, contents) {
  const absolutePath = path.join(root, relativePath);
  const previous = fs.existsSync(absolutePath) ? fs.readFileSync(absolutePath, 'utf8') : null;
  if (previous === contents) {
    return false;
  }
  fs.writeFileSync(absolutePath, contents, 'utf8');
  return true;
}

/** graphql-language-service-cli still requires @babel/polyfill on Node 16; Minnow targets Node 20+. */
function patchGraphqlLanguageServiceCli() {
  const relativePath = 'node_modules/graphql-language-service-cli/bin/graphql.js';
  const source = readIfExists(relativePath);
  if (!source) {
    return;
  }

  const next = source.replace(/^require\('@babel\/polyfill'\);\r?\n/m, '');
  if (next === source) {
    return;
  }

  writeIfChanged(relativePath, next);
  console.log('[patch-deprecated-deps] Removed @babel/polyfill from graphql-language-service-cli');
}

patchGraphqlLanguageServiceCli();
