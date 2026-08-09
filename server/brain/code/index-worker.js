/**
 * Child-process entry for Brain code reindex (keeps Electron main thread responsive).
 */

import { createInterface } from 'node:readline';
import { setWorkspaceRoot } from '../../workspace/root.js';
import { resetMinnowHomeCache } from '../../config/home.js';
import { reindexCode } from './indexer.js';
import { reportIndexProgress, setIndexProgressForwarder } from './index-progress.js';

setIndexProgressForwarder((repo, snapshot) => {
  process.stdout.write(`${JSON.stringify({ type: 'progress', repo, ...snapshot })}\n`);
});

const rl = createInterface({ input: process.stdin, terminal: false });

rl.once('line', async (line) => {
  rl.close();
  try {
    const msg = JSON.parse(String(line ?? '{}'));
    if (msg.minnowHome) {
      process.env.MINNOW_HOME = String(msg.minnowHome);
      resetMinnowHomeCache();
    }
    if (msg.workspaceRoot) {
      await setWorkspaceRoot(String(msg.workspaceRoot));
    }
    const result = await reindexCode(msg.opts ?? {});
    process.stdout.write(`${JSON.stringify({ type: 'done', result })}\n`);
    process.exit(0);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stdout.write(`${JSON.stringify({ type: 'error', message })}\n`);
    process.exit(1);
  }
});
