import fs from 'node:fs';
import path from 'node:path';
import { coercePort, DEFAULT_NETWORK, DEFAULT_PORT } from './settings.js';

/** @typedef {'local' | 'lan'} DevServerNetwork */

/**
 * @typedef {'split-stack' | 'vite' | 'next' | 'electron-vite' | 'cra' | 'unknown'} DevServerStack
 */

/**
 * @typedef {object} EffectiveDevServerGuide
 * @property {string} command
 * @property {string} [cwd]
 * @property {string} [healthUrl]
 * @property {number} port
 * @property {number} [apiPort]
 * @property {boolean} [splitStack]
 * @property {DevServerStack} [stack]
 * @property {DevServerNetwork} network
 * @property {string} bindHost
 * @property {{ command?: string }} [stop]
 */

const NPM_RUN_RE = /^(?:npm run|pnpm run|pnpm|yarn run|yarn)\s+([^\s-][^\s]*)/;
const QUOTED_SEGMENT_RE = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'/g;

/**
 * @param {string} healthUrl
 * @param {number} port
 * @returns {string}
 */
export function rewriteHealthUrlForProbe(healthUrl, port) {
  try {
    const u = new URL(healthUrl);
    u.hostname = '127.0.0.1';
    u.port = String(port);
    return u.toString();
  } catch {
    return `http://127.0.0.1:${port}/`;
  }
}

/**
 * @param {string} command
 */
export function isSplitStackDevCommand(command) {
  return /\bconcurrently\b/i.test(String(command).trim());
}

/**
 * @param {string} command
 * @param {string} packageJsonDir
 * @returns {string | undefined}
 */
export function readPackageScriptBody(command, packageJsonDir) {
  const match = String(command).trim().match(NPM_RUN_RE);
  if (!match) return undefined;

  try {
    const pkgPath = path.join(packageJsonDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const script = pkg.scripts?.[match[1]];
    if (typeof script !== 'string') return undefined;
    const body = script.trim();
    return body || undefined;
  } catch {
    return undefined;
  }
}

/**
 * @param {string} command
 * @param {string} packageJsonDir
 */
export function expandPackageDevScript(command, packageJsonDir) {
  const trimmed = command.trim();
  const script = readPackageScriptBody(command, packageJsonDir);
  if (!script || !isSplitStackDevCommand(script)) {
    return trimmed;
  }
  return toNpxConcurrentlyCommand(script);
}

/**
 * @param {string} script
 */
function toNpxConcurrentlyCommand(script) {
  if (/^concurrently\b/i.test(script)) {
    return `npx ${script}`;
  }
  return script;
}

/**
 * @param {{ command: string, scriptBody?: string }} input
 * @returns {DevServerStack}
 */
export function detectDevServerStack({ command, scriptBody }) {
  const commandText = String(command ?? '').trim();
  const body = String(scriptBody ?? '').trim();
  const haystack = `${commandText}\n${body}`;

  if (isSplitStackDevCommand(commandText) || isSplitStackDevCommand(body)) {
    return 'split-stack';
  }

  if (/\belectron-vite\b/.test(haystack)) {
    return 'electron-vite';
  }

  if (/\breact-scripts\b/.test(haystack)) {
    return 'cra';
  }

  if (/\bnext(?:\.js)?\s+(dev|start)\b/.test(haystack)) {
    return 'next';
  }

  if (/\bvite\b/.test(haystack)) {
    return 'vite';
  }

  return 'unknown';
}

/**
 * @param {string} segment
 */
function isServerDevScript(segment) {
  const s = segment.trim();
  return (
    /\bdev:server\b/.test(s) ||
    /\bserver:dev\b/.test(s) ||
    /\bnpm run dev:server\b/.test(s) ||
    /\bpnpm (run )?dev:server\b/.test(s) ||
    /\byarn dev:server\b/.test(s)
  );
}

/**
 * @param {string} segment
 */
function isClientDevScript(segment) {
  const s = segment.trim();
  if (isServerDevScript(s)) return false;
  return (
    /\bdev:client\b/.test(s) ||
    /\bclient:dev\b/.test(s) ||
    /\bnpm run dev:client\b/.test(s) ||
    /\bpnpm (run )?dev:client\b/.test(s) ||
    /\byarn dev:client\b/.test(s) ||
    (/\bvite\b/.test(s) && !/\belectron-vite\b/.test(s)) ||
    /\bnpx vite\b/.test(s) ||
    /\bfrontend:dev\b/.test(s)
  );
}

/**
 * @param {string} command
 * @param {string} flags
 */
function appendCliFlags(command, flags) {
  if (!flags) return command;
  if (
    (/\bnpm run \S+/.test(command) ||
      /\bpnpm (run )?\S+/.test(command) ||
      /\byarn( run)? \S+/.test(command)) &&
    !command.includes(' -- ')
  ) {
    return `${command} -- ${flags}`;
  }
  return `${command} ${flags}`;
}

/**
 * @param {string} command
 * @param {number} port
 * @param {DevServerNetwork} network
 */
function augmentSingleDevScript(command, port, network) {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;

  const needsPort = !/--port(?:=|\s)/.test(trimmed);
  const needsHost = network === 'lan' && !/--host(?:=|\s)/.test(trimmed);
  if (!needsPort && !needsHost) return trimmed;

  const flags = [needsPort ? `--port ${port}` : '', needsHost ? '--host' : '']
    .filter(Boolean)
    .join(' ');

  return appendCliFlags(trimmed, flags);
}

/**
 * @param {string} command
 * @param {number} port
 */
function augmentNextCliFlags(command, port) {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;
  if (/(?:^|\s)-p(?:\s|=)|--port(?:=|\s)/.test(trimmed)) return trimmed;
  return appendCliFlags(trimmed, `-p ${port}`);
}

/**
 * @param {string} command
 * @param {number} port
 * @param {DevServerNetwork} network
 */
export function augmentConcurrentlyQuotedSegments(command, port, network) {
  return command.replace(QUOTED_SEGMENT_RE, (full, doubleQuoted, singleQuoted) => {
    const inner = doubleQuoted ?? singleQuoted;
    const quote = doubleQuoted !== undefined ? '"' : "'";
    if (!isClientDevScript(inner)) return full;
    const augmented = augmentSingleDevScript(inner, port, network);
    return `${quote}${augmented}${quote}`;
  });
}

/**
 * @param {string} command
 * @param {number} port
 * @param {DevServerNetwork} network
 * @param {{ expandedCommand?: string, splitStack?: boolean, scriptBody?: string, stack?: DevServerStack }} [options]
 */
export function augmentDevServerCommand(command, port, network, options = {}) {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;

  const expandedCommand = options.expandedCommand ?? trimmed;
  const stack =
    options.stack ??
    detectDevServerStack({
      command: expandedCommand,
      scriptBody: options.scriptBody,
    });
  const splitStack =
    options.splitStack ?? (stack === 'split-stack' || isSplitStackDevCommand(expandedCommand));

  if (splitStack || stack === 'split-stack') {
    return augmentConcurrentlyQuotedSegments(expandedCommand, port, network);
  }

  if (stack === 'vite') {
    return augmentSingleDevScript(trimmed, port, network);
  }

  if (stack === 'next') {
    return augmentNextCliFlags(trimmed, port);
  }

  return trimmed;
}

/**
 * @param {string} command
 * @returns {string}
 */
export function withStrictPort(command) {
  const trimmed = String(command ?? '').trim();
  if (!trimmed) return trimmed;
  if (/--strictPort\b/i.test(trimmed)) return trimmed;
  if (!/--port(?:=|\s)/.test(trimmed)) return trimmed;

  QUOTED_SEGMENT_RE.lastIndex = 0;
  if (QUOTED_SEGMENT_RE.test(trimmed)) {
    QUOTED_SEGMENT_RE.lastIndex = 0;
    return trimmed.replace(QUOTED_SEGMENT_RE, (full, doubleQuoted, singleQuoted) => {
      const inner = doubleQuoted ?? singleQuoted;
      if (!/--port(?:=|\s)/.test(inner)) return full;
      const quote = doubleQuoted !== undefined ? '"' : "'";
      return `${quote}${inner} --strictPort${quote}`;
    });
  }
  return `${trimmed} --strictPort`;
}

/**
 * @param {number} port
 * @param {DevServerNetwork} network
 * @param {{ splitStack?: boolean, apiPort?: number }} [options]
 */
export function buildDevServerSpawnEnv(port, network, options = {}) {
  const bindHost = network === 'lan' ? '0.0.0.0' : '127.0.0.1';
  const splitStack = options.splitStack === true;
  const apiPort = options.apiPort ?? (splitStack ? port + 1 : port);

  return {
    PORT: String(splitStack ? apiPort : port),
    VITE_PORT: String(port),
    HOST: bindHost,
    VITE_DEV_SERVER_HOST: bindHost,
  };
}

/**
 * @param {{ command: string, cwd?: string, healthUrl?: string, port?: number, apiPort?: number, stop?: { command?: string } }} guide
 * @param {{ port?: number, network?: DevServerNetwork }} settings
 * @param {{ packageJsonDir?: string, apiPort?: number }} [options]
 * @returns {EffectiveDevServerGuide}
 */
export function resolveEffectiveGuide(guide, settings, options = {}) {
  const port =
    settings.port != null && Number.isFinite(settings.port)
      ? settings.port
      : guide.port ?? DEFAULT_PORT;
  const network = settings.network ?? DEFAULT_NETWORK;
  const bindHost = network === 'lan' ? '0.0.0.0' : '127.0.0.1';
  const packageJsonDir = options.packageJsonDir ?? guide.cwd ?? '.';

  const scriptBody = readPackageScriptBody(guide.command, packageJsonDir);
  const expandedCommand = expandPackageDevScript(guide.command, packageJsonDir);
  const stack = detectDevServerStack({
    command: expandedCommand,
    scriptBody,
  });
  const splitStack = stack === 'split-stack';
  const apiPort =
    coercePort(guide.apiPort ?? options.apiPort) ?? (splitStack ? port + 1 : port);

  const healthUrl = guide.healthUrl
    ? rewriteHealthUrlForProbe(guide.healthUrl, port)
    : splitStack
      ? `http://127.0.0.1:${port}/`
      : undefined;

  return {
    command: augmentDevServerCommand(guide.command, port, network, {
      expandedCommand,
      splitStack,
      scriptBody,
      stack,
    }),
    cwd: guide.cwd,
    healthUrl,
    port,
    apiPort: splitStack ? apiPort : undefined,
    splitStack,
    stack,
    network,
    bindHost,
    stop: guide.stop,
  };
}

export { DEFAULT_PORT, DEFAULT_NETWORK };
