/**
 * Canonical file:// URIs for LSP document keys and diagnostic waiter matching.
 * Windows language servers often emit percent-encoded drive letters (file:///c%3A/…)
 * while Node pathToFileURL uses file:///C:/… — normalize before map lookups.
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Uppercase drive letter on Windows so c:\ and C:\ share one key. */
export function normalizeAbsolutePath(absPath) {
  const resolved = path.resolve(absPath);
  if (process.platform === 'win32' && /^[a-zA-Z]:/.test(resolved)) {
    return resolved.charAt(0).toUpperCase() + resolved.slice(1);
  }
  return resolved;
}

/** Normalize any file URI to the canonical href used for LSP document sync keys. */
export function normalizeFileUri(uri) {
  if (!uri || typeof uri !== 'string') return uri;
  if (!uri.startsWith('file:')) return uri;
  try {
    const abs = normalizeAbsolutePath(fileURLToPath(uri));
    return pathToFileURL(abs).href;
  } catch {
    return uri;
  }
}

/** Project-relative path from a file URI (normalized before resolving). */
export function fileUriToAbsolutePath(uri) {
  return normalizeAbsolutePath(fileURLToPath(normalizeFileUri(uri)));
}
