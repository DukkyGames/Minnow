/**
 * Merge startup.md guide with per-workspace hub settings (port, network bind).
 */

import { DEFAULT_NETWORK, DEFAULT_PORT } from './settings.js';

/** @typedef {'local' | 'lan'} DevServerNetwork */

/**
 * @typedef {object} EffectiveDevServerGuide
 * @property {string} command
 * @property {string} [cwd]
 * @property {string} [healthUrl]
 * @property {number} port
 * @property {DevServerNetwork} network
 * @property {string} bindHost
 * @property {{ command?: string }} [stop]
 */

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
 * Append Vite-style CLI flags when the startup command looks like a typical dev script.
 * @param {string} command
 * @param {number} port
 * @param {DevServerNetwork} network
 */
export function augmentDevServerCommand(command, port, network) {
  const trimmed = command.trim();
  if (!trimmed) return trimmed;

  const needsPort = !/--port(?:=|\s)/.test(trimmed);
  const needsHost = network === 'lan' && !/--host(?:=|\s)/.test(trimmed);
  if (!needsPort && !needsHost) return trimmed;

  const flags = [
    needsPort ? `--port ${port}` : '',
    needsHost ? '--host' : '',
  ]
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
 * Environment variables merged into the dev-server child process.
 * @param {number} port
 * @param {DevServerNetwork} network
 */
export function buildDevServerSpawnEnv(port, network) {
  const bindHost = network === 'lan' ? '0.0.0.0' : '127.0.0.1';
  return {
    PORT: String(port),
    HOST: bindHost,
    VITE_DEV_SERVER_HOST: bindHost,
  };
}

/**
 * @param {{ command: string, cwd?: string, healthUrl?: string, port?: number, stop?: { command?: string } }} guide
 * @param {{ port?: number, network?: DevServerNetwork }} settings
 * @returns {EffectiveDevServerGuide}
 */
export function resolveEffectiveGuide(guide, settings) {
  const port =
    settings.port != null && Number.isFinite(settings.port)
      ? settings.port
      : guide.port ?? DEFAULT_PORT;
  const network = settings.network ?? DEFAULT_NETWORK;
  const bindHost = network === 'lan' ? '0.0.0.0' : '127.0.0.1';

  const healthUrl = guide.healthUrl
    ? rewriteHealthUrlForProbe(guide.healthUrl, port)
    : undefined;

  return {
    command: augmentDevServerCommand(guide.command, port, network),
    cwd: guide.cwd,
    healthUrl,
    port,
    network,
    bindHost,
    stop: guide.stop,
  };
}

export { DEFAULT_PORT, DEFAULT_NETWORK };
