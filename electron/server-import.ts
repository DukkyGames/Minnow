/**
 * Load server/*.js modules from the repo root (works from electron/dist/*.js at runtime).
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Minnow repository root (parent of electron/). */
export function getProjectRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', '..');
}

/**
 * Dynamic import of a file under server/ (e.g. "terminal/pty-host.js").
 */
export async function importServerModule<T = Record<string, unknown>>(
  relativePath: string,
): Promise<T> {
  const fullPath = path.join(getProjectRoot(), 'server', relativePath);
  return import(pathToFileURL(fullPath).href) as Promise<T>;
}
