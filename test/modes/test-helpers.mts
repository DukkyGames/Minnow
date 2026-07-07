/**
 * Shared helpers for mode unit tests.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');

export function repoPath(...segments: string[]): string {
  return path.join(REPO_ROOT, ...segments);
}

/** Load shipped mode prompt files into a Vite-style glob map for registerPromptFilesFromRaw. */
export async function loadBuiltinModePromptMap(): Promise<Record<string, string>> {
  const modesDir = repoPath('src/chat/prompts/modes');
  const ids = ['general', 'desktop', 'build', 'plan', 'orchestrate', 'reef', 'debug'] as const;
  const map: Record<string, string> = {};
  for (const id of ids) {
    for (const profile of ['full', 'lite'] as const) {
      const fileName = `${id}.${profile}.md`;
      const abs = path.join(modesDir, fileName);
      const key = `./modes/${fileName}`;
      map[key] = await fs.readFile(abs, 'utf8');
    }
  }
  return map;
}
