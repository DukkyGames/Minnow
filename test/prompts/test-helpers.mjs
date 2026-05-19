/**
 * Helpers for prompt unit tests (tsx + node:test).
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = path.join(__dirname, 'fixtures');

export function fixturePath(name) {
  return path.join(FIXTURES_DIR, name);
}
