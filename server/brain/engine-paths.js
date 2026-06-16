/**
 * Engine disk paths for the brain wiki (~/.minnow/brain/).
 */

import path from 'node:path';
import { getBackupsDir } from '../memory/paths.js';
import { getBrainDir } from './paths.js';

/**
 * Resolve injected paths for server/engine disk-touching modules.
 * @returns {{ rootDir: string, vectorsPath: string, proposalsPath: string, backupsDir: string }}
 */
export function getEnginePaths() {
  const rootDir = getBrainDir();
  return {
    rootDir,
    vectorsPath: path.join(rootDir, 'vectors.json'),
    proposalsPath: path.join(rootDir, 'proposals.json'),
    backupsDir: getBackupsDir(),
  };
}
