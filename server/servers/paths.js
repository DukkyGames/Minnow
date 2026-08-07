/**
 * Paths for managed local servers under ~/.minnow/servers.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Root for all managed server installs (~/.minnow/servers). */
export function getServersRoot() {
  return path.join(getMinnowHome(), 'servers');
}

/** Per-server install directory (~/.minnow/servers/<id>). */
export function getServerDir(id) {
  return path.join(getServersRoot(), id);
}

/** Python venv for a managed server. */
export function getServerVenvDir(id) {
  return path.join(getServerDir(id), 'venv');
}

/** Install metadata JSON for a managed server. */
export function getServerMetaPath(id) {
  return path.join(getServerDir(id), 'meta.json');
}

/** Last successful spawn record for orphan reaping (~/.minnow/servers/<id>/run.json). */
export function getServerRunPath(id) {
  return path.join(getServerDir(id), 'run.json');
}

/** Generated SearXNG settings file path. */
export function getServerSettingsPath(id) {
  return path.join(getServerDir(id), 'settings.yml');
}

/** Persistent stdout/stderr log for a managed server. */
export function getServerLogPath(id) {
  return path.join(getMinnowHome(), 'logs', 'servers', `${id}.log`);
}

/** Shared python-build-standalone install (~/.minnow/servers/python). */
export function getServersPythonDir() {
  return path.join(getServersRoot(), 'python');
}
