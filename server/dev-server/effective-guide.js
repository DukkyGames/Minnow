/**
 * Merge startup.md guide with per-workspace hub settings (port, network bind).
 * Port injection is stack-aware: never append CLI flags a given server rejects.
 */

import fs from 'node:fs';
import path from 'node:path';
import { coercePort, DEFAULT_NETWORK, DEFAULT_PORT } from './settings.js';

/** @typedef {'local' | 'lan'} DevServerNetwork */

/**
 * Classified from the spawn command plus any resolved package.json script body.
 * `npm run dev` alone is never enough to pick Vite.
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
 * True when the command runs API + client processes via concurrently.
 * @param {string} command
 */
export function isSplitStackDevCommand(command) {
  return /\bconcurrently\b/i.test(String(command).trim());
}

/**
 * Return the package.json script body for `npm|pnpm|yarn run <name>` when readable.
 * Used for stack classification; does not rewrite the spawn command.
 * @param {string} command
 * @param {string} packageJsonDir — directory containing package.json
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
 * Expand `npm run dev` (etc.) to the underlying package.json script when it uses concurrently.
 * @param {string} command
 * @param {string} packageJsonDir — absolute or relative directory containing package.json
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
 * Classify the underlying CLI from the spawn command and optional resolved script body.
 * Order matters: electron-vite contains "vite", so it must win before the Vite check.
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

  // electron-vite's CAC rejects `--port`; check before the bare `vite` word boundary.
  if (/\belectron-vite\b/.test(haystack)) {
    return 'electron-vite';
  }

  if (/\breact-scripts\b/.test(haystack)) {
    return 'cra';
  }

  // Match `next dev` / `next start`, not hyphenated names like `next-dev`.
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
    // `\bvite\b` also matches inside `electron-vite`; skip that CLI (no `--port`).
    (/\bvite\b/.test(s) && !/\belectron-vite\b/.test(s)) ||
    /\bnpx vite\b/.test(s) ||
    /\bfrontend:dev\b/.test(s)
  );
}

/**
 * Insert CLI flags after `--` for package-manager run commands, else append.
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

  return appendCliFlags(trimmed, flags);
}

/**
 * Append Next.js `-p` when the command does not already set a port.
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
 * Inject only the CLI flags the detected stack accepts.
 * Unknown / electron-vite / CRA get env only — never Vite `--port`.
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
 * `PORT` is the API (or sole) bind; `VITE_PORT` is always the UI/client port.
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
