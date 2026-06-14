/**
 * Paths for local model artifacts under ~/.minnow/models/.
 */

import path from 'node:path';
import { getMinnowHome } from '../config/home.js';

/** Root directory for downloaded model files. */
export function getModelsRoot() {
  return path.join(getMinnowHome(), 'models');
}

/** Persisted download job index. */
export function getDownloadsIndexPath() {
  return path.join(getModelsRoot(), 'downloads.json');
}

/** Persisted active serve processes. */
export function getServesIndexPath() {
  return path.join(getModelsRoot(), 'serves.json');
}

/**
 * Destination directory for a HuggingFace repo download.
 * @param {string} repoId
 */
export function repoDownloadDir(repoId) {
  const safe = repoId.replace(/\//g, '--');
  return path.join(getModelsRoot(), 'artifacts', safe);
}

/** Serve process logs under ~/.minnow/logs/models/. */
export function modelsLogDir() {
  return path.join(getMinnowHome(), 'logs', 'models');
}
