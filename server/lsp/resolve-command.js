/**
 * Resolve LSP spawn commands to bundled Minnow binaries (no global install).
 */

import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot } from '../workspace/root.js';

/** @typedef {{ argv: string[], displayBin: string }} ResolvedLspSpawn */

/**
 * Resolve a package entry from Minnow's install root (works on Windows without .cmd).
 * @param {string} specifier - e.g. "typescript-language-server/lib/cli.mjs"
 * @returns {string}
 */
function resolveFromAppRoot(specifier) {
  const pkgJson = path.join(getAppRoot(), 'package.json');
  if (!fs.existsSync(pkgJson)) {
    throw new Error(`Minnow package.json not found at ${pkgJson}`);
  }
  const require = createRequire(pkgJson);
  return require.resolve(specifier);
}

/**
 * Full argv for the bundled TypeScript/JavaScript language server.
 * @param {string[]} extraArgs - user-provided flags after the binary name
 * @returns {ResolvedLspSpawn}
 */
/** Bundled tsserver.js (used when the workspace has no local typescript). */
export function getBundledTsserverPath() {
  return resolveFromAppRoot('typescript/lib/tsserver.js');
}

function stripLegacyTsserverCliFlags(extraArgs) {
  const flags = [];
  for (let i = 0; i < extraArgs.length; i++) {
    if (extraArgs[i] === '--stdio') continue;
    if (extraArgs[i] === '--tsserver-path') {
      i += 1;
      continue;
    }
    flags.push(extraArgs[i]);
  }
  return flags;
}

function buildTypeScriptLanguageServerArgv(extraArgs = []) {
  const cli = resolveFromAppRoot('typescript-language-server/lib/cli.mjs');
  return {
    argv: ['node', cli, '--stdio', ...stripLegacyTsserverCliFlags(extraArgs)],
    displayBin: 'typescript-language-server',
  };
}

/**
 * Map defaults / user command arrays to a concrete spawn argv.
 * @param {string[]} command
 * @returns {ResolvedLspSpawn}
 */
export function resolveLspSpawnArgv(command) {
  if (!Array.isArray(command) || command.length === 0) {
    return { argv: [], displayBin: '' };
  }

  const head = command[0];
  const tail = command.slice(1);

  if (head === '$minnow:typescript-language-server') {
    return buildTypeScriptLanguageServerArgv(tail);
  }

  if (head === 'typescript-language-server') {
    return buildTypeScriptLanguageServerArgv(tail);
  }

  const mapped = command.map((part) => {
    if (part === 'test/fixtures/fake-lsp.mjs') {
      return path.join(getAppRoot(), 'test/fixtures/fake-lsp.mjs');
    }
    if (part === '$minnow:tsserver') {
      return resolveFromAppRoot('typescript/lib/tsserver.js');
    }
    return part;
  });

  return { argv: mapped, displayBin: mapped[0] ?? '' };
}
