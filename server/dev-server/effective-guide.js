/**
 * Merge startup.md guide with per-workspace hub settings (port, network bind).
 */

import fs from 'node:fs';
import path from 'node:path';
import { coercePort, DEFAULT_NETWORK, DEFAULT_PORT } from './settings.js';

/** @typedef {'local' | 'lan'} DevServerNetwork */

/**
 * @typedef {object} EffectiveDevServerGuide
 * @property {string} command
 * @property {string} [cwd]
 * @property {string} [healthUrl]
 * @property {number} port
 * @property {number} [apiPort]
 * @property {boolean} [splitStack]
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
 * True when the command runs API + client processes via concurrently.
 * @param {string} command
 */
export function isSplitStackDevCommand(command) {
  return /\bconcurrently\b/i.test(String(command).trim());
}

/**
 * Expand `npm run dev` (etc.) to the underlying package.json script when it uses concurrently.
 * @param {string} command
 * @param {string} packageJsonDir — absolute or relative directory containing package.json
 */
export function expandPackageDevScript(command, packageJsonDir) {
  const trimmed = command.trim();
  const match = trimmed.match(NPM_RUN_RE);
  if (!match) return trimmed;

  const scriptName = match[1];
  try {
    const pkgPath = path.join(packageJsonDir, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const script = pkg.scripts?.[scriptName];
    if (typeof script !== 'string' || !isSplitStackDevCommand(script)) {
      return trimmed;
    }
    return toNpxConcurrentlyCommand(script.trim());
  } catch {
    return trimmed;
  }
}

/**
 * Prefix bare `concurrently` with npx so the local dependency resolves when spawned directly.
 * @param {string} script
 */
function toNpxConcurrentlyCommand(script) {
  if (/^concurrently\b/i.test(script)) {
    return `npx ${script}`;
  }
  return script;
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
    /\bvite\b/.test(s) ||
    /\bnpx vite\b/.test(s) ||
    /\bfrontend:dev\b/.test(s)
  );
}

/**
 * Append Vite-style CLI flags to a single npm/yarn/pnpm script segment.
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

  if (
    (/\bnpm run \S+/.test(trimmed) ||
      /\bpnpm (run )?\S+/.test(trimmed) ||
      /\byarn( run)? \S+/.test(trimmed)) &&
    !trimmed.includes(' -- ')
  ) {
    return `${trimmed} -- ${flags}`;
  }
  return flags ? `${trimmed} ${flags}` : trimmed;
}

/**
 * Inject port/host flags into concurrently child scripts that serve the UI (Vite/client).
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
 * Append Vite-style CLI flags when the startup command looks like a typical dev script.
 * @param {string} command
 * @param {number} port
 * @param {DevServerNetwork} network
 * @param {{ expandedCommand?: string, splitStack?: boolean }} [options]
 */
export function augmentDevServerCommand(command, port, network, options = {}) {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;

  const expandedCommand = options.expandedCommand ?? trimmed;
  const splitStack = options.splitStack ?? isSplitStackDevCommand(expandedCommand);

  if (splitStack) {
    return augmentConcurrentlyQuotedSegments(expandedCommand, port, network);
  }

  const needsPort = !/--port(?:=|\s)/.test(trimmed);
  const needsHost = network === 'lan' && !/--host(?:=|\s)/.test(trimmed);
  if (!needsPort && !needsHost) return trimmed;

  const flags = [needsPort ? `--port ${port}` : '', needsHost ? '--host' : '']
    .filter(Boolean)
    .join(' ');

  const looksVite =
    /\bvite\b/.test(trimmed) ||
    /\bnpm run dev\b/.test(trimmed) ||
    /\bnpx vite\b/.test(trimmed) ||
    /\bpnpm (run )?dev\b/.test(trimmed) ||
    /\byarn dev\b/.test(trimmed);

  if (!looksVite) return trimmed;

  if (/\bnpm run \S+/.test(trimmed) && !trimmed.includes(' -- ')) {
    return `${trimmed} -- ${flags}`;
  }
  return `${trimmed} ${flags}`;
}

/**
 * Pin the port hard: refuse to start rather than silently move.
 *
 * Vite's dev/preview server auto-increments when the requested port is busy,
 * so `--port N` alone is a *preference*, not a pin — the app can end up on
 * N+1 while everything downstream still looks for N. That is tolerable for a
 * human, who can read the banner, and fatal for an unattended verification,
 * which would either navigate to nothing or (worse) navigate to a stale server
 * left on N by an earlier run and report on the wrong app.
 *
 * Opt-in, and only for commands that already carry `--port`, so the
 * interactive dev-server surface is unaffected: this exists for P5-C's browser
 * rung, which must know exactly which port it is verifying.
 *
 * @param {string} command
 * @returns {string}
 */
export function withStrictPort(command) {
  const trimmed = String(command ?? '').trim();
  if (!trimmed) return trimmed;
  if (/--strictPort\b/i.test(trimmed)) return trimmed;
  if (!/--port(?:=|\s)/.test(trimmed)) return trimmed;

  // A split stack carries the UI port inside a quoted `concurrently` child.
  // Appending at the end would hand the flag to `concurrently` itself.
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
 * Environment variables merged into the dev-server child process.
 * @param {number} port — UI port for split stacks; sole port otherwise
 * @param {DevServerNetwork} network
 * @param {{ splitStack?: boolean, apiPort?: number }} [options]
 */
export function buildDevServerSpawnEnv(port, network, options = {}) {
  const bindHost = network === 'lan' ? '0.0.0.0' : '127.0.0.1';
  const splitStack = options.splitStack === true;
  const apiPort = options.apiPort ?? (splitStack ? port + 1 : port);

  return {
    PORT: String(splitStack ? apiPort : port),
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

  const expandedCommand = expandPackageDevScript(guide.command, packageJsonDir);
  const splitStack = isSplitStackDevCommand(expandedCommand);
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
    }),
    cwd: guide.cwd,
    healthUrl,
    port,
    apiPort: splitStack ? apiPort : undefined,
    splitStack,
    network,
    bindHost,
    stop: guide.stop,
  };
}

export { DEFAULT_PORT, DEFAULT_NETWORK };
