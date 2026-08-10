/**
 * Spawns the Brain code indexer in a child Node process (Electron-safe via node-runtime).
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMinnowHome } from '../../config/home.js';
import { getEffectiveWorkspaceRoot } from '../../runtime/path-access.js';
import { applyNodeRuntimeEnv, getLspNodeExecutable } from '../../lsp/node-runtime.js';
import { buildLspProcessEnv } from '../../lsp/paths.js';
import { reindexCode } from './indexer.js';
import { reportIndexProgress } from './index-progress.js';

const WORKER_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'index-worker.js');

/**
 * Reassemble newline-delimited JSON from stream chunks.
 *
 * Pipe chunks are not line-aligned. The worker's `done` frame spans several chunks on any
 * real repo, and parsing each chunk on its own dropped every fragment — the reindex then
 * failed with "Index worker closed without a result" after doing all the work.
 * @param {(line: string) => void} onLine
 */
export function createNdjsonFramer(onLine) {
  let residual = '';
  return {
    /** @param {string} chunk */
    push(chunk) {
      residual += chunk;
      const lines = residual.split(/\r?\n/);
      // The trailing element is an incomplete line — hold it for the next chunk.
      residual = lines.pop() ?? '';
      for (const line of lines) {
        if (line) onLine(line);
      }
    },
    /** Deliver a final unterminated line, if any. */
    flush() {
      const tail = residual;
      residual = '';
      if (tail) onLine(tail);
    },
  };
}

/** Tests and MINNOW_BRAIN_INDEX_IN_PROCESS=1 keep indexing on the main thread. */
export function shouldRunBrainIndexInProcess() {
  return (
    process.env.MINNOW_BRAIN_INDEX_IN_PROCESS === '1' ||
    process.env.NODE_ENV === 'test' ||
    process.env.MINNOW_TEST === '1'
  );
}

/**
 * Run reindexCode in-process or in a child, depending on environment.
 * @param {Parameters<typeof reindexCode>[0]} opts
 */
export async function runBrainCodeReindex(opts = {}) {
  if (shouldRunBrainIndexInProcess()) {
    return reindexCode(opts);
  }
  return runBrainCodeReindexChild(opts);
}

/**
 * @param {Parameters<typeof reindexCode>[0]} opts
 */
function runBrainCodeReindexChild(opts) {
  const workspaceRoot = getEffectiveWorkspaceRoot();
  const executable = getLspNodeExecutable();
  const env = applyNodeRuntimeEnv(buildLspProcessEnv(), executable);

  return new Promise((resolve, reject) => {
    const child = spawn(executable, [WORKER_SCRIPT], {
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    let settled = false;

    child.stderr?.on('data', (chunk) => {
      stderr += String(chunk);
    });

    /** @param {string} line */
    const handleLine = (line) => {
      if (!line) return;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        return;
      }
      if (msg.type === 'progress' && msg.repo) {
        reportIndexProgress(msg.repo, {
          indexing: Boolean(msg.indexing),
          filesDone: Number(msg.filesDone) || 0,
          filesTotal: Number(msg.filesTotal) || 0,
          phase: String(msg.phase ?? 'idle'),
        });
      } else if (msg.type === 'done' && !settled) {
        settled = true;
        resolve(msg.result);
      } else if (msg.type === 'error' && !settled) {
        settled = true;
        reject(new Error(String(msg.message ?? 'Index worker failed')));
      }
    };

    const framer = createNdjsonFramer(handleLine);
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk) => framer.push(chunk));
    child.stdout?.on('end', () => framer.flush());

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        reject(new Error('Index worker closed without a result'));
        return;
      }
      reject(new Error(stderr.trim() || `Index worker exited with code ${code}`));
    });

    const payload = {
      workspaceRoot,
      minnowHome: getMinnowHome(),
      opts,
    };
    child.stdin?.write(`${JSON.stringify(payload)}\n`);
    child.stdin?.end();
  });
}
