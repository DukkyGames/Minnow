import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { getAppRoot, getWorkspaceRoot } from '../workspace/root.js';
import {
  findExecutableInPaths,
  getLspSearchPaths,
  getManagedLspNpmRoot,
} from './paths.js';
import { getLspNodeExecutable, isNodeCommandToken } from './node-runtime.js';

/** @typedef {{ argv: string[], displayBin: string }} ResolvedLspSpawn */

/**
 * @param {string} rootDir
 * @param {string} specifier
 * @returns {string | undefined}
 */
function tryResolveFromRoot(rootDir, specifier) {
  const pkgJson = path.join(rootDir, 'package.json');
  if (!fs.existsSync(pkgJson)) return undefined;
  try {
    const require = createRequire(pkgJson);
    return require.resolve(specifier);
  } catch {
    return undefined;
  }
}

/**
 * @param {string} specifier
 * @returns {string}
 */
function resolvePackageSpec(specifier) {
  const resolved = tryResolvePackageSpec(specifier);
  if (resolved) return resolved;
  throw new Error(
    `Cannot resolve "${specifier}" — install the language server bundle in Settings or run npm install in the project.`,
  );
}

/**
 * @param {string} specifier
 * @returns {string | undefined}
 */
function tryResolvePackageSpec(specifier) {
  const workspace = getWorkspaceRoot();
  const managed = getManagedLspNpmRoot();
  const appRoot = getAppRoot();

  const fromWorkspace = tryResolveFromRoot(workspace, specifier);
  if (fromWorkspace) return fromWorkspace;

  const fromApp = tryResolveFromRoot(appRoot, specifier);
  if (fromApp) return fromApp;

  const fromManaged = tryResolveFromRoot(managed, specifier);
  if (fromManaged) return fromManaged;

  return undefined;
}

/**
 * @param {string} minnowId
 * @returns {string}
 */
function resolveVscodeLangserversExtractedEntry(minnowId) {
  const candidatesById = {
    'vscode-html-language-server': [
      'vscode-langservers-extracted/lib/html-language-server/node/htmlServerMain.js',
      'vscode-langservers-extracted/lib/htmlServerMain.js',
    ],
    'vscode-css-language-server': [
      'vscode-langservers-extracted/lib/css-language-server/node/cssServerMain.js',
      'vscode-langservers-extracted/lib/cssServerMain.js',
    ],
    'vscode-json-language-server': [
      'vscode-langservers-extracted/lib/json-language-server/node/jsonServerMain.js',
      'vscode-langservers-extracted/lib/jsonServerMain.js',
    ],
  };
  const candidates = candidatesById[minnowId];
  if (!candidates) {
    throw new Error(`Unknown vscode-langservers entry: ${minnowId}`);
  }
  for (const spec of candidates) {
    const resolved = tryResolvePackageSpec(spec);
    if (resolved) return resolved;
  }
  throw new Error(
    `Cannot resolve ${minnowId} — install vscode-langservers-extracted in Settings → Language bundles or run npm install in the Minnow app folder.`,
  );
}

/**
 * @param {string} specifier
 * @returns {string}
 */
function resolveFromAppRoot(specifier) {
  return resolvePackageSpec(specifier);
}

/**
 * @param {string[]} extraArgs
 * @returns {ResolvedLspSpawn}
 */
const TSSERVER_SPECIFIERS = [
  'typescript/lib/tsserver.js',
  'tsserver-fallback/lib/tsserver.js',
];

/**
 * @returns {string | undefined}
 */
export function tryResolveBundledTsserverPath() {
  for (const spec of TSSERVER_SPECIFIERS) {
    const resolved = tryResolvePackageSpec(spec);
    if (resolved) return resolved;
  }
  return undefined;
}

export function getBundledTsserverPath() {
  const resolved = tryResolveBundledTsserverPath();
  if (resolved) return resolved;
  throw new Error(
    'Cannot resolve bundled tsserver — install typescript (≤6) or tsserver-fallback in the app bundle.',
  );
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

function buildNodeCliArgv(cliPath, displayBin, extraArgs = []) {
  return {
    argv: [getLspNodeExecutable(), cliPath, ...extraArgs],
    displayBin,
  };
}

function buildTypeScriptLanguageServerArgv(extraArgs = []) {
  const cli = resolveFromAppRoot('typescript-language-server/lib/cli.mjs');
  return {
    argv: [
      getLspNodeExecutable(),
      cli,
      '--stdio',
      ...stripLegacyTsserverCliFlags(extraArgs),
    ],
    displayBin: 'typescript-language-server',
  };
}

const MINNOW_NODE_SERVERS = {
  'typescript-language-server': {
    spec: 'typescript-language-server/lib/cli.mjs',
    build: buildTypeScriptLanguageServerArgv,
  },
  'pyright-langserver': {
    spec: 'pyright/langserver.index.js',
    args: ['--stdio'],
    display: 'pyright-langserver',
  },
  'yaml-language-server': {
    spec: 'yaml-language-server/out/server/src/server.js',
    args: ['--stdio'],
    display: 'yaml-language-server',
  },
  'bash-language-server': {
    spec: 'bash-language-server/out/cli.js',
    args: ['start'],
    display: 'bash-language-server',
  },
  'docker-langserver': {
    spec: 'dockerfile-language-server-nodejs/lib/server.js',
    args: ['--stdio'],
    display: 'docker-langserver',
  },
  'graphql-lsp': {
    spec: 'graphql-language-service-cli/bin/graphql.js',
    args: ['server', '-m', 'stream'],
    display: 'graphql-lsp',
  },
  'vscode-html-language-server': {
    resolve: () => resolveVscodeLangserversExtractedEntry('vscode-html-language-server'),
    args: ['--stdio'],
    display: 'vscode-html-language-server',
  },
  'vscode-css-language-server': {
    resolve: () => resolveVscodeLangserversExtractedEntry('vscode-css-language-server'),
    args: ['--stdio'],
    display: 'vscode-css-language-server',
  },
  'vscode-json-language-server': {
    resolve: () => resolveVscodeLangserversExtractedEntry('vscode-json-language-server'),
    args: ['--stdio'],
    display: 'vscode-json-language-server',
  },
};

/**
 * @param {string} minnowId
 * @param {string[]} tail
 * @returns {ResolvedLspSpawn}
 */
function resolveMinnowToken(minnowId, tail) {
  const entry = MINNOW_NODE_SERVERS[minnowId];
  if (!entry) {
    throw new Error(`Unknown Minnow LSP bundle token: $minnow:${minnowId}`);
  }
  if (typeof entry.build === 'function') {
    return entry.build(tail);
  }
  const cli =
    typeof entry.resolve === 'function'
      ? entry.resolve()
      : resolvePackageSpec(entry.spec);
  const args = tail.length > 0 ? tail : (entry.args ?? ['--stdio']);
  return buildNodeCliArgv(cli, entry.display ?? minnowId, args);
}

/**
 * @param {string} bin
 * @returns {string}
 */
export function resolveLspExecutable(bin) {
  if (isNodeCommandToken(bin)) {
    return getLspNodeExecutable();
  }
  if (!bin || bin.includes(path.sep) || bin.startsWith('.')) {
    return bin;
  }
  const found = findExecutableInPaths(bin, getLspSearchPaths());
  return found ?? bin;
}

/**
 * @param {string[]} command
 * @returns {ResolvedLspSpawn}
 */
export function resolveLspSpawnArgv(command) {
  if (!Array.isArray(command) || command.length === 0) {
    return { argv: [], displayBin: '' };
  }

  const head = command[0];
  const tail = command.slice(1);

  if (typeof head === 'string' && head.startsWith('$minnow:')) {
    const minnowId = head.slice('$minnow:'.length);
    return resolveMinnowToken(minnowId, tail);
  }

  if (head === 'typescript-language-server') {
    return buildTypeScriptLanguageServerArgv(tail);
  }

  const mapped = command.map((part, index) => {
    if (part === 'test/fixtures/fake-lsp.mjs') {
      return path.join(getAppRoot(), 'test/fixtures/fake-lsp.mjs');
    }
    if (part === '$minnow:tsserver') {
      const resolved = tryResolveBundledTsserverPath();
      if (resolved) return resolved;
      throw new Error('Cannot resolve $minnow:tsserver — no bundled tsserver.js found.');
    }
    if (index === 0 && typeof part === 'string') {
      return resolveLspExecutable(part);
    }
    return part;
  });

  const displayBin = isNodeCommandToken(head) ? head : (mapped[0] ?? '');
  return { argv: mapped, displayBin };
}

export function getManagedLspServersDir() {
  return getManagedLspNpmRoot();
}
