/**
 * Engine disk paths for the memory feature (~/.minnow/memory/).
 */

import path from 'node:path';
import { getBackupsDir, getMemoryDir } from './paths.js';

/**
 * Resolve injected paths for server/engine disk-touching modules.
 * @returns {{ rootDir: string, vectorsPath: string, proposalsPath: string, backupsDir: string }}
 */
export function getEnginePaths() {
  const rootDir = getMemoryDir();
  return {
    rootDir,
    vectorsPath: path.join(rootDir, 'vectors.json'),
    proposalsPath: path.join(rootDir, 'proposals.json'),
    backupsDir: getBackupsDir(),
  };
}
