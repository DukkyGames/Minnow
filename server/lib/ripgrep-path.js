/**
 * Resolve the ripgrep binary for subprocess spawn (grep, find_files, brain indexer, …).
 * @vscode/ripgrep points at the platform package under node_modules; in Electron that path
 * often sits inside app.asar. The asar archive is a file — spawn through app.asar/… fails
 * (ENOENT on Windows, ENOTDIR on macOS). fs.existsSync can still return true for asar
 * paths, so never exec a path inside app.asar without app.asar.unpacked.
 */

import fs from 'node:fs';
import path from 'node:path';
import { rgPath as bundledRgPath } from '@vscode/ripgrep';

/**
 * Map a path inside app.asar to the matching app.asar.unpacked location.
 * @param {string} executablePath
 * @returns {string}
 */
export function remapAsarUnpackPath(executablePath) {
  if (isInsidePackagedAsarArchive(executablePath)) {
    return executablePath.replace(/app\.asar/g, 'app.asar.unpacked');
  }
  return executablePath;
}

/**
 * True when the path traverses the packaged app.asar archive (not app.asar.unpacked).
 * @param {string} filePath
 */
export function isInsidePackagedAsarArchive(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('app.asar.unpacked/')) {
    return false;
  }
  return normalized.includes('/app.asar/');
}

/**
 * Ripgrep binary under resources/app.asar.unpacked (Electron packaged app).
 * @returns {string | null}
 */
function resolvePackagedRipgrepFromResources() {
  const resourcesPath =
    typeof process.resourcesPath === 'string' && process.resourcesPath.trim()
      ? process.resourcesPath.trim()
      : '';
  if (!resourcesPath) {
    return null;
  }
  const binaryName = process.platform === 'win32' ? 'rg.exe' : 'rg';
  const platformPkg = `@vscode/ripgrep-${process.platform}-${process.arch}`;
  const candidate = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    platformPkg,
    'bin',
    binaryName,
  );
  return fs.existsSync(candidate) ? candidate : null;
}

/**
 * Pick an on-disk executable from @vscode/ripgrep's resolved path.
 * @param {string} bundledPath
 * @returns {string}
 */
export function resolveRipgrepExecutablePath(bundledPath) {
  const unpacked = remapAsarUnpackPath(bundledPath);
  if (fs.existsSync(unpacked)) {
    return unpacked;
  }

  const fromResources = resolvePackagedRipgrepFromResources();
  if (fromResources) {
    return fromResources;
  }

  if (!isInsidePackagedAsarArchive(bundledPath) && fs.existsSync(bundledPath)) {
    return bundledPath;
  }

  return process.platform === 'win32' ? 'rg.exe' : 'rg';
}

/**
 * Executable path for `execFile('rg', …)`.
 * @returns {string}
 */
export function getRipgrepPath() {
  return resolveRipgrepExecutablePath(bundledRgPath);
}
